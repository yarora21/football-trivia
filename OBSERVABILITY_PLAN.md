# Observability Plan

Add production-grade observability to the NFL trivia game: distributed tracing, a CloudWatch dashboard, and alerting. This turns "it works when I deploy it" into "I can diagnose a P99 latency spike across a distributed system."

---

## Layer 1: X-Ray Distributed Tracing

### What it gives us
- **Service Map**: visual graph of every service and the connections between them, with latency and error rates on each edge
- **Trace Timeline**: waterfall view for a single request showing exactly how long each hop took
- **Latency Distribution**: P50, P95, P99 across all traces

### Example trace — player submits an answer
```
[API Gateway]  2ms
  └─ [ws_default Lambda]  45ms
       ├─ [DynamoDB GetItem]  8ms         fetch current round
       ├─ [Lambda Invoke: score_answer]  30ms
       │    ├─ [Redis GET]  3ms           check answer from cache
       │    └─ [DynamoDB UpdateItem]  12ms write score
       ├─ [Lambda Invoke: broadcast]  25ms
       └─ [SQS SendMessage]  5ms         queue next round
```

### Infrastructure changes

| Resource | Change |
|----------|--------|
| All 13 Lambda functions | Add `tracing: lambda.Tracing.ACTIVE` |
| Step Functions state machine | Add `tracingEnabled: true` |
| WebSocket API stage | Enable `defaultRouteSettings` with `dataTraceEnabled` |
| HTTP API stage | Enable X-Ray tracing on the stage |

### Python Lambda changes

Lambdas that make downstream calls need the X-Ray SDK so those calls appear as subsegments.

| Lambda | Downstream calls to instrument |
|--------|-------------------------------|
| `ws_connect` | DynamoDB (put connection) |
| `ws_disconnect` | DynamoDB (delete connection, update player count) |
| `ws_default` | DynamoDB, SQS, Lambda invoke (score + broadcast) |
| `game_score_answer` | DynamoDB, Redis |
| `game_advance_round` | DynamoDB, Redis, SQS, Lambda invoke (broadcast) |
| `game_broadcast` | DynamoDB, WebSocket management API |
| `http_create_room` | DynamoDB, Step Functions |
| `sf_fetch_data` | External HTTP (football data API) |
| `sf_generate_questions` | Bedrock |
| `sf_validate_questions` | Pure compute — no patching needed |
| `sf_persist_questions` | DynamoDB |
| `sf_mark_failed` | DynamoDB |

For each of these, the change is:
```python
from aws_xray_sdk.core import patch_all
patch_all()
```
This auto-instruments boto3 (DynamoDB, SQS, Lambda, Bedrock, Step Functions) and HTTP calls.

**Redis is special** — X-Ray doesn't auto-instrument `redis-py`. We'll add a manual subsegment:
```python
from aws_xray_sdk.core import xray_recorder

with xray_recorder.in_subsegment('Redis') as subseg:
    subseg.put_metadata('operation', 'GET')
    result = redis_client.get(key)
```
This applies to `game_score_answer` and `game_advance_round` (the two VPC Lambdas using Redis).

### Packaging
Each Lambda that uses X-Ray needs `aws-xray-sdk` available. Options:
- **Lambda Layer** (preferred) — one shared layer with `aws-xray-sdk`, referenced by all Lambdas that need it
- Per-function `requirements.txt` + bundled zip

We'll go with a **Lambda Layer** to avoid duplicating the dependency 11 times.

**Build approach**: local pip install (no Docker required):
```bash
cd lambdas/layers/xray && pip install -r requirements.txt -t python/
```
The `python/` directory is gitignored. Run this before `cdk deploy` if starting fresh.

---

## Layer 2: CloudWatch Dashboard

A single dashboard named `TriviaGameDashboard` with these widget groups:

### Lambda Health (3 widgets)
| Widget | Metrics | Notes |
|--------|---------|-------|
| Errors by function | `Errors` for all 13 functions | SUM, 1-min period |
| Duration (P95) | `Duration` for game-critical functions (ws_default, score_answer, advance_round, broadcast) | P95 statistic |
| Invocations | `Invocations` for all functions | Stacked area chart |

### DynamoDB (2 widgets)
| Widget | Metrics |
|--------|---------|
| Read/Write capacity | `ConsumedReadCapacityUnits`, `ConsumedWriteCapacityUnits` for `trivia` table |
| Throttles | `ReadThrottleEvents`, `WriteThrottleEvents` |

### SQS — Advance Queue (1 widget)
| Widget | Metrics |
|--------|---------|
| Queue health | `ApproximateNumberOfMessagesVisible`, `ApproximateAgeOfOldestMessage`, `NumberOfMessagesSent` |

### Step Functions (1 widget)
| Widget | Metrics |
|--------|---------|
| Execution health | `ExecutionsStarted`, `ExecutionsSucceeded`, `ExecutionsFailed` for `RoomCreationPipeline` |

### API Gateway (2 widgets)
| Widget | Metrics |
|--------|---------|
| WebSocket API | `MessageCount`, `IntegrationError`, `ConnectCount` |
| HTTP API | `4xx`, `5xx`, `Count`, `Latency` |

### ElastiCache Redis (1 widget)
| Widget | Metrics |
|--------|---------|
| Redis health | `CurrConnections`, `CacheHitRate`, `EngineCPUUtilization` |

**Total: 10 widgets on one dashboard.**

---

## Layer 3: Alarms + SNS Alerting

### SNS Topic
- `trivia-alerts` topic with an email subscription (configurable via CDK context or environment variable)

### Alarms

| Alarm | Metric | Threshold | Period | Action |
|-------|--------|-----------|--------|--------|
| Lambda errors | SUM of `Errors` across all functions | > 0 | 5 min, 1 eval period | SNS email |
| Step Function failures | `ExecutionsFailed` | > 0 | 5 min | SNS email |
| DynamoDB throttles | `ReadThrottleEvents` + `WriteThrottleEvents` | > 0 | 5 min | SNS email |
| SQS message age | `ApproximateAgeOfOldestMessage` on advance queue | > 120 sec | 5 min | SNS email |
| High Lambda duration | P95 `Duration` on `ws_default` | > 5000 ms | 5 min | SNS email |

### Dead Letter Queue (DLQ)
The `trivia-advance-round` SQS queue currently has no DLQ. We'll add one:
- `trivia-advance-round-dlq` with `maxReceiveCount: 3`
- Alarm when `ApproximateNumberOfMessagesVisible` > 0 on the DLQ

This catches poison messages that repeatedly fail processing — without a DLQ they'd loop forever.

---

## Implementation Plan

### New file
- `infra/lib/observability-construct.ts` — contains the dashboard, alarms, SNS topic, and DLQ

### Modified files
| File | Changes |
|------|---------|
| `infra/lib/compute-construct.ts` | Add `tracing: Tracing.ACTIVE` to all Lambdas, add X-Ray Layer, add DLQ to advance queue, expose queue + DLQ references |
| `infra/lib/orchestration-construct.ts` | Add `tracingEnabled: true` to state machine |
| `infra/lib/api-construct.ts` | Enable X-Ray on API stages |
| `infra/lib/trivia-stack.ts` | Instantiate `ObservabilityConstruct`, pass in all resources |
| `lambdas/layer/xray/` | New directory — Lambda Layer with `aws-xray-sdk` |
| 11 Lambda `handler.py` files | Add `patch_all()` at top (all except `sf_validate_questions` and `ws_default` placeholder) |
| `game_score_answer/handler.py` | Add manual Redis subsegment |
| `game_advance_round/handler.py` | Add manual Redis subsegment |

### Build order
1. Create the X-Ray Lambda Layer (`lambdas/layer/xray/`)
2. Update `compute-construct.ts` — tracing + layer + DLQ
3. Update `orchestration-construct.ts` — tracing
4. Update `api-construct.ts` — tracing on stages
5. Create `observability-construct.ts` — dashboard + alarms + SNS
6. Update `trivia-stack.ts` — wire it all together
7. Update Lambda handlers — `patch_all()` + Redis subsegments
8. Deploy and verify in AWS Console (X-Ray service map, dashboard, test alarm)

---

## Key Concepts to Study

| Concept | Why it matters |
|---------|---------------|
| **Trace ID propagation** | X-Ray passes a trace header through API Gateway → Lambda → downstream calls so they all appear in one trace |
| **Segments vs subsegments** | A segment is a service's own timing; a subsegment is a call that service makes to another |
| **Active vs passive tracing** | Active = Lambda sends traces on every invocation; Passive = only if an upstream already started a trace |
| **CloudWatch metric dimensions** | Metrics are namespaced (e.g., `AWS/Lambda`) and filtered by dimensions (e.g., `FunctionName`) |
| **Alarm evaluation periods** | "5 min period, 1 evaluation period" = check once per 5 min; "5 min period, 3 evaluation periods" = must breach 3 consecutive times |
| **DLQ vs retry** | Retries are for transient failures; DLQ catches messages that fail repeatedly so they don't block the queue |
