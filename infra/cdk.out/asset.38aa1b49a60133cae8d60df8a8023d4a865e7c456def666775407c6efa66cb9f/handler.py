import json
import os
import time
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])

score_fn = boto3.client('lambda')
sqs = boto3.client('sqs')

SCORE_FN_NAME = os.environ.get('SCORE_FN_NAME', '')
QUEUE_URL = os.environ.get('QUEUE_URL', '')
BROADCAST_FN_NAME = os.environ.get('BROADCAST_FN_NAME', '')
QUESTION_DURATION_MS = 15_000


def _invoke_broadcast(room_code, message):
    """Invoke the broadcast Lambda to send a message to all room players."""
    score_fn.invoke(
        FunctionName=BROADCAST_FN_NAME,
        InvocationType='Event',  # async — don't wait
        Payload=json.dumps({
            'room_code': room_code,
            'message': message,
        }),
    )


def _send_to_connection(event, message):
    """Send a message back to the caller's WebSocket connection."""
    domain = event['requestContext']['domainName']
    stage = event['requestContext']['stage']
    connection_id = event['requestContext']['connectionId']
    apigw = boto3.client('apigatewaymanagementapi',
                         endpoint_url=f'https://{domain}/{stage}')
    apigw.post_to_connection(
        ConnectionId=connection_id,
        Data=json.dumps(message).encode('utf-8'),
    )


def handle_room_check(event, connection_id):
    """Send back the current room status so the client knows the state."""
    conn = table.get_item(Key={'pk': f'CONN#{connection_id}', 'sk': 'META'}).get('Item')
    if not conn:
        return

    room_code = conn['room_code']
    room = table.get_item(Key={'pk': f'ROOM#{room_code}', 'sk': 'META'}).get('Item')
    if not room:
        return

    status = room.get('status', 'generating')
    if status == 'ready':
        _send_to_connection(event, {
            'type': 'room.ready',
            'question_count': int(room.get('question_count', 10)),
        })
    elif status == 'playing':
        current_index = int(room.get('current_question_index', 0))
        question = table.get_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': f'Q#{current_index}'},
        ).get('Item', {})
        _send_to_connection(event, {
            'type': 'question.show',
            'index': current_index,
            'prompt': question.get('prompt', ''),
            'choices': question.get('choices', []),
            'deadline_ms': int(room.get('question_started_at_ms', 0)) + QUESTION_DURATION_MS,
        })


def handle_host_start(event, connection_id):
    """Host starts the game — show question 0."""
    conn = table.get_item(Key={'pk': f'CONN#{connection_id}', 'sk': 'META'}).get('Item')
    if not conn or conn.get('role') != 'host':
        _send_to_connection(event, {'type': 'error', 'code': 'not_host', 'message': 'Only the host can start the game'})
        return

    room_code = conn['room_code']
    room = table.get_item(Key={'pk': f'ROOM#{room_code}', 'sk': 'META'}).get('Item')
    if not room or room.get('status') != 'ready':
        _send_to_connection(event, {'type': 'error', 'code': 'not_ready', 'message': 'Room is not ready'})
        return

    # Update room status to playing
    now_ms = int(time.time() * 1000)
    table.update_item(
        Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
        UpdateExpression='SET #s = :s, current_question_index = :i, question_started_at_ms = :t',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': 'playing', ':i': 0, ':t': now_ms},
    )

    # Get question 0
    question = table.get_item(Key={'pk': f'ROOM#{room_code}', 'sk': 'Q#0'}).get('Item', {})

    deadline_ms = now_ms + QUESTION_DURATION_MS
    _invoke_broadcast(room_code, {
        'type': 'question.show',
        'index': 0,
        'prompt': question.get('prompt', ''),
        'choices': question.get('choices', []),
        'deadline_ms': deadline_ms,
    })

    # Enqueue auto-advance after 15 seconds
    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({'room_code': room_code, 'question_index': 0}),
        DelaySeconds=15,
    )


def handle_host_next(event, connection_id):
    """Host advances to the next question early."""
    conn = table.get_item(Key={'pk': f'CONN#{connection_id}', 'sk': 'META'}).get('Item')
    if not conn or conn.get('role') != 'host':
        return

    room_code = conn['room_code']
    room = table.get_item(Key={'pk': f'ROOM#{room_code}', 'sk': 'META'}).get('Item')
    if not room or room.get('status') != 'playing':
        return

    current_index = int(room.get('current_question_index', 0))
    question_count = int(room.get('question_count', 10))
    next_index = current_index + 1

    # Reveal current question
    question = table.get_item(
        Key={'pk': f'ROOM#{room_code}', 'sk': f'Q#{current_index}'},
    ).get('Item', {})

    _invoke_broadcast(room_code, {
        'type': 'question.reveal',
        'index': current_index,
        'correct_index': int(question.get('correct_index', 0)),
        'stats': {},
    })

    if next_index >= question_count:
        # Game over
        table.update_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
            UpdateExpression='SET #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'finished'},
        )
        _invoke_broadcast(room_code, {
            'type': 'game.over',
            'final_leaderboard': [],
        })
        return

    # Show next question
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
    _invoke_broadcast(room_code, {
        'type': 'question.show',
        'index': next_index,
        'prompt': next_question.get('prompt', ''),
        'choices': next_question.get('choices', []),
        'deadline_ms': deadline_ms,
    })

    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({'room_code': room_code, 'question_index': next_index}),
        DelaySeconds=15,
    )


def handle_player_answer(event, connection_id, body):
    """Player submits an answer."""
    conn = table.get_item(Key={'pk': f'CONN#{connection_id}', 'sk': 'META'}).get('Item')
    if not conn:
        return

    room_code = conn['room_code']
    question_index = body.get('question_index')
    choice_index = body.get('choice_index')

    if question_index is None or choice_index is None:
        _send_to_connection(event, {'type': 'error', 'code': 'bad_request', 'message': 'Missing question_index or choice_index'})
        return

    # Invoke score Lambda synchronously
    result = score_fn.invoke(
        FunctionName=SCORE_FN_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps({
            'room_code': room_code,
            'connection_id': connection_id,
            'question_index': question_index,
            'choice_index': choice_index,
            'answered_at_ms': int(time.time() * 1000),
        }),
    )
    score_result = json.loads(result['Payload'].read())

    if score_result.get('already_answered'):
        _send_to_connection(event, {'type': 'error', 'code': 'already_answered', 'message': 'Already answered'})
        return

    _send_to_connection(event, {
        'type': 'answer.received',
        'is_correct': score_result.get('is_correct', False),
        'points': score_result.get('points', 0),
    })

    # If all players answered, trigger immediate advance
    if score_result.get('all_answered'):
        sqs.send_message(
            QueueUrl=QUEUE_URL,
            MessageBody=json.dumps({'room_code': room_code, 'question_index': question_index}),
            DelaySeconds=0,
        )


def handler(event, context):
    connection_id = event['requestContext']['connectionId']
    body_str = event.get('body', '{}')

    try:
        body = json.loads(body_str)
    except json.JSONDecodeError:
        return {'statusCode': 400}

    msg_type = body.get('type', '')

    if msg_type == 'host.start':
        handle_host_start(event, connection_id)
    elif msg_type == 'host.next':
        handle_host_next(event, connection_id)
    elif msg_type == 'player.answer':
        handle_player_answer(event, connection_id, body)
    elif msg_type == 'room.check':
        handle_room_check(event, connection_id)
    # ping and unknown types are silently ignored

    return {'statusCode': 200}
