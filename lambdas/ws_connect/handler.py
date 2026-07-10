import os
import time
import boto3
from aws_xray_sdk.core import patch_all

patch_all()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])


def handler(event, context):
    print('EVENT:', event)
    connection_id = event['requestContext']['connectionId']
    query_params = event.get('queryStringParameters') or {}

    room_code = query_params.get('room')
    role = query_params.get('role', 'player')
    name = query_params.get('name', 'Anonymous')

    if not room_code:
        # Returning 400 causes API Gateway to reject the connection
        return {'statusCode': 400}

    ttl = int(time.time()) + 86400  # 24 hours

    # O(1) lookup at disconnect time — we only know the connection ID then
    table.put_item(Item={
        'pk': f'CONN#{connection_id}',
        'sk': 'META',
        'room_code': room_code,
        'role': role,
        'ttl': ttl,
    })

    # Adds this person to the room's player list for broadcasting.
    # `role` is stored here so the game loop can count actual players
    # (excluding the host) from live data rather than a running counter.
    table.put_item(Item={
        'pk': f'ROOM#{room_code}',
        'sk': f'PLAYER#{connection_id}',
        'display_name': name,
        'role': role,
        'joined_at': int(time.time() * 1000),
        'ttl': ttl,
    })

    # Track player count on the room (hosts don't count)
    if role == 'player':
        table.update_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
            UpdateExpression='ADD player_count :one',
            ExpressionAttributeValues={':one': 1},
        )

    return {'statusCode': 200}
