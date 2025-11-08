# Testing Error-Handling Patterns

This guide shows how to validate each pattern works correctly in real-world scenarios.

## Quick Start

### Option 1: Run All Tests (Automated)
```bash
# From the Trigger.dev dashboard (http://localhost:3030)
# Navigate to "Test tasks" → "agents.test-all-patterns"
# Click "Test" and use payload:
{
  "skipEscalation": true
}
```

This will trigger all 4 patterns and report results.

### Option 2: Test Individual Patterns

Navigate to http://localhost:3030 and test each pattern:

---

## 1. Circuit Breaker Pattern

**Task ID**: `agents.circuit-breaker`

### Test Case 1: Normal Load (Should Succeed)
```json
{
  "calls": 10,
  "cooldownMs": 3000
}
```
**Expected**: Mix of successes/failures (~70% success rate), circuit stays closed

### Test Case 2: High Failure Rate (Should Trip)
```json
{
  "calls": 25,
  "cooldownMs": 5000
}
```
**Expected**: After ~5-8 consecutive failures, circuit opens and subsequent calls fail fast with 503

### Test Case 3: Cooldown Recovery
```json
{
  "calls": 30,
  "cooldownMs": 2000
}
```
**Expected**: Circuit trips, then auto-recovers after cooldown

### Real-World Validation Checklist
- [ ] Circuit opens after consecutive failures
- [ ] Subsequent calls fail fast (503) while open
- [ ] Circuit auto-closes after cooldown
- [ ] `consecutivelyTripped` flag accurately reflects state
- [ ] `openUntil` timestamp is set correctly

### Production Adaptations
```typescript
// Replace in-memory state with Redis:
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

// Track state per service
const key = `circuit:${serviceName}`;
const consecutive = await redis.get<number>(key) || 0;
const openedUntil = await redis.get<number>(`${key}:open`) || 0;

// Update state
if (failed) {
  await redis.set(key, consecutive + 1);
  if (consecutive >= maxConsecutive) {
    await redis.set(`${key}:open`, Date.now() + cooldown);
  }
} else {
  await redis.del(key);
}
```

---

## 2. Partial Success Pattern

**Task ID**: `agents.partial-success`

### Test Case 1: Small Batch
```json
{
  "items": ["a", "b", "c"]
}
```
**Expected**: Some items may fail with TOKEN_LIMIT or RATE_LIMIT, partial results returned

### Test Case 2: Large Batch
```json
{
  "items": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]
}
```
**Expected**: Multiple failures expected, detailed per-item tracking

### Test Case 3: Idempotency Check
Run the same payload twice:
```json
{
  "items": ["test1", "test2", "test3"]
}
```
**Expected**: Results may differ (due to randomness in this demo), but in production with proper idempotency keys, results should be identical

### Real-World Validation Checklist
- [ ] Failed items are tracked with reasons
- [ ] Token limit errors don't retry
- [ ] Rate limit errors retry up to maxAttempts
- [ ] Attempt counter is accurate per item
- [ ] Overall success/failure counts are correct

### Production Adaptations
```typescript
// Add idempotency with DynamoDB/Postgres
const existingResult = await db.result.findUnique({
  where: { idempotencyKey: `batch:${batchId}:item:${id}` }
});

if (existingResult) {
  return existingResult; // Skip processing
}

// Process and store
const result = await processItem(id);
await db.result.create({
  data: {
    idempotencyKey: `batch:${batchId}:item:${id}`,
    itemId: id,
    success: result.ok,
    attempts: result.attempts,
    reason: result.reason,
  }
});
```

---

## 3. Human Escalation Pattern

**Task ID**: `agents.human-escalation`

### Test Case 1: Escalation Trigger
```json
{
  "data": "Complex scenario requiring human review"
}
```
**Expected Output**:
```json
{
  "ok": false,
  "escalated": true,
  "message": "Escalated for review. Re-run with resumeToken to continue.",
  "resumeToken": "RESUME-123",
  "durationMs": 5
}
```

### Test Case 2: Resume After Escalation
After getting the resumeToken from Test Case 1:
```json
{
  "data": "Complex scenario requiring human review",
  "resumeToken": "RESUME-123"
}
```
**Expected Output**:
```json
{
  "ok": true,
  "resumed": true,
  "durationMs": 3
}
```

### Test Case 3: Invalid Token
```json
{
  "data": "Test data",
  "resumeToken": "INVALID-TOKEN"
}
```
**Expected**: Task aborts with error "Invalid resume token"

### Real-World Validation Checklist
- [ ] Escalation triggers correctly on first run
- [ ] resumeToken is generated and returned
- [ ] Webhook/notification sent (in production)
- [ ] Second run with valid token succeeds
- [ ] Invalid token throws AbortTaskRunError

### Production Adaptations
```typescript
if (!payload.resumeToken) {
  // Generate secure token
  const resumeToken = crypto.randomUUID();

  // Store in DB with expiry
  await db.escalation.create({
    data: {
      taskRunId: context.run.id,
      token: resumeToken,
      data: payload.data,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    }
  });

  // Send Slack notification
  await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: "POST",
    body: JSON.stringify({
      text: `🚨 Task escalated: ${context.run.id}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Data*: ${payload.data}` }
        },
        {
          type: "actions",
          elements: [{
            type: "button",
            text: { type: "plain_text", text: "Approve & Resume" },
            url: `https://your-app.com/escalations/${resumeToken}`
          }]
        }
      ]
    })
  });

  return { escalated: true, resumeToken };
}

// Validate token
const escalation = await db.escalation.findUnique({
  where: { token: payload.resumeToken }
});

if (!escalation || escalation.expiresAt < new Date()) {
  throw new AbortTaskRunError("Invalid or expired token");
}

// Mark as resolved
await db.escalation.update({
  where: { token: payload.resumeToken },
  data: { resolvedAt: new Date() }
});
```

---

## 4. Graceful Degradation Pattern

**Task ID**: `agents.graceful-degradation`

### Test Case 1: Mock Mode (Primary Fails → Secondary Succeeds)
Ensure `LLM_MOCK=1` in `.env`:
```json
{
  "prompt": "Explain the benefits of microservices architecture"
}
```
**Expected Output**:
```json
{
  "ok": true,
  "model": "secondary",
  "degraded": true,
  "output": "fallback(Explain the )",
  "durationMs": 12
}
```

### Test Case 2: Real LLM (Requires OPENAI_API_KEY)
Set `LLM_MOCK=0` and add `OPENAI_API_KEY` to `.env`:
```json
{
  "prompt": "Write a haiku about error handling"
}
```
**Expected**: Uses actual OpenAI API (requires implementing the callLLM function)

### Test Case 3: All Fallbacks Fail → Template
In production, simulate all providers down:
```json
{
  "prompt": "This is a very long prompt that should trigger fallback logic..."
}
```
**Expected**: Eventually falls back to template response

### Real-World Validation Checklist
- [ ] Primary model failure triggers secondary
- [ ] Secondary failure triggers template
- [ ] `degraded` flag is set correctly
- [ ] Template response is always available
- [ ] No unhandled errors escape

### Production Adaptations
```typescript
import OpenAI from "openai";

const primaryClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.PRIMARY_LLM_URL // e.g., GPT-4
});

const secondaryClient = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1"
});

async function callLLM(model: "primary" | "secondary", prompt: string) {
  const client = model === "primary" ? primaryClient : secondaryClient;
  const modelName = model === "primary" ? "gpt-4" : "claude-3-sonnet";

  try {
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || "No response";
  } catch (error: any) {
    if (error.code === "rate_limit_exceeded") {
      throw new Error("RATE_LIMIT");
    }
    throw error;
  }
}

// Add monitoring
try {
  const result = await callLLM("primary", prompt);
  await logger.info("LLM call succeeded", { model: "primary", promptLength: prompt.length });
  return result;
} catch (primaryError) {
  await logger.warn("Primary LLM failed", { error: primaryError, fallback: "secondary" });

  try {
    const result = await callLLM("secondary", prompt);
    await logger.info("LLM call succeeded", { model: "secondary", promptLength: prompt.length });
    return result;
  } catch (secondaryError) {
    await logger.error("All LLMs failed", {
      primaryError,
      secondaryError,
      fallback: "template"
    });

    return generateTemplate(prompt);
  }
}
```

---

## Integration Testing

### End-to-End Workflow Test
Create a composite workflow that uses all patterns:

```typescript
export const e2eWorkflow = task({
  id: "agents.e2e-workflow",
  run: async (payload: { userId: string; items: string[] }) => {
    // 1. Check service health with circuit breaker
    const health = await runs.trigger(circuitBreaker.id, { calls: 5 });

    if (!health.ok) {
      // 2. Escalate if service is down
      return await runs.trigger(humanEscalation.id, {
        data: `Service degraded for user ${payload.userId}`
      });
    }

    // 3. Process items with partial success
    const batch = await runs.trigger(partialSuccess.id, {
      items: payload.items
    });

    // 4. Generate summary with graceful degradation
    const summary = await runs.trigger(gracefulDegradation.id, {
      prompt: `Summarize results: ${batch.okCount} succeeded, ${batch.failedCount} failed`
    });

    return { health, batch, summary };
  }
});
```

---

## Production Monitoring

### Key Metrics to Track

1. **Circuit Breaker**
   - Circuit open/close events
   - Consecutive failure count
   - Cooldown duration effectiveness
   - Request throughput during incidents

2. **Partial Success**
   - Batch success rate
   - Per-item failure reasons
   - Retry attempt distribution
   - Idempotency key collisions

3. **Human Escalation**
   - Escalation frequency
   - Average resolution time
   - Token expiration rate
   - Abandoned escalations

4. **Graceful Degradation**
   - Primary vs secondary usage ratio
   - Template fallback frequency
   - Model response times
   - Cost per model tier

### Observability Setup

```typescript
import * as Sentry from "@sentry/node";
import { trace } from "@opentelemetry/api";

// Add to each pattern
const tracer = trace.getTracer("error-handling-patterns");
const span = tracer.startSpan("circuit-breaker-check");

try {
  // ... pattern logic
  span.setStatus({ code: SpanStatusCode.OK });
} catch (error) {
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR });
  Sentry.captureException(error);
} finally {
  span.end();
}
```

---

## Common Issues & Debugging

### Circuit Breaker Not Opening
- Check `consecutive` counter is incrementing
- Verify `maxConsecutive` threshold is appropriate
- Ensure failures are being caught correctly

### Partial Success Retrying Fatal Errors
- Confirm error codes are being set correctly
- Validate retry logic handles specific error types
- Check idempotency keys prevent duplicate processing

### Human Escalation Token Issues
- Verify token generation is cryptographically secure
- Check token expiration logic
- Ensure database persistence for tokens

### Graceful Degradation Always Using Template
- Verify API keys are set correctly
- Check network connectivity to LLM providers
- Review error handling in callLLM function

---

## Performance Benchmarks

Run with various loads to establish baselines:

```bash
# Circuit Breaker: 100 calls
{"calls": 100, "cooldownMs": 5000}
Expected duration: ~1-2 seconds
Expected success rate: 60-75%

# Partial Success: 50 items
{"items": ["1", "2", ..., "50"]}
Expected duration: ~3-5 seconds
Expected success rate: 85-95%

# Graceful Degradation: 10 concurrent
Run 10 instances in parallel
Expected p95 latency: <100ms (mock mode)
Expected p95 latency: <2s (real LLM mode)
```

---

## Next Steps

1. ✅ Run `agents.test-all-patterns` to validate basic functionality
2. ✅ Test each pattern individually with edge cases
3. ✅ Implement production adaptations (Redis, DB, real LLMs)
4. ✅ Add monitoring and alerting
5. ✅ Deploy to staging and run load tests
6. ✅ Document runbooks for each pattern's failure modes

