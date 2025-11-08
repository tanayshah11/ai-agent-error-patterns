# Production Error-Handling Patterns for AI Agents

> **Stop your AI agents from failing silently.** Four battle-tested reliability patterns (circuit breaker, partial success, human-in-the-loop, graceful degradation) for Trigger.dev v4 — with tests, docs, and production upgrade paths.

[![Tests](https://img.shields.io/badge/tests-4%2F4%20passing-brightgreen)]() [![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)]() [![Trigger.dev](https://img.shields.io/badge/Trigger.dev-v4.0-purple)]()

---

## Why This Exists

Most AI agent tutorials show the **happy path**: LLM responds, task succeeds, everyone's happy. Real production systems need to handle:

- ❌ **Cascading failures** when your LLM provider is down
- ❌ **Partial batch failures** (95 items succeed, 5 fail—now what?)
- ❌ **Edge cases** where AI can't decide and needs human judgment
- ❌ **Rate limits** forcing you to fall back to cheaper models

This project **codifies 4 patterns** to handle these scenarios, implemented on Trigger.dev v4 with:

- ✅ **Standalone CLI tests** (no server needed, runs in ~3ms)
- ✅ **Production upgrade paths** (Redis, Postgres, real LLMs, Slack, Sentry)
- ✅ **Comprehensive docs** (testing, deployment, monitoring, cost analysis)
- ✅ **Copy-paste ready** for your own agent workflows

---

## The 4 Patterns

| Pattern                     | Problem                                | Solution                                                          | Use Case                                         |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| **🔴 Circuit Breaker**      | Upstream service failing repeatedly    | Stop trying after N failures, fail fast during cooldown           | Prevent wasting $$$ on 1000 failed OpenAI calls  |
| **🟡 Partial Success**      | Batch operations where some items fail | Process individually, retry only failures, track per-item results | 100 documents: 95 succeed, 5 fail with reasons   |
| **🟠 Human Escalation**     | AI hits edge case it can't resolve     | Pause workflow, notify human, resume with token                   | LLM can't parse ambiguous form → human clarifies |
| **🟢 Graceful Degradation** | Primary service down or rate-limited   | Fall back: GPT-4 → Claude → template response                     | Maintain 100% uptime, reduce costs during spikes |

---

## Quick Start

### Option 1: Test Instantly (No Setup Required)

```bash
# Clone and test
git clone https://github.com/tanayshah11/ai-agent-error-patterns.git
cd ai-agent-error-patterns
pnpm install

# Run all 4 patterns in ~3ms
pnpm test
```

**Expected output:**

```
✅ Passed: 4/4
❌ Failed: 0/4
⏱️  Duration: 3ms
```

### Option 2: Run with Trigger.dev Dashboard

```bash
cp .env.example .env
# Add your TRIGGER_API_KEY
pnpm dev
# Visit http://localhost:3030
```

Trigger tasks via UI:

- `agents.circuit-breaker`
- `agents.partial-success`
- `agents.human-escalation`
- `agents.graceful-degradation`
- `agents.test-all-patterns` (runs all 4)

---

## Pattern Details

### 1. Circuit Breaker (`agents.circuit-breaker`)

**Prevents cascade failures when upstream services are down.**

```typescript
// src/trigger/circuitBreaker.ts (55 LOC)

// Tracks failures, opens circuit after 5 consecutive fails
// Fails fast (503) during cooldown, auto-closes after recovery
```

**Test:**

```bash
pnpm test:circuit
```

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

**Production Upgrade:** Use Redis to persist circuit state across instances (see [PRODUCTION.md](./PRODUCTION.md))

---

### 2. Partial Success (`agents.partial-success`)

**Process batches where some items fail but others succeed.**

```typescript
// src/trigger/partialSuccess.ts (40 LOC)

// Processes items individually with retry logic
// Distinguishes fatal (TOKEN_LIMIT) vs retryable (RATE_LIMIT) errors
// Returns per-item results with attempt counts
```

**Test:**

```bash
pnpm test:partial
```

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

**Production Upgrade:** Add database persistence for idempotency keys (see [PRODUCTION.md](./PRODUCTION.md))

---

### 3. Human Escalation (`agents.human-escalation`)

**Pause workflows when AI hits edge cases requiring human judgment.**

```typescript
// src/trigger/humanEscalation.ts (26 LOC)

// First run: escalates, returns resumeToken
// Second run: validates token, resumes execution
```

**Test:**

```bash
pnpm test:escalation
```

**Sample Output (Escalation):**

```json
{
  "ok": false,
  "escalated": true,
  "message": "Escalated for review. Re-run with resumeToken to continue.",
  "resumeToken": "RESUME-123",
  "durationMs": 0
}
```

**Sample Output (Resume):**

```json
{
  "ok": true,
  "resumed": true,
  "durationMs": 0
}
```

**Production Upgrade:** Integrate Slack webhooks, secure token storage with expiry (see [PRODUCTION.md](./PRODUCTION.md))

---

### 4. Graceful Degradation (`agents.graceful-degradation`)

**Maintain 100% uptime by falling back to cheaper/faster models.**

```typescript
// src/trigger/gracefulDegradation.ts (38 LOC)

// Try primary (GPT-4) → secondary (Claude) → template
// Always returns a response, tracks degraded state
```

**Test:**

```bash
pnpm test:degradation
```

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

**Production Upgrade:** Add real LLM APIs, cost tracking, response caching (see [PRODUCTION.md](./PRODUCTION.md))

---

## What's Included

```
├── src/trigger/
│   ├── circuitBreaker.ts           # Circuit breaker (55 LOC)
│   ├── partialSuccess.ts           # Batch retry (40 LOC)
│   ├── humanEscalation.ts          # Pause/resume (26 LOC)
│   ├── gracefulDegradation.ts      # Multi-tier fallback (38 LOC)
│   └── testRunner.ts               # Dashboard test suite
├── test-standalone.ts              # CLI test runner (no server needed)
├── CLI-TESTING.md                  # Command-line testing guide
├── TESTING.md                      # Comprehensive test scenarios
├── PRODUCTION.md                   # Full deployment guide
│   ├── Prisma schema (5 models)
│   ├── Redis integration
│   ├── Real LLM APIs (OpenAI, Anthropic)
│   ├── Slack webhooks
│   ├── Sentry monitoring
│   ├── Cost optimization
│   └── Security checklist
├── .env.example                    # Environment template
└── trigger.config.ts               # Trigger.dev v4 config
```

---

## Testing

### CLI Tests (No Server Required)

```bash
# All patterns
pnpm test

# Individual patterns
pnpm test:circuit      # Circuit breaker
pnpm test:partial      # Partial success
pnpm test:escalation   # Human escalation
pnpm test:degradation  # Graceful degradation
```

**Why CLI tests?**

- ✅ Runs in ~3ms (perfect for CI/CD)
- ✅ No Trigger.dev server needed
- ✅ No external APIs required (mock mode)
- ✅ Exit code 0 on success, 1 on failure

### Dashboard Tests

```bash
pnpm dev
# Visit http://localhost:3030
# Trigger any task: agents.circuit-breaker, agents.partial-success, etc.
```

**See [CLI-TESTING.md](./CLI-TESTING.md) for CI/CD integration examples.**

---

## Production Deployment

Ready to deploy? [PRODUCTION.md](./PRODUCTION.md) includes:

### Infrastructure Setup

- ✅ Upstash Redis (circuit breaker state)
- ✅ Neon/Supabase PostgreSQL (idempotency, tokens, audit logs)
- ✅ Prisma schema (5 models: CircuitBreakerState, EscalationToken, BatchItem, AuditLog, LLMUsage)

### Integrations

- ✅ OpenAI + Anthropic APIs (real LLM calls)
- ✅ Slack webhooks (escalation notifications)
- ✅ Sentry (error tracking)
- ✅ OpenTelemetry (tracing)

### Guides

- ✅ Deployment steps
- ✅ Alerts & runbooks
- ✅ Performance tuning
- ✅ Cost optimization (LLM caching, model tiers)
- ✅ Security checklist

**Estimated cost:** $40-70/month (low volume) | $150-500/month (high volume)

---

## Documentation

| Doc                                    | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| **[README.md](./README.md)**           | This file—quick start and overview                 |
| **[CLI-TESTING.md](./CLI-TESTING.md)** | Command-line testing, CI/CD integration            |
| **[TESTING.md](./TESTING.md)**         | Detailed test scenarios, edge cases, observability |
| **[PRODUCTION.md](./PRODUCTION.md)**   | Full deployment guide with infrastructure          |

---

## Real-World Use Cases

| Pattern                  | Scenario                         | Without                          | With                                       |
| ------------------------ | -------------------------------- | -------------------------------- | ------------------------------------------ |
| **Circuit Breaker**      | OpenAI API is down               | 1000 failed requests, wasted $$$ | Circuit opens after 5 failures, fails fast |
| **Partial Success**      | Process 100 documents, 5 invalid | Entire batch fails               | 95 succeed, 5 fail with detailed reasons   |
| **Human Escalation**     | LLM can't parse form             | Stuck in retry loop              | Pauses, notifies human, resumes after fix  |
| **Graceful Degradation** | GPT-4 rate limit hit             | All requests fail                | Falls back to Claude → template            |

---

## Tech Stack

- **[Trigger.dev v4](https://trigger.dev)** - Background job orchestration
- **TypeScript 5.5** - Type-safe development
- **[tsx](https://github.com/privatenumber/tsx)** - Fast TypeScript execution
- **Mock mode** - No external APIs required for testing
- **Production-ready** - Prisma, Redis, LLMs, Slack, Sentry integrations

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Test AI Agent Patterns
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: "20"
          cache: "pnpm"
      - run: pnpm install
      - run: pnpm test
```

### Pre-commit Hook

```bash
#!/bin/sh
pnpm test || exit 1
```

---

## Next Steps

1. **Clone & Test:** `git clone` → `pnpm install` → `pnpm test`
2. **Read Docs:** Start with [CLI-TESTING.md](./CLI-TESTING.md)
3. **Run Dashboard:** `pnpm dev` → http://localhost:3030
4. **Go Production:** Follow [PRODUCTION.md](./PRODUCTION.md) for deployment

---

## Contributing

Found a bug? Have a pattern to add? PRs welcome!

1. Fork the repo
2. Create a branch: `git checkout -b feature/new-pattern`
3. Make changes and test: `pnpm test`
4. Submit a PR

---

## License

MIT — use freely in your own projects.

---

## Author

Built with [Trigger.dev v4](https://trigger.dev) to demonstrate production-grade error handling for AI agent workflows.

**Questions?** Open an issue or reach out on [Twitter](https://twitter.com/YOUR_HANDLE) | [LinkedIn](https://linkedin.com/in/YOUR_PROFILE)

---

## Star History

If this helped you build more reliable AI agents, consider giving it a ⭐!

[![Star History Chart](https://api.star-history.com/svg?repos=tanayshah11/ai-agent-error-patterns&type=Date)](https://star-history.com/#tanayshah11/ai-agent-error-patterns&Date)
