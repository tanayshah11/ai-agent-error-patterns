# Command Line Testing Guide

Test all error-handling patterns **without running the Trigger.dev dev server**.

## Quick Start

```bash
# Install dependencies (one time)
pnpm install

# Run all tests
pnpm test
```

**Expected Output:**
```
✅ Passed: 4/4
❌ Failed: 0/4
⏱️  Duration: 3ms
```

---

## Individual Pattern Tests

```bash
# Test circuit breaker (handles cascading failures)
pnpm test:circuit

# Test partial success (batch processing with retries)
pnpm test:partial

# Test human escalation (pause/resume workflow)
pnpm test:escalation

# Test graceful degradation (multi-tier fallback)
pnpm test:degradation
```

---

## What Each Test Does

### 1. Circuit Breaker (`pnpm test:circuit`)
- Simulates 20 API calls with 30% random failure rate
- After 5 consecutive failures, circuit "opens"
- Subsequent calls fail fast (503) during cooldown
- Circuit auto-closes after cooldown expires

**Sample Output:**
```json
{
  "ok": false,
  "attempts": 20,
  "okCount": 17,
  "failCount": 3,
  "consecutivelyTripped": false,
  "openUntil": null,
  "durationMs": 2
}
```

### 2. Partial Success (`pnpm test:partial`)
- Processes 8 items with random failures
- 5% chance of `TOKEN_LIMIT` (fatal, no retry)
- 10% chance of `RATE_LIMIT` (retryable, up to 3 attempts)
- Returns per-item results with attempt counts

**Sample Output:**
```json
{
  "ok": true,
  "okCount": 8,
  "failedCount": 0,
  "durationMs": 0,
  "results": {
    "item:a": { "ok": true, "attempts": 1 },
    "item:b": { "ok": true, "attempts": 1 },
    ...
  }
}
```

### 3. Human Escalation (`pnpm test:escalation`)
- **Test 1:** Triggers escalation, returns `resumeToken`
- **Test 2:** Resumes with token, completes successfully
- Simulates pause/resume workflow for human intervention

**Sample Output:**
```json
{
  "escalation": {
    "ok": false,
    "escalated": true,
    "resumeToken": "RESUME-123",
    "durationMs": 0
  },
  "resume": {
    "ok": true,
    "resumed": true,
    "durationMs": 0
  }
}
```

### 4. Graceful Degradation (`pnpm test:degradation`)
- Primary model always fails (simulated)
- Falls back to secondary model
- Returns response with `degraded: true` flag

**Sample Output:**
```json
{
  "ok": true,
  "model": "secondary",
  "degraded": true,
  "output": "fallback(Explain the )",
  "durationMs": 0
}
```

---

## Under the Hood

The CLI tests use `test-standalone.ts`, which:
1. Imports only `@trigger.dev/sdk/v3` for retry logic
2. Runs pattern logic directly without Trigger.dev runtime
3. Uses mock data (no external API calls)
4. Exits with code 0 on success, 1 on failure

This makes it perfect for:
- ✅ CI/CD pipelines
- ✅ Pre-commit hooks
- ✅ Quick local validation
- ✅ Testing without API keys

---

## CI/CD Integration

### GitHub Actions
```yaml
name: Test Error Handling Patterns

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test
```

### Pre-commit Hook
```bash
# .git/hooks/pre-commit
#!/bin/sh
pnpm test || exit 1
```

---

## Troubleshooting

### Tests fail with "MODULE_NOT_FOUND"
```bash
# Delete node_modules and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Circuit breaker test shows `consecutivelyTripped: true`
This is normal! The random 30% failure rate occasionally triggers 5 consecutive failures. Re-run the test.

### Partial success has failures
Also normal! Random token/rate limit errors are part of the simulation. The test validates that:
- Retries work for `RATE_LIMIT` errors
- No retries happen for `TOKEN_LIMIT` errors
- Per-item results are tracked correctly

---

## Customizing Tests

Edit `test-standalone.ts` to customize:

```typescript
// Adjust failure rate (default: 30%)
if (Math.random() < 0.5) throw new Error("Higher failure rate");

// Adjust circuit breaker threshold (default: 5)
const maxConsecutive = 10;

// Adjust retry attempts (default: 3)
{ maxAttempts: 5, factor: 2 }

// Disable mock mode for real LLM calls
const mock = false; // requires OPENAI_API_KEY
```

---

## Next Steps

- ✅ Run `pnpm test` to validate patterns work
- ✅ Check [TESTING.md](./TESTING.md) for detailed test scenarios
- ✅ See [PRODUCTION.md](./PRODUCTION.md) for deployment to production
- ✅ Run `pnpm dev` to test via Trigger.dev dashboard

