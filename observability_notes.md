# Observability Notes

## Game Critical Functions

Game critical functions are separate from the full list because they have real latency impact on players. We don't care about the latency of Step Function lambdas (run once at room creation) — but we absolutely care if ws_default or game_score_answer is slow since that's every player interaction.

---

## Difficulties and Lessons Learned

### 1. CloudWatch Math Expression Metric Limit

**Problem**: CloudWatch alarms on math expressions have a hard limit of **10 metrics**. We had 11 Lambda functions and tried to sum all their error metrics into a single alarm.

**First attempt**: One `MathExpression` summing all 11 — rejected immediately (`TooManyMetricsInMathExpression`).

**Second attempt**: Nested two `MathExpression`s (5 + 6 metrics each) inside a parent expression. Thought this would work since each sub-expression was under 10. But CloudWatch **flattens nested expressions** — it still saw all 11 underlying metrics and rejected it. The deploy rolled back.

**Solution**: Used a `CompositeAlarm` instead. Created 11 individual alarms (one per Lambda, each with just 1 metric), then combined them with `AlarmRule.anyOf(...)`. A CompositeAlarm does boolean logic on alarms, not math on metrics, so there's no metric limit.

**Lesson**: CloudWatch metric limits apply to the total flattened metric count, not the nesting depth. When you need to monitor many resources, CompositeAlarms are the right pattern.

### 2. Lambda Layer — Docker vs Local Install

**Problem**: CDK's `bundling` option for Lambda Layers uses Docker to run `pip install` inside a container matching the Lambda runtime. This ensures compiled packages are compatible. But not everyone has Docker installed.

**Solution**: Installed packages locally instead:
```bash
cd lambdas/layers/xray && pip install -r requirements.txt -t python/
```
This works because `aws-xray-sdk` is pure Python (no compiled C extensions), so it doesn't matter if it's installed on macOS vs Amazon Linux. For packages with C extensions (like `psycopg2`), you'd need Docker or a pre-built wheel.

**Lesson**: Docker bundling is the safe default, but for pure-Python packages, local install is simpler. Know which packages have native extensions.

### 3. CompositeAlarm Has No `.metric` Property

**Problem**: After switching to `CompositeAlarm`, the dashboard code referenced `lambdaErrorAlarm.metric` which doesn't exist on composite alarms. Regular alarms expose their metric, composite alarms don't (they combine alarms, not metrics).

**Solution**: Replaced the `SingleValueWidget` (which needs metrics) with an `AlarmStatusWidget` (which takes alarms directly). This actually ended up being a better widget choice — it shows alarm names with green/red status instead of raw numbers.

**Lesson**: `Alarm` and `CompositeAlarm` have different interfaces. Check what properties are available when switching between them.

### 4. `replace_all` Missed a Reference

**Problem**: When renaming `advanceQueue` to `this.advanceQueue`, used find-and-replace on `advanceQueue.` (with a dot). But one reference was `SqsEventSource(advanceQueue)` — no dot after the name — so it was missed. TypeScript caught it.

**Lesson**: Always run `tsc --noEmit` after refactoring to catch missed references. Don't rely solely on find-and-replace.

### 5. X-Ray SDK Doesn't Auto-Instrument Redis

**Problem**: `patch_all()` auto-instruments boto3, requests, urllib, sqlite3, mysql, and psycopg2. But it doesn't know about the `redis` Python library. Redis calls were invisible in traces.

**Solution**: Used `xray_recorder.in_subsegment('Redis')` to manually wrap Redis calls. This creates named subsegments that appear in the trace waterfall alongside auto-instrumented DynamoDB calls.

**Lesson**: `patch_all()` only covers AWS's curated list of libraries. For anything else, use manual subsegments.

### 6. http_create_room Missing the X-Ray Layer

**Problem**: After deploying, `http_create_room` crashed with `No module named 'aws_xray_sdk'`. We added `patch_all()` to the handler but forgot to attach the X-Ray layer — because this Lambda is defined in `api-construct.ts`, not `compute-construct.ts` where all the other Lambdas got the layer.

**Solution**: Exposed the layer as `this.xrayLayer` from the compute construct, passed it into the API construct via props, and added `layers: [props.xrayLayer]` to the function.

**Lesson**: When a shared dependency (like a layer) is needed by resources across multiple constructs, make sure every construct that needs it receives it. Easy to miss when Lambdas are spread across different files.
