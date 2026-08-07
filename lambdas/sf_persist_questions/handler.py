import json
import os
import time
import boto3
from aws_xray_sdk.core import patch_all

patch_all()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])

lambda_client = boto3.client('lambda')
BROADCAST_FN_NAME = os.environ.get('BROADCAST_FN_NAME', '')


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

    # Proactively push room.ready to the room's connections so the host page
    # renders the Start Game button on its own. Without this the host stays on
    # "Generating questions..." until they manually refresh (which reconnects
    # and re-runs room.check). The host is stored as a PLAYER# row, so a
    # room-wide broadcast reaches it.
    if BROADCAST_FN_NAME:
        lambda_client.invoke(
            FunctionName=BROADCAST_FN_NAME,
            InvocationType='Event',  # async — don't block the Step Function
            Payload=json.dumps({
                'room_code': room_code,
                'message': {
                    'type': 'room.ready',
                    'question_count': len(questions),
                },
            }).encode('utf-8'),
        )

    return event
