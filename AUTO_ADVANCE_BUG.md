# Bug: Questions never auto-advance early when everyone has answered

> **Follow-up:** this fix was necessary but **not sufficient**. It made a scripted
> single-player test pass, but manual multi-tab browser testing still hung on the
> 15s timer. The true root cause was a frontend WebSocket leak creating "ghost"
> players — see [`GHOST_CONNECTION_LEAK.md`](./GHOST_CONNECTION_LEAK.md). In
> particular, the "self-healing" claim below only holds when a departing player's
> `$disconnect` actually fires; a leaked ghost never disconnects.

## Summary

The game is supposed to jump to the next question the moment **all** players have
answered, instead of always waiting out the 15-second timer. In practice it
almost always waited the full 15 seconds, even when every player had clearly
answered. The root cause was that the "did everyone answer?" decision trusted a
running counter (`player_count`) that drifts out of sync with reality. The fix
replaces that counter with a live, ground-truth count of who is actually in the
room at decision time.

## Symptom

- Player answers a question; nothing advances.
- ~15 seconds after the question appeared, it finally advances — i.e. it's the
  fallback auto-advance timer firing, not the "everyone answered" fast path.
- Reproduced reliably during local testing with a few browser tabs.

## How the feature is supposed to work

The early-advance path spans several Lambdas:

1. A player sends `player.answer` over the WebSocket.
2. `ws_default` invokes `game_score_answer` synchronously.
3. `game_score_answer` scores the answer and returns an `all_answered` flag.
4. If `all_answered` is true, `ws_default` enqueues an SQS message with
   `DelaySeconds=0`, which triggers `game_advance_round` immediately.
5. `game_advance_round` reveals the answer, broadcasts the leaderboard, and shows
   the next question.

Separately, when each question is shown, a `DelaySeconds=15` SQS message is
enqueued as a **fallback** so the game advances even if some players never
answer. Idempotency in `game_advance_round` (it only advances if the room is
still on that question index) prevents the fast path and the timer from
double-advancing.

So the early-advance only ever fires when `all_answered` comes back `true`.

## Root cause

`all_answered` was computed like this in `game_score_answer`:

```python
answer_count = redis_client.scard(answered_key)   # real: distinct answers, from Redis
player_count = int(room.get('player_count', 0))    # a running tally on the room record
all_answered = player_count > 0 and answer_count >= player_count
```

- `answer_count` is trustworthy — it counts real answers in a Redis set.
- `player_count` is **not** derived from reality. It's a counter incremented `+1`
  on every WebSocket `$connect` and decremented `-1` on every `$disconnect`
  (`ws_connect` / `ws_disconnect`).

A `+1/-1` tally is only correct if every connect is perfectly balanced by a
matching disconnect. It frequently isn't:

- **`ws.ts` reconnects with a brand-new connection ID.** Any socket close
  (network blip, idle timeout, hot reload) triggers a reconnect → a new
  `$connect` → another `+1`. The balancing `-1` depends on the *old* socket's
  `$disconnect` firing, which is not guaranteed and can be lost or delayed —
  especially when a client leaves the network abruptly (phone locks, laptop
  sleeps, tab closes uncleanly).
- **React `StrictMode`** (on in dev) deliberately mounts → unmounts → remounts
  every component, forcing an extra connect/disconnect/connect cycle per tab on
  load. It closes the socket mid-handshake, which is exactly when a `$disconnect`
  is most likely to go missing.

The net effect: `player_count` drifts **higher** than the number of players who
actually answer. Because the check is `answer_count >= player_count`, real
answers can never catch up to the inflated target, `all_answered` stays `false`
for the whole game, and only the 15-second fallback ever advances a question.

Two things make this worse than it first appears:

- **It's a shared counter.** One player with a flaky connection inflates the
  count for the *entire room*, degrading timing for everyone.
- **It never recovers.** A lost decrement poisons the counter for the rest of
  the game — there is no path back to the correct value.

> Note: `StrictMode` didn't *cause* the bug — it *exposed* it. StrictMode's whole
> job is to stress-test effect setup/cleanup so latent bugs like this surface on
> your machine instead of in front of users. The same drift happens in production
> whenever a real socket drops and reconnects; it's just rarer and harder to
> reproduce.

## How it was diagnosed

1. Traced the early-advance path backwards from the symptom to find what gates
   it: the `all_answered` flag.
2. Ruled out "message sent but delivered late" by reading the SQS queue config —
   a plain standard queue, no delivery delay, no batching window, default event
   source. A `DelaySeconds=0` message arrives in ~a second, so delivery wasn't
   the problem.
3. That left "message never sent," which happens only when `all_answered` is
   false. Its two inputs are `answer_count` (trustworthy) and `player_count`
   (a maintained counter).
4. Read `ws_connect` / `ws_disconnect` and saw the fragile `+1/-1` tally, and
   `ws.ts` / `main.tsx` for the reconnect + StrictMode churn that drives it out
   of sync.

## The fix

Stop trusting the counter; count who is actually in the room at decision time.

**1. `ws_connect` — record `role` on the player row** so the game loop can tell
players from the host (the host also has a `PLAYER#` row because it must receive
broadcasts):

```python
table.put_item(Item={
    'pk': f'ROOM#{room_code}',
    'sk': f'PLAYER#{connection_id}',
    'display_name': name,
    'role': role,            # NEW
    'joined_at': int(time.time() * 1000),
    'ttl': ttl,
})
```

**2. `game_score_answer` — decide from live data**, checking that every currently
connected player is in the answered set:

```python
from boto3.dynamodb.conditions import Key

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

answered = redis_client.smembers(answered_key)
all_answered = len(player_ids) > 0 and player_ids.issubset(answered)
```

## Why this is correct and robust

- **No accumulator to drift.** The set of `PLAYER#` rows that exist *right now*
  is the source of truth. `ws_disconnect` already deletes a player's row when
  they leave.
- **Self-healing.** If a player's connection drops mid-question, their `PLAYER#`
  row is gone, so they simply aren't in `player_ids` — the round advances instead
  of hanging forever on a ghost. The old counter could never recover from a lost
  decrement; this recovers on the very next answer.
- **Subset, not `>=`.** Checking "every connected player is in the answered set"
  is stricter and stays correct even in odd cases (e.g. a stale answer from a
  connection that has since disconnected won't falsely trigger an early advance).

## Trade-offs

- Costs one small DynamoDB `query` per answer instead of reading a single field.
  For a trivia room (a few to a few dozen players) this is negligible and indexed.
- For very large rooms the query should paginate (same pagination concern already
  fixed in `game_broadcast`). Not necessary at current scale, but worth noting.
- The `player_count` counter itself was left in place in case any UI reads it for
  a "players joined" display; it is simply no longer used for game logic.

## Files changed

- `lambdas/ws_connect/handler.py` — store `role` on the `PLAYER#` row.
- `lambdas/game_score_answer/handler.py` — compute `all_answered` from a live
  query of connected players instead of the `player_count` counter.
