import os
import time
import boto3

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

    # Adds this person to the room's player list for broadcasting
    table.put_item(Item={
        'pk': f'ROOM#{room_code}',
        'sk': f'PLAYER#{connection_id}',
        'display_name': name,
        'joined_at': int(time.time() * 1000),
        'ttl': ttl,
    })

    return {'statusCode': 200}
