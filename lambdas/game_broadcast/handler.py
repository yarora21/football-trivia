import json
import os
import boto3
from boto3.dynamodb.conditions import Key
from aws_xray_sdk.core import patch_all

patch_all()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])

WS_ENDPOINT = os.environ['WS_ENDPOINT']
apigw = boto3.client('apigatewaymanagementapi', endpoint_url=WS_ENDPOINT)


def handler(event, context):
    room_code = event['room_code']
    message = event.get('message', event)

    # Get all players in this room. A single query returns at most 1MB of
    # items, so for large rooms we must follow LastEvaluatedKey — otherwise
    # players beyond the first page never receive the message.
    items = []
    query_kwargs = {
        'KeyConditionExpression': Key('pk').eq(f'ROOM#{room_code}') & Key('sk').begins_with('PLAYER#'),
    }
    while True:
        response = table.query(**query_kwargs)
        items.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            break
        query_kwargs['ExclusiveStartKey'] = last_key

    stale_connections = []

    for item in items:
        connection_id = item['sk'].replace('PLAYER#', '')
        try:
            apigw.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps(message).encode('utf-8'),
            )
        except apigw.exceptions.GoneException:
            stale_connections.append(connection_id)
        except Exception as e:
            print(f'Failed to send to {connection_id}: {e}')

    # Clean up stale connections
    for connection_id in stale_connections:
        try:
            table.delete_item(Key={'pk': f'ROOM#{room_code}', 'sk': f'PLAYER#{connection_id}'})
            table.delete_item(Key={'pk': f'CONN#{connection_id}', 'sk': 'META'})
        except Exception as e:
            print(f'Failed to clean up {connection_id}: {e}')

    return {'sent': len(items) - len(stale_connections)}
