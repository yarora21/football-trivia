import os
import boto3
from aws_xray_sdk.core import patch_all

patch_all()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])


def handler(event, context):
    connection_id = event['requestContext']['connectionId']

    # Look up which room this connection belonged to
    response = table.get_item(Key={
        'pk': f'CONN#{connection_id}',
        'sk': 'META',
    })

    item = response.get('Item')
    if not item:
        # Already cleaned up (e.g. TTL expired) — nothing to do
        return {'statusCode': 200}

    room_code = item['room_code']
    role = item.get('role', 'player')

    # Remove the connection lookup and the player entry from the room
    table.delete_item(Key={'pk': f'CONN#{connection_id}', 'sk': 'META'})
    table.delete_item(Key={'pk': f'ROOM#{room_code}', 'sk': f'PLAYER#{connection_id}'})

    # Decrement player count
    if role == 'player':
        table.update_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
            UpdateExpression='ADD player_count :neg',
            ExpressionAttributeValues={':neg': -1},
        )

    return {'statusCode': 200}
