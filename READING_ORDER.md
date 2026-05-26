# Codebase Reading Order

Read in this order to understand the project from the ground up. Start with the spec, then infrastructure, then follow the data flow from room creation through the game loop to the frontend.

## 1. Spec
- `SPEC.md` — understand what you're building before reading any code

## 2. Infrastructure (AWS CDK)
- `infra/lib/trivia-stack.ts` — entry point, shows how all pieces connect
- `infra/lib/data-stack.ts` — DynamoDB table, VPC, Redis setup
- `infra/lib/compute-stack.ts` — all Lambda definitions, permissions, SQS queue
- `infra/lib/api-stack.ts` — WebSocket + HTTP API wiring
- `infra/lib/orchestration-stack.ts` — Step Functions state machine

## 3. Room Creation
- `lambdas/http_create_room/handler.py` — where a game begins (POST /rooms)

## 4. Question Generation Pipeline (Step Functions)
- `lambdas/sf_fetch_data/handler.py` — fetch live ESPN NFL data
- `lambdas/sf_generate_questions/handler.py` — generate questions via Amazon Bedrock
- `lambdas/sf_validate_questions/handler.py` — validate question format and quality
- `lambdas/sf_persist_questions/handler.py` — write questions to DynamoDB, mark room ready

## 5. WebSocket Connection Lifecycle
- `lambdas/ws_connect/handler.py` — player/host connects
- `lambdas/ws_disconnect/handler.py` — player/host disconnects

## 6. Game Loop
- `lambdas/ws_default/handler.py` — the game router (most important Lambda), handles host.start, host.next, player.answer, room.check
- `lambdas/game_score_answer/handler.py` — scoring logic with Redis
- `lambdas/game_broadcast/handler.py` — WebSocket message delivery to all players
- `lambdas/game_advance_round/handler.py` — auto-advance after 15s (SQS triggered)

## 7. Frontend
- `frontend/src/lib/types.ts` — message contracts between frontend and backend
- `frontend/src/lib/ws.ts` — WebSocket hook with reconnection and heartbeat
- `frontend/src/lib/api.ts` — HTTP API client
- `frontend/src/routes/Home.tsx` — landing page (host/join)
- `frontend/src/routes/HostRoom.tsx` — host game view
- `frontend/src/routes/PlayRoom.tsx` — player game view
