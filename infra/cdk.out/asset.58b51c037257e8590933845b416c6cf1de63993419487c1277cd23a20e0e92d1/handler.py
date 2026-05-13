import json
import os
import time
import boto3
import redis

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])

lambda_client = boto3.client('lambda')
sqs = boto3.client('sqs')

redis_client = redis.Redis(
    host=os.environ['REDIS_HOST'],
    port=6379,
    ssl=True,
    decode_responses=True,
)

QUEUE_URL = os.environ['QUEUE_URL']
BROADCAST_FN_NAME = os.environ['BROADCAST_FN_NAME']
QUESTION_DURATION_MS = 15_000


def broadcast(room_code, message):
    """Invoke the broadcast Lambda to send a message to all room players."""
    lambda_client.invoke(
        FunctionName=BROADCAST_FN_NAME,
        InvocationType='Event',
        Payload=json.dumps({
            'room_code': room_code,
            'message': message,
        }),
    )


def get_leaderboard(room_code):
    """Get top 10 from Redis sorted set with display names."""
    top = redis_client.zrevrange(f'leaderboard:{room_code}', 0, 9, withscores=True)
    result = []
    for connection_id, score in top:
        player = table.get_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': f'PLAYER#{connection_id}'},
        ).get('Item', {})
        result.append({
            'name': player.get('display_name', 'Unknown'),
            'score': int(score),
        })
    return result


def handler(event, context):
    for record in event.get('Records', []):
        body = json.loads(record['body'])
        room_code = body['room_code']
        question_index = body['question_index']

        room = table.get_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
        ).get('Item')

        if not room:
            continue

        # Idempotency: only advance if the room is still on this question
        current_index = int(room.get('current_question_index', -1))
        if current_index != question_index:
            continue

        # Get the question for the reveal
        question = table.get_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': f'Q#{question_index}'},
        ).get('Item', {})

        # Broadcast question reveal
        broadcast(room_code, {
            'type': 'question.reveal',
            'index': question_index,
            'correct_index': int(question.get('correct_index', 0)),
            'stats': {},
        })

        # Broadcast leaderboard update
        leaderboard = get_leaderboard(room_code)
        broadcast(room_code, {
            'type': 'leaderboard.update',
            'top': leaderboard,
        })

        # Check if this was the last question
        question_count = int(room.get('question_count', 10))
        next_index = question_index + 1

        if next_index >= question_count:
            table.update_item(
                Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
                UpdateExpression='SET #s = :s',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':s': 'finished'},
            )
            broadcast(room_code, {
                'type': 'game.over',
                'final_leaderboard': leaderboard,
            })
        else:
            now_ms = int(time.time() * 1000)
            table.update_item(
                Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
                UpdateExpression='SET current_question_index = :i, question_started_at_ms = :t',
                ExpressionAttributeValues={':i': next_index, ':t': now_ms},
            )

            next_question = table.get_item(
                Key={'pk': f'ROOM#{room_code}', 'sk': f'Q#{next_index}'},
            ).get('Item', {})

            deadline_ms = now_ms + QUESTION_DURATION_MS
            broadcast(room_code, {
                'type': 'question.show',
                'index': next_index,
                'prompt': next_question.get('prompt', ''),
                'choices': next_question.get('choices', []),
                'deadline_ms': deadline_ms,
            })

            # Schedule next auto-advance
            sqs.send_message(
                QueueUrl=QUEUE_URL,
                MessageBody=json.dumps({'room_code': room_code, 'question_index': next_index}),
                DelaySeconds=15,
            )
