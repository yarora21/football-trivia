import os
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])


def handler(event, context):
    room_code = event.get('room_code')

    if room_code:
        table.update_item(
            Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
            UpdateExpression='SET #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'failed'},
        )

    return event
