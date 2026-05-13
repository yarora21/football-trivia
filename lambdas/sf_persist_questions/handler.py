import os
import time
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])


def handler(event, context):
    room_code = event['room_code']
    questions = event['questions']
    ttl = int(time.time()) + 86400  # 24 hours

    with table.batch_writer() as batch:
        for i, q in enumerate(questions):
            batch.put_item(Item={
                'pk': f'ROOM#{room_code}',
                'sk': f'Q#{i}',
                'prompt': q['prompt'],
                'choices': q['choices'],
                'correct_index': q['correct_index'],
                'difficulty': q['difficulty'],
                'ttl': ttl,
            })

    # Flip room status to ready so the host knows questions are available
    table.update_item(
        Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
        UpdateExpression='SET #s = :s',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': 'ready'},
    )

    return event
