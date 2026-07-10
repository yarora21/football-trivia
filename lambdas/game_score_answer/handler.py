import json
import os
import time
import boto3
import redis
from boto3.dynamodb.conditions import Key
from aws_xray_sdk.core import patch_all, xray_recorder

patch_all()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])

redis_client = redis.Redis(
    host=os.environ['REDIS_HOST'],
    port=6379,
    ssl=True,
    decode_responses=True,
)

BASE_POINTS = 1000
MIN_POINTS = 100
QUESTION_DURATION_MS = 15_000
TTL_SECONDS = 86400


def score(answered_at_ms, question_started_at_ms, is_correct):
    if not is_correct:
        return 0
    elapsed = answered_at_ms - question_started_at_ms
    if elapsed >= QUESTION_DURATION_MS:
        return MIN_POINTS
    fraction_remaining = 1 - (elapsed / QUESTION_DURATION_MS)
    return int(MIN_POINTS + (BASE_POINTS - MIN_POINTS) * fraction_remaining)


def handler(event, context):
    room_code = event['room_code']
    connection_id = event['connection_id']
    question_index = event['question_index']
    choice_index = event['choice_index']
    answered_at_ms = event.get('answered_at_ms', int(time.time() * 1000))

    # Check if already answered
    answered_key = f'answered:{room_code}:{question_index}'
    with xray_recorder.in_subsegment('Redis') as subseg:
        subseg.put_metadata('operation', 'SISMEMBER')
        already = redis_client.sismember(answered_key, connection_id)
    if already:
        return {'already_answered': True}

    # Get the correct answer from DynamoDB
    question = table.get_item(
        Key={'pk': f'ROOM#{room_code}', 'sk': f'Q#{question_index}'},
    ).get('Item')

    if not question:
        return {'error': 'question_not_found'}

    # Get question start time from room metadata
    room = table.get_item(
        Key={'pk': f'ROOM#{room_code}', 'sk': 'META'},
    ).get('Item', {})
    question_started_at_ms = int(room.get('question_started_at_ms', 0))

    is_correct = choice_index == int(question['correct_index'])
    points = score(answered_at_ms, question_started_at_ms, is_correct)

    # Mark as answered and update scores in Redis
    with xray_recorder.in_subsegment('Redis') as subseg:
        subseg.put_metadata('operation', 'score-update')
        redis_client.sadd(answered_key, connection_id)
        redis_client.expire(answered_key, TTL_SECONDS)

        if points > 0:
            redis_client.incrby(f'score:{room_code}:{connection_id}', points)
            redis_client.expire(f'score:{room_code}:{connection_id}', TTL_SECONDS)

        total_score = int(redis_client.get(f'score:{room_code}:{connection_id}') or 0)
        redis_client.zadd(f'leaderboard:{room_code}', {connection_id: total_score}, gt=True)
        redis_client.expire(f'leaderboard:{room_code}', TTL_SECONDS)

    # Write answer to DynamoDB for records
    table.put_item(Item={
        'pk': f'ROOM#{room_code}',
        'sk': f'ANS#{question_index}#{connection_id}',
        'choice_index': choice_index,
        'answered_at_ms': answered_at_ms,
        'is_correct': is_correct,
        'points_awarded': points,
        'ttl': int(time.time()) + TTL_SECONDS,
    })

    # Check if all players have answered.
    #
    # We derive the set of players from live data (the PLAYER# rows that exist
    # right now) rather than a maintained `player_count` counter. That counter
    # is a running +1/-1 tally on connect/disconnect, so a single lost
    # $disconnect (a dropped socket, a hard refresh) leaves it permanently high
    # and the "everyone answered" check can never fire — the game then only ever
    # advances on the 15s fallback timer. Reading ground truth self-heals: a
    # player who has left no longer has a PLAYER# row, so they can't block the
    # round. The host is excluded via the stored `role`.
    resp = table.query(
        KeyConditionExpression=Key('pk').eq(f'ROOM#{room_code}') & Key('sk').begins_with('PLAYER#'),
        ProjectionExpression='sk, #r',
        ExpressionAttributeNames={'#r': 'role'},
    )
    player_ids = {
        item['sk'].split('PLAYER#', 1)[1]
        for item in resp.get('Items', [])
        if item.get('role') == 'player'
    }

    with xray_recorder.in_subsegment('Redis') as subseg:
        subseg.put_metadata('operation', 'SMEMBERS')
        answered = redis_client.smembers(answered_key)

    all_answered = len(player_ids) > 0 and player_ids.issubset(answered)

    return {
        'is_correct': is_correct,
        'points': points,
        'total_score': total_score,
        'all_answered': all_answered,
    }
