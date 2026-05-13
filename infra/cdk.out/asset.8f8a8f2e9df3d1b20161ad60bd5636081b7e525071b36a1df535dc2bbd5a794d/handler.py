def handler(event, context):
    # Handles all unrouted WebSocket messages (e.g. ping heartbeats).
    # Game messages (host.start, player.answer, etc.) will be routed here
    # and dispatched by type once the game loop is built.
    return {'statusCode': 200}
