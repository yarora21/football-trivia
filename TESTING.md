# Testing the Trivia Game

## Prerequisites

- Stack is deployed (`cd infra && npx cdk deploy`)
- `wscat` installed (`npm install -g wscat`)

## 1. Create a Room

```bash
curl -X POST https://i2bl1hlmbl.execute-api.us-east-1.amazonaws.com/rooms \
  -H "Content-Type: application/json" \
  -d '{"topic": "Super Bowl history", "question_count": 5}'
```

Response: `{"room_code": "ABC12"}` — save this code.

Wait ~30 seconds for Step Functions to generate questions (Bedrock AI).

## 2. Connect as Host and Player

Open two terminals.

**Terminal 1 — Host:**
```bash
wscat -c "wss://m33kfxfhjj.execute-api.us-east-1.amazonaws.com/prod?room=ABC12&role=host&name=Host"
```

**Terminal 2 — Player:**
```bash
wscat -c "wss://m33kfxfhjj.execute-api.us-east-1.amazonaws.com/prod?room=ABC12&role=player&name=Yash"
```

## 3. Check Room is Ready

In either terminal, send:
```json
{"type": "room.check"}
```

If you get `room.ready` back, questions are generated. If not, wait a few more seconds and try again.

## 4. Start the Game

In the **host** terminal:
```json
{"type": "host.start"}
```

Both terminals will receive a `question.show` message with the first question.

## 5. Answer Questions

In the **player** terminal, submit answers:
```json
{"type": "player.answer", "question_index": 0, "choice_index": 1}
```

You'll get back `answer.received` with `is_correct` and `points`.

The game auto-advances after 15 seconds, or the host can skip ahead:
```json
{"type": "host.next"}
```

Increment `question_index` for each question (0, 1, 2, 3, 4).

## 6. Game Over

After the last question you'll receive a `game.over` message with the final leaderboard.

## 7. Verify Observability

After playing a game, check the AWS Console:

| What | Where |
|------|-------|
| X-Ray Service Map | AWS Console > X-Ray > Service Map |
| X-Ray Traces | X-Ray > Traces (click any trace for the waterfall view) |
| Dashboard | CloudWatch > Dashboards > `TriviaGameDashboard` |
| Alarms | CloudWatch > Alarms > filter by `trivia-` |
| DLQ | SQS > `trivia-advance-round-dlq` (should be empty) |
