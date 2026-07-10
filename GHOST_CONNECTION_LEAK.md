# Bug: "Ghost" WebSocket connections break auto-advance (the real root cause)

## Summary

This is the follow-up to [`AUTO_ADVANCE_BUG.md`](./AUTO_ADVANCE_BUG.md). That first
fix replaced a drifting `player_count` counter with a live query of `PLAYER#`
rows — and it made a scripted single-player test pass. But **manual browser
testing still hung on the 15-second timer**. The true root cause turned out to be
a **frontend WebSocket leak**: every browser tab was silently opening *two*
connections and leaking one live "ghost" that never answers. Because the backend
correctly counts every connected player, those ghosts made "did everyone answer?"
impossible to satisfy. The fix is in the client WebSocket hook, not the backend.

## Symptom

- Scripted test with a raw `websocket-client` (one clean connection) → auto-advance
  worked, ~1.6s.
- Real browser, multiple player tabs, all players answered → still waited the full
  15 seconds every question.

The gap between those two is the whole story: the browser does something the raw
client does not — it runs React **StrictMode**, which mounts → unmounts → remounts
each component in dev.

## How it was diagnosed

A temporary log line was added to `game_score_answer` printing the decision inputs:

```
ALL_ANSWERED_CHECK {"room":"M575L","q":0,
  "player_ids":[6 connection ids],
  "answered":[up to 3 connection ids],
  "all_answered":false}
```

Six players were expected to answer, but only three ever did. Two more checks
made the cause unambiguous:

**1. The `PLAYER#` rows — every client opened two connections ~1s apart:**

| name    | connections | created (ms)          | gap    |
|---------|-------------|-----------------------|--------|
| player1 | `mq`, `nS`  | …669592 / …669854     | 0.26s  |
| playr2  | `oO`, `ou`  | …672814 / …674358     | 1.5s   |
| player3 | `p6`, `qO`  | …678174 / …679194     | 1.0s   |
| Host    | `uM`, `ug`  | …691894 / …692894     | 1.0s   |

Three real players, but **six** player-role rows. (The role filter worked: the
Host's two connections were correctly excluded from `player_ids`.)

**2. A liveness probe** (`apigatewaymanagementapi post-to-connection` to each id)
returned **ALIVE for all six** — including the three that never answered. So the
ghosts were not dead sockets; they were **live, half-open connections**, which is
exactly why `game_broadcast`'s `GoneException` (410) cleanup never removed them.

## Root cause

In `frontend/src/lib/ws.ts`, the connection was set up in a `useEffect`. When
React StrictMode (or any fast unmount/remount, or a quick route change) tears the
effect down while the socket is still completing its handshake, two things went
wrong:

1. **The throwaway socket opened *after* cleanup ran.** Its `onopen` then fired
   and did real work — it sent `room.check` (so the server had already recorded
   the `$connect` / `PLAYER#` row) and it started a 30-second heartbeat
   `setInterval`. Nothing ever closed this socket, so it stayed open.
2. **The heartbeat kept it alive forever.** The heartbeat was stored on a shared
   `useRef` that the *real* second connection immediately overwrote, so the
   throwaway socket's interval became orphaned — running, pinging every 30s, and
   never cleared. That keepalive is why API Gateway never saw the socket go idle
   and never fired `$disconnect`.

Net result: one **live ghost player per tab**, permanently. Since the backend's
"everyone answered" check counts every connected player (correctly), the ghosts
could never answer and the check could never pass — so only the 15s fallback
timer ever advanced the game.

### Why the earlier `AUTO_ADVANCE_BUG.md` fix didn't catch it

That fix removed reliance on the drifting counter by counting live `PLAYER#` rows
instead. But a ghost connection *has* a live `PLAYER#` row — it's a real, open
connection, not a stale record. Counting rows accurately still counts the ghost.
The doc's "self-healing" claim only holds when a departing player's `$disconnect`
actually fires; these ghosts never disconnected, so nothing healed. The real
problem was upstream, in the client creating the ghost in the first place.

## The fix

`frontend/src/lib/ws.ts` — make the hook clean up correctly so it can never leak
a socket or a heartbeat.

**1. Close a socket that opens after teardown.** `onopen` now checks a per-effect
`closed` flag; if the effect was already torn down, it closes the socket
immediately (a clean close → `$disconnect` fires → the `PLAYER#` row is removed)
instead of registering and starting a heartbeat:

```js
ws.onopen = () => {
  if (closed) {      // effect torn down mid-handshake (StrictMode / fast route change)
    ws.close();      // clean close -> $disconnect -> no ghost
    return;
  }
  ...
  heartbeat = setInterval(/* ping */, HEARTBEAT_INTERVAL_MS);
};
```

**2. Keep per-connection state in effect-local variables, not shared refs**, so an
overlapping throwaway effect instance can't clobber the real one's heartbeat /
reconnect timer, and every timer is cleared on both `onclose` and cleanup:

```js
useEffect(() => {
  let closed = false;
  let heartbeat = null;         // this socket's keepalive
  let reconnectTimer = null;

  function connect() { /* ... assigns heartbeat / reconnectTimer ... */ }
  connect();

  return () => {                 // cleanup
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    wsRef.current?.close();
  };
}, [room, role, name]);
```

The previous `unmountedRef` and `heartbeatRef` refs were removed — they were the
shared state that allowed the clobbering.

## Why this is the correct fix

- **It works with StrictMode left on.** StrictMode wasn't the bug; it was the
  messenger that exposed a real lifecycle leak. The hook is now genuinely
  StrictMode-safe rather than silenced by turning StrictMode off.
- **It removes the ghost at the source.** A tab now results in exactly one live
  connection; the throwaway one closes itself cleanly and its row is removed.
- **It also hardens production.** The same leak could occur on a real
  mid-handshake network drop; this prevents it regardless of cause.
- **No backend change required.** The backend's live-player count was already
  correct — it was faithfully counting connections that should never have
  existed.

## Verification

- A temporary `ALL_ANSWERED_CHECK` log was added to `game_score_answer` during
  debugging (printing `player_ids`, `answered`, and `all_answered`). It was what
  exposed the 6-vs-3 mismatch, and has since been removed.
- After the fix, that check should show `player_ids` equal to the number of real
  tabs and `all_answered: true` once every real player has answered, with an
  immediate advance instead of the 15s wait.
- Note: the fix is client-side, so any tab open from before the fix keeps running
  the leaky code (and its ghost). All tabs must be hard-reloaded to pick up the
  new `ws.ts`.

## Files changed

- `frontend/src/lib/ws.ts` — close sockets that open after teardown; move
  heartbeat/reconnect state to per-effect locals; remove the shared
  `unmountedRef` / `heartbeatRef`.
