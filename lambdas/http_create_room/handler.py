import json
import os
import random
import time
import boto3
from aws_xray_sdk.core import patch_all

patch_all()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])
sfn = boto3.client('stepfunctions')

# Exclude characters that look alike (0/O, 1/I) to avoid join-code confusion
_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def _generate_code() -> str:
    return ''.join(random.choices(_CODE_CHARS, k=5))


def handler(event, context):
    body = json.loads(event.get('body') or '{}')
    topic = body.get('topic', '').strip()
    question_count = int(body.get('question_count', 10))

    if not topic:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'topic is required'}),
        }

    room_code = _generate_code()
    ttl = int(time.time()) + 86400  # 24 hours

    table.put_item(Item={
        'pk': f'ROOM#{room_code}',
        'sk': 'META',
        'topic': topic,
        'question_count': question_count,
        'status': 'lobby',
        'current_question_index': 0,
        'created_at': int(time.time() * 1000),
        'ttl': ttl,
    })

    # Start the question generation pipeline asynchronously
    sfn.start_execution(
        stateMachineArn=os.environ['STATE_MACHINE_ARN'],
        name=f'room-{room_code}-{int(time.time())}',
        input=json.dumps({
            'room_code': room_code,
            'topic': topic,
            'question_count': question_count,
        }),
    )

    return {
        'statusCode': 202,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps({'room_code': room_code}),
    }
