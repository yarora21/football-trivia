# NFL Trivia — Real-Time Multiplayer Game

A real-time multiplayer American football (NFL) trivia game with AI-generated questions. Hosts create rooms with a topic, AI generates fresh questions per room, and players compete on a live, speed-weighted leaderboard.

This spec is intended to be handed directly to Claude Code as the source of truth for building the project end-to-end.

---

## 1. Goals & non-goals

**Goals**
- Real-time multiplayer experience with sub-second leaderboard updates
- AI-generated questions unique to each room (no static question bank)
- Fully serverless on AWS — no EC2, no containers
- Reproducible infrastructure via AWS CDK
- Cleanly demoable on a laptop and phone simultaneously

**Non-goals (v1)**
- Authentication / user accounts (rooms are anonymous, identified by code)
- Mobile native apps (responsive web only)
- Persistence beyond 24 hours (rooms auto-expire)
- Internationalization
- Payments or monetization

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, deployed to S3 + CloudFront |
| Lambda runtime | Python 3.12 |
| Lambda framework | Plain `boto3` + AWS Lambda Powertools for Python |
| Real-time transport | API Gateway WebSocket API |
| Orchestration | AWS Step Functions (Standard workflow) |
| Persistent storage | DynamoDB (single-table design) |
| In-memory storage | ElastiCache for Redis (Serverless) |
| AI | Amazon Bedrock — Claude Sonnet 4.5 |
| External data | ESPN public NFL API (no auth required) |
| Networking | VPC with private subnets for Redis-touching Lambdas; VPC endpoints for DynamoDB (gateway, free), `execute-api`, and SQS |
| Infrastructure as code | AWS CDK (TypeScript) |
| Question timer | SQS (delay queue, `DelaySeconds=15`) |
| Observability | CloudWatch Logs + Metrics |

---

## 3. Repository layout

```
football-trivia/
├── infra/                          # AWS CDK app (TypeScript)
│   ├── bin/app.ts
│   ├── lib/
│   │   ├── trivia-stack.ts         # Main stack composing all resources
│   │   ├── api-stack.ts            # API Gateway WebSocket + HTTP
│   │   ├── data-stack.ts           # DynamoDB + Redis
│   │   ├── compute-stack.ts        # Lambda functions
│   │   └── orchestration-stack.ts  # Step Functions state machine
│   ├── package.json
│   └── cdk.json
├── lambdas/                        # Python Lambda source
│   ├── shared/                     # Shared modules (imported as a layer)
│   │   ├── ddb.py                  # DynamoDB helpers
│   │   ├── redis_client.py         # Redis connection + helpers
│   │   ├── ws.py                   # API Gateway Management API helpers
│   │   ├── models.py               # Pydantic models for events
│   │   └── __init__.py
│   ├── ws_connect/                 # $connect handler
│   │   └── handler.py
│   ├── ws_disconnect/              # $disconnect handler
│   │   └── handler.py
│   ├── ws_default/                 # Default route — receives client messages
│   │   └── handler.py
│   ├── http_create_room/           # POST /rooms — kicks off Step Function
│   │   └── handler.py
│   ├── sf_fetch_data/              # Step Functions task — fetch NFL data
│   │   └── handler.py
│   ├── sf_generate_questions/      # Step Functions task — Bedrock call
│   │   └── handler.py
│   ├── sf_validate_questions/      # Step Functions task — sanity check
│   │   └── handler.py
│   ├── sf_persist_questions/       # Step Functions task — write to DDB
│   ├── sf_mark_failed/             # Step Functions task — flip room status to failed
│   │   └── handler.py
│   ├── game_advance_round/         # Triggered by SQS delay queue (DelaySeconds=15)
│   │   └── handler.py
│   ├── game_score_answer/          # Scores an incoming answer
│   │   └── handler.py
│   ├── game_broadcast/             # Fans out a message to all room players
│   │   └── handler.py
│   └── requirements.txt
├── frontend/                       # React + Vite app
│   ├── src/
│   │   ├── App.tsx
│   │   ├── routes/
│   │   │   ├── Home.tsx            # Landing — host or join
│   │   │   ├── HostRoom.tsx        # Host view — controls + live leaderboard
│   │   │   └── PlayRoom.tsx        # Player view — answer buttons + score
│   │   ├── lib/
│   │   │   ├── ws.ts               # WebSocket client + reconnection
│   │   │   ├── api.ts              # HTTP client for room creation
│   │   │   └── types.ts            # Shared TypeScript types
│   │   ├── components/
│   │   │   ├── Leaderboard.tsx
│   │   │   ├── QuestionCard.tsx
│   │   │   ├── Countdown.tsx
│   │   │   └── JoinCode.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── README.md
└── .gitignore
```

---

## 4. Data model

### 4.1 DynamoDB single-table design

**Table name:** `trivia`

**Primary key:** `pk` (partition) + `sk` (sort)

**TTL attribute:** `ttl` — all items expire 24 hours after creation.

| Item type | pk | sk | Other attributes |
|---|---|---|---|
| Room metadata | `ROOM#<code>` | `META` | `topic`, `status` (`lobby`/`playing`/`finished`), `host_connection_id`, `current_question_index`, `created_at`, `ttl` |
| Question | `ROOM#<code>` | `Q#<index>` | `prompt`, `choices` (list of 4 strings), `correct_index` (0-3), `difficulty` (`easy`/`medium`/`hard`) |
| Player | `ROOM#<code>` | `PLAYER#<connection_id>` | `display_name`, `joined_at`, `ttl` |
| Connection lookup | `CONN#<connection_id>` | `META` | `room_code`, `role` (`host`/`player`), `ttl` |
| Answer | `ROOM#<code>` | `ANS#<question_index>#<connection_id>` | `choice_index`, `answered_at_ms`, `is_correct`, `points_awarded` |

**Why single table?** One table means one set of IAM permissions, one CloudFormation resource, predictable hot partitions per room. Querying a single room is a single `Query` on `pk = ROOM#<code>`.

**Why CONN# lookup?** When a WebSocket disconnects, we only have the connection ID. We need an O(1) lookup to know which room they were in.

### 4.2 Redis keys (ElastiCache)

| Key pattern | Type | Purpose |
|---|---|---|
| `score:<room_code>:<connection_id>` | INTEGER | Total score for a player. Atomic `INCRBY`. |
| `leaderboard:<room_code>` | SORTED SET | Player connection IDs scored by total points. `ZADD GT` for monotonic updates, `ZREVRANGE` to read top N. |
| `answered:<room_code>:<question_index>` | SET | Connection IDs that have answered the current question. Used to detect when everyone is in. |

**TTL on every key:** 24 hours (`EXPIRE`).

**Why Redis vs. just DynamoDB?** DynamoDB cannot do an atomic `INCR` and return a sorted leaderboard in a single round trip. Redis can. For 20 players answering within seconds of each other, this matters.

---

## 5. API contracts

### 5.1 HTTP API

**`POST /rooms`** — host creates a room

Request:
```json
{ "topic": "Premier League 2024 season", "question_count": 10 }
```

Response (202 Accepted):
```json
{ "room_code": "AB12C", "execution_arn": "arn:aws:states:..." }
```

The Step Function runs asynchronously. The host polls or subscribes to the WebSocket for `room.ready` events.

**`GET /rooms/<code>/status`** — poll fallback

Response:
```json
{ "status": "generating" | "ready" | "failed", "error": null }
```

### 5.2 WebSocket protocol

Connection URL: `wss://<api-id>.execute-api.<region>.amazonaws.com/prod?room=<code>&role=<host|player>&name=<display_name>`

All messages are JSON with a `type` field.

**Client → server messages:**

| Type | Payload | Sent by |
|---|---|---|
| `host.start` | `{}` | Host. Begins question 1. |
| `host.next` | `{}` | Host. Advances to next question. |
| `player.answer` | `{ "question_index": 3, "choice_index": 2 }` | Player. |

**Server → client messages:**

| Type | Payload | Sent to |
|---|---|---|
| `room.ready` | `{ "question_count": 10 }` | All in room |
| `question.show` | `{ "index": 0, "prompt": "...", "choices": [...], "deadline_ms": 1735000000000 }` | All in room |
| `answer.received` | `{ "is_correct": true, "points": 850 }` | Single player |
| `leaderboard.update` | `{ "top": [{ "name": "Alex", "score": 2400 }, ...] }` | All in room |
| `question.reveal` | `{ "index": 0, "correct_index": 2, "stats": { ... } }` | All in room |
| `game.over` | `{ "final_leaderboard": [...] }` | All in room |
| `room.state` | `{ "status": "lobby"\|"playing"\|"finished", "current_question_index": 2, "question": { "prompt": "...", "choices": [...], "deadline_ms": 1735000000000 }, "leaderboard": [...] }` — `question` and `deadline_ms` omitted if status is not `playing` | Reconnecting client |
| `error` | `{ "code": "...", "message": "..." }` | Single client |

### 5.3 Scoring formula

Implemented in `game_score_answer/handler.py`:

```python
BASE_POINTS = 1000
MIN_POINTS = 100
QUESTION_DURATION_MS = 15_000

def score(answered_at_ms: int, question_started_at_ms: int, is_correct: bool) -> int:
    if not is_correct:
        return 0
    elapsed = answered_at_ms - question_started_at_ms
    if elapsed >= QUESTION_DURATION_MS:
        return MIN_POINTS
    fraction_remaining = 1 - (elapsed / QUESTION_DURATION_MS)
    return int(MIN_POINTS + (BASE_POINTS - MIN_POINTS) * fraction_remaining)
```

Faster correct answers score more. Wrong answers score zero. Answering after the deadline scores `MIN_POINTS` if correct.

---

## 6. Step Functions state machine

**Name:** `RoomCreationPipeline`
**Type:** Standard

```
StartAt: FetchFootballData
States:
  FetchFootballData:
    Type: Task
    Resource: <sf_fetch_data Lambda ARN>
    Retry: [{ ErrorEquals: [States.TaskFailed], MaxAttempts: 2, BackoffRate: 2 }]
    Catch: [{ ErrorEquals: [States.ALL], Next: MarkRoomFailed }]
    Next: GenerateQuestions

  GenerateQuestions:
    Type: Task
    Resource: <sf_generate_questions Lambda ARN>
    TimeoutSeconds: 60
    Retry: [{ ErrorEquals: [States.TaskFailed], MaxAttempts: 1 }]
    Catch: [{ ErrorEquals: [States.ALL], Next: MarkRoomFailed }]
    Next: ValidateQuestions

  ValidateQuestions:
    Type: Task
    Resource: <sf_validate_questions Lambda ARN>
    Catch: [{ ErrorEquals: [QuestionsFailedValidation], Next: GenerateQuestions }]
    Next: PersistQuestions

  PersistQuestions:
    Type: Task
    Resource: <sf_persist_questions Lambda ARN>
    Next: NotifyReady

  NotifyReady:
    Type: Task
    Resource: <game_broadcast Lambda ARN>
    Parameters: { "type": "room.ready", "room_code.$": "$.room_code" }
    End: true

  MarkRoomFailed:
    Type: Task
    Resource: <sf_mark_failed Lambda ARN>
    End: true
```

The retry from `ValidateQuestions` back to `GenerateQuestions` is intentional — if Bedrock returned bad questions (duplicates, missing answers, factually impossible), we regenerate once before giving up.

---

## 7. Bedrock prompt — question generation

`sf_generate_questions/handler.py` calls Claude Sonnet 4.5 via Bedrock with the following prompt structure:

**System prompt:**
```
You are an American football (NFL) trivia question writer. Generate factually accurate, unambiguous multiple-choice questions about American football. Output strict JSON only — no preamble, no markdown.

Important: "Football" in this context always means American football / NFL. Never produce questions about soccer, association football, or any other sport.
```

**User prompt template:**
```
Generate {n} NFL trivia questions about: "{topic}".

Use the following grounding facts as your source of truth. Do not invent facts not supported by these:
{grounding_facts}

Requirements:
- Each question has exactly 4 answer choices.
- Exactly one choice is correct.
- Mix of difficulties: 30% easy, 50% medium, 20% hard.
- Avoid questions answerable by general knowledge alone — they must require NFL knowledge.
- No "all of the above" or "none of the above".
- Question prompts under 200 characters. Choices under 80 characters.
- Use standard NFL terminology (touchdowns, sacks, interceptions, yards, etc.) — not soccer terms.

Return JSON matching this schema:
{
  "questions": [
    {
      "prompt": "string",
      "choices": ["A", "B", "C", "D"],
      "correct_index": 0,
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}
```

`{grounding_facts}` is populated by `sf_fetch_data` from ESPN's public NFL API — recent game scores, season leaders (passing yards, rushing yards, receiving yards, sacks), team standings, and playoff brackets for the relevant timeframe.

### 7.1 ESPN API endpoints (no auth)

These are unofficial but stable public endpoints. No API key needed.

| Endpoint | Returns |
|---|---|
| `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` | Current week's games + scores |
| `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD` | Specific date's games |
| `https://site.api.espn.com/apis/site/v2/sports/football/nfl/standings` | Conference and division standings |
| `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/<team_id>` | Team roster, schedule |
| `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/<team_id>/roster` | Full roster with player details |
| `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/<year>/types/2/leaders` | Season statistical leaders |

`sf_fetch_data` should pick the relevant endpoints based on the topic string. A simple keyword router is fine: topic mentions a team name → fetch that team's roster + recent games. Topic mentions a season → fetch that season's leaders + standings. Topic mentions "Super Bowl" → use a small static dataset of Super Bowl winners (rarely changes, no need to hit an API). If no keyword matches, fall back silently to current standings + scoreboard as generic grounding context — never error on the topic.

---

## 8. Validation rules

`sf_validate_questions/handler.py` rejects (raising `QuestionsFailedValidation`) if any of:

- JSON parse fails
- Number of questions ≠ requested
- Any question has ≠ 4 choices
- Any `correct_index` is not in `[0, 3]`
- Any two choices in a question are identical (case-insensitive, trimmed)
- Any prompt > 200 chars or any choice > 80 chars
- Two questions have identical prompts
- More than 50% of questions share a difficulty (sanity check on the mix)

---

## 9. Frontend behavior

### 9.1 Routes

| Path | Component | Purpose |
|---|---|---|
| `/` | `Home` | Two buttons: "Host a game" and "Join a game" |
| `/host/:code` | `HostRoom` | Shows join code QR, player list, live leaderboard, "Start" and "Next question" buttons |
| `/play/:code` | `PlayRoom` | Shows current question, 4 answer buttons, personal score |

### 9.2 WebSocket lifecycle (client)

- On mount, open WebSocket with `?room=<code>&role=<host|player>&name=<name>`
- Reconnect with exponential backoff on close (max 30s)
- Heartbeat ping every 30s to prevent idle disconnect
- On reconnect, server sends current state (`room.state`) so client resyncs

### 9.3 Aesthetic direction

- Bold and editorial — sports-magazine vibes (think The Athletic, ESPN's better moments), not generic startup
- Pick a distinctive display font (e.g. `Bricolage Grotesque`, `Fraunces`, or `IBM Plex Mono` for accents)
- Strong color palette: deep field green or charcoal + a single vivid accent (electric yellow, hazard orange, or NFL-red)
- Big numbers for the leaderboard. Animated count-ups on score changes.
- Don't use generic UI library defaults. No purple-gradient-on-white.

---

## 10. Build order

Build in this order so each step is independently testable. Don't move on until the current step's smoke test passes.

1. **CDK skeleton** — empty stacks, `cdk synth` works, `cdk deploy` creates an empty DynamoDB table and a placeholder Lambda. Verify in console.
2. **WebSocket scaffold** — `$connect` writes to DynamoDB, `$disconnect` deletes. Verify with `wscat`.
3. **Frontend home + WebSocket connect** — minimal React app that opens a WebSocket and shows "connected".
4. **HTTP create room (mock)** — endpoint returns a hardcoded `room_code`. No Step Function yet.
5. **Step Function skeleton** — all four task Lambdas return mocks. State machine runs end-to-end with fake data.
6. **ESPN API fetch** — real API call in `sf_fetch_data`. Test with a single team and a single season. Verify the response shape before wiring to Bedrock.
7. **Bedrock integration** — real call in `sf_generate_questions`. Print output, eyeball it.
8. **Validation** — implement and test every rule with synthetic bad inputs.
9. **Redis integration** — ElastiCache provisioned, vote handler increments scores.
10. **Live broadcast** — `game_broadcast` reads connections from DDB, calls `post_to_connection` on each.
11. **Game loop** — `host.start` triggers question 1. Each question send enqueues an SQS message with `DelaySeconds=15`; `game_advance_round` is triggered by SQS and closes the question server-side. The host's "Next question" button also triggers advance early (server validates `now >= deadline_ms`). `game_advance_round` is idempotent — it checks the current question index before acting to guard against double-fires.
12. **Frontend game UI** — host and player views, fully wired.
13. **Polish** — animations, error states, reconnection, mobile responsive.

---

## 11. Local development

- `infra/`: `npm install`, `npm run cdk -- synth`, `npm run cdk -- deploy`
- `lambdas/`: `pip install -r requirements.txt -t shared/` for the Lambda layer
- `frontend/`: `npm install`, `npm run dev`
- Use `aws logs tail /aws/lambda/<name> --follow` for live logs

For local Lambda testing, use the `aws-lambda-runtime-interface-emulator` with mocked events from `lambdas/<fn>/test_events/`.

---

## 12. Cost guardrails

This project should cost under $15/month if left running (VPC interface endpoints account for ~$14.60/month) and under $1/month if torn down between demos.

- Use ElastiCache **Serverless** Redis (pay per request, not provisioned)
- Only `game_score_answer`, `game_advance_round`, and `game_broadcast` run inside the VPC (Redis access). All other Lambdas run outside the VPC and reach AWS services over the internet. `sf_fetch_data` runs outside the VPC intentionally — it needs internet access for the ESPN API and does not touch Redis.
- Two VPC interface endpoints: `execute-api` (for `post_to_connection`) and SQS. DynamoDB uses a free gateway endpoint.
- DynamoDB on-demand billing
- Bedrock — only invoked at room creation, ~$0.01 per room with Sonnet 4.5
- Set CloudWatch Logs retention to 7 days
- Add a CDK destroy script: `npm run cdk -- destroy` tears it all down

---

## 13. Out of scope (deliberately deferred)

- Authentication
- Persistent user profiles
- Question difficulty adaptation per player
- Multi-region deployment
- Custom domain (use the default API Gateway URL)
- Anti-cheat (e.g. preventing answer sniffing via DevTools)

These are interview talking points — "things I'd build next" — not v1 requirements.

---

## 14. Definition of done

- A user on a laptop can create a room, get a join code, share it
- Two users on phones can join, see questions appear simultaneously, answer
- Leaderboard updates within 500ms of any answer
- Game completes cleanly, shows final results
- `cdk destroy` cleanly removes everything
- README has a 1-page architecture diagram and the commands to deploy
