# Production Deployment Guide

This guide covers deploying error-handling patterns to production with real infrastructure.

## Prerequisites

### Required Services
- ✅ **Trigger.dev Cloud Account** (or self-hosted)
- ✅ **Redis** (Upstash recommended for serverless)
- ✅ **PostgreSQL** (Neon, Supabase, or any managed Postgres)
- ✅ **Monitoring** (Sentry, Datadog, or Honeycomb)
- ✅ **LLM APIs** (OpenAI, Anthropic, etc.)

### Environment Variables
Create `.env.production`:
```bash
# Trigger.dev
TRIGGER_API_KEY=tr_prod_xxxxx
TRIGGER_SECRET_KEY=xxxxx

# Redis (Upstash)
UPSTASH_REDIS_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_TOKEN=xxxxx

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# LLM Providers
OPENAI_API_KEY=sk-xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
LLM_MOCK=0

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxxxx
PAGERDUTY_API_KEY=xxxxx
```

---

## Database Setup

### 1. Install Prisma
```bash
pnpm add prisma @prisma/client
pnpm add -D prisma
```

### 2. Initialize Schema
Create `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model CircuitBreakerState {
  id                String    @id @default(cuid())
  serviceName       String    @unique
  consecutiveFails  Int       @default(0)
  lastFailure       DateTime?
  lastSuccess       DateTime?
  openedUntil       DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([serviceName])
}

model EscalationToken {
  id            String    @id @default(cuid())
  taskRunId     String    @unique
  token         String    @unique
  data          Json
  expiresAt     DateTime
  resolvedAt    DateTime?
  resolvedBy    String?
  createdAt     DateTime  @default(now())

  @@index([token])
  @@index([taskRunId])
}

model BatchItem {
  id                String   @id @default(cuid())
  batchId           String
  itemId            String
  idempotencyKey    String   @unique
  success           Boolean
  attempts          Int
  reason            String?
  output            Json?
  createdAt         DateTime @default(now())

  @@index([batchId])
  @@index([idempotencyKey])
}

model AuditLog {
  id         String   @id @default(cuid())
  taskId     String
  runId      String
  pattern    String
  action     String
  metadata   Json
  createdAt  DateTime @default(now())

  @@index([taskId])
  @@index([pattern])
  @@index([createdAt])
}

model LLMUsage {
  id            String   @id @default(cuid())
  taskRunId     String
  model         String
  provider      String
  promptTokens  Int
  completionTokens Int
  totalTokens   Int
  cost          Float
  degraded      Boolean  @default(false)
  latencyMs     Int
  createdAt     DateTime @default(now())

  @@index([model])
  @@index([createdAt])
}
```

### 3. Run Migrations
```bash
npx prisma migrate dev --name init
npx prisma generate
```

---

## Production Pattern Implementations

### 1. Circuit Breaker with Redis

Create `src/trigger/prod/circuitBreakerProd.ts`:

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { retry } from "@trigger.dev/sdk/v3";
import { Redis } from "@upstash/redis";
import { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/node";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

const prisma = new PrismaClient();

export const circuitBreakerProd = task({
  id: "agents.circuit-breaker-prod",
  run: async (payload: {
    serviceName: string;
    endpoint: string;
    maxConsecutive?: number;
    cooldownMs?: number;
  }) => {
    const { serviceName, endpoint, maxConsecutive = 5, cooldownMs = 30000 } = payload;
    const stateKey = `circuit:${serviceName}`;
    const openKey = `${stateKey}:open`;

    // Check if circuit is open
    const openedUntil = await redis.get<number>(openKey) || 0;
    if (Date.now() < openedUntil) {
      Sentry.captureMessage(`Circuit breaker open for ${serviceName}`, "warning");
      throw new Error(`Circuit breaker OPEN for ${serviceName} until ${new Date(openedUntil).toISOString()}`);
    }

    // Make the call
    try {
      const response = await retry.fetch(endpoint, {
        maxAttempts: 2,
        factor: 2,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // Success - reset counter
      await redis.del(stateKey);
      await prisma.circuitBreakerState.upsert({
        where: { serviceName },
        update: { consecutiveFails: 0, lastSuccess: new Date() },
        create: { serviceName, consecutiveFails: 0, lastSuccess: new Date() },
      });

      return { ok: true, serviceName, status: response.status };
    } catch (error: any) {
      // Failure - increment counter
      const consecutive = await redis.incr(stateKey);

      await prisma.circuitBreakerState.upsert({
        where: { serviceName },
        update: { consecutiveFails: consecutive, lastFailure: new Date() },
        create: { serviceName, consecutiveFails: consecutive, lastFailure: new Date() },
      });

      if (consecutive >= maxConsecutive) {
        const openUntil = Date.now() + cooldownMs;
        await redis.set(openKey, openUntil, { px: cooldownMs });

        await prisma.circuitBreakerState.update({
          where: { serviceName },
          data: { openedUntil: new Date(openUntil) },
        });

        // Alert on circuit open
        await fetch(process.env.SLACK_WEBHOOK_URL!, {
          method: "POST",
          body: JSON.stringify({
            text: `🔴 Circuit breaker OPENED for ${serviceName}`,
            blocks: [{
              type: "section",
              text: { type: "mrkdwn", text: `*Service*: ${serviceName}\n*Failures*: ${consecutive}\n*Cooldown*: ${cooldownMs}ms` }
            }]
          })
        });

        Sentry.captureException(new Error(`Circuit breaker opened for ${serviceName}`));
      }

      throw error;
    }
  },
});
```

---

### 2. Partial Success with Idempotency

Create `src/trigger/prod/partialSuccessProd.ts`:

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { retry } from "@trigger.dev/sdk/v3";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const partialSuccessProd = task({
  id: "agents.partial-success-prod",
  run: async (payload: { batchId: string; items: Array<{ id: string; data: any }> }) => {
    const { batchId, items } = payload;
    const results: Record<string, any> = {};

    for (const item of items) {
      const idempotencyKey = `batch:${batchId}:item:${item.id}`;

      // Check if already processed
      const existing = await prisma.batchItem.findUnique({
        where: { idempotencyKey },
      });

      if (existing) {
        results[item.id] = {
          ok: existing.success,
          attempts: existing.attempts,
          reason: existing.reason,
          cached: true,
        };
        continue;
      }

      // Process new item
      let attempts = 0;
      const processResult = await retry.onThrow(
        async () => {
          attempts++;
          // Your actual processing logic here
          return await processItem(item.data);
        },
        { maxAttempts: 3, factor: 2 }
      ).then(
        (output) => ({ ok: true, output }),
        (error) => ({ ok: false, reason: error.code || error.message })
      );

      // Store result
      await prisma.batchItem.create({
        data: {
          batchId,
          itemId: item.id,
          idempotencyKey,
          success: processResult.ok,
          attempts,
          reason: (processResult as any).reason,
          output: (processResult as any).output,
        },
      });

      results[item.id] = { ...processResult, attempts };
    }

    const okCount = Object.values(results).filter((r: any) => r.ok).length;
    const failedCount = items.length - okCount;

    // Log batch completion
    await prisma.auditLog.create({
      data: {
        taskId: "agents.partial-success-prod",
        runId: batchId,
        pattern: "partial-success",
        action: "completed",
        metadata: { batchId, total: items.length, okCount, failedCount },
      },
    });

    return {
      ok: failedCount === 0,
      batchId,
      total: items.length,
      okCount,
      failedCount,
      results,
    };
  },
});

async function processItem(data: any) {
  // Replace with your actual logic
  if (Math.random() < 0.1) throw Object.assign(new Error("Processing failed"), { code: "PROCESSING_ERROR" });
  return { processed: true, data };
}
```

---

### 3. Human Escalation with Slack

Create `src/trigger/prod/humanEscalationProd.ts`:

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

export const humanEscalationProd = task({
  id: "agents.human-escalation-prod",
  run: async (payload: { data: any; resumeToken?: string }, { ctx }) => {
    if (!payload.resumeToken) {
      // Escalate - generate secure token
      const resumeToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      await prisma.escalationToken.create({
        data: {
          taskRunId: ctx.run.id,
          token: resumeToken,
          data: payload.data,
          expiresAt,
        },
      });

      // Send Slack notification with action button
      const approvalUrl = `${process.env.APP_URL}/escalations/${resumeToken}`;

      await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "🚨 Task escalation requires human review",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Task Run ID*: ${ctx.run.id}\n*Data*: \`\`\`${JSON.stringify(payload.data, null, 2)}\`\`\``,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "✅ Approve & Resume" },
                  url: approvalUrl,
                  style: "primary",
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "❌ Reject" },
                  url: `${approvalUrl}?action=reject`,
                  style: "danger",
                },
              ],
            },
          ],
        }),
      });

      return {
        ok: false,
        escalated: true,
        message: "Escalated for human review",
        resumeToken,
        expiresAt: expiresAt.toISOString(),
        approvalUrl,
      };
    }

    // Resume - validate token
    const escalation = await prisma.escalationToken.findUnique({
      where: { token: payload.resumeToken },
    });

    if (!escalation) {
      throw new AbortTaskRunError("Invalid resume token");
    }

    if (escalation.expiresAt < new Date()) {
      throw new AbortTaskRunError("Resume token expired");
    }

    if (escalation.resolvedAt) {
      throw new AbortTaskRunError("Token already used");
    }

    // Mark as resolved
    await prisma.escalationToken.update({
      where: { token: payload.resumeToken },
      data: {
        resolvedAt: new Date(),
        resolvedBy: ctx.run.id, // Or get from auth context
      },
    });

    // Continue processing with approved data
    return {
      ok: true,
      resumed: true,
      data: escalation.data,
    };
  },
});
```

---

### 4. Graceful Degradation with Real LLMs

Create `src/trigger/prod/gracefulDegradationProd.ts`:

```typescript
import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/node";

const prisma = new PrismaClient();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const gracefulDegradationProd = task({
  id: "agents.graceful-degradation-prod",
  run: async (payload: { prompt: string; maxTokens?: number }) => {
    const start = Date.now();
    const { prompt, maxTokens = 500 } = payload;

    // Try primary (OpenAI GPT-4)
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
      });

      const output = response.choices[0]?.message?.content || "";
      const usage = response.usage!;

      await trackUsage({
        model: "gpt-4-turbo-preview",
        provider: "openai",
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        cost: calculateCost("gpt-4-turbo", usage.total_tokens),
        degraded: false,
        latencyMs: Date.now() - start,
      });

      return { ok: true, model: "gpt-4-turbo-preview", output, degraded: false };
    } catch (primaryError: any) {
      Sentry.captureException(primaryError, {
        tags: { pattern: "graceful-degradation", fallback: "secondary" },
      });

      console.warn("Primary LLM failed, trying secondary:", primaryError.message);

      // Try secondary (Anthropic Claude)
      try {
        const response = await anthropic.messages.create({
          model: "claude-3-sonnet-20240229",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        });

        const output = response.content[0]?.type === "text" ? response.content[0].text : "";

        await trackUsage({
          model: "claude-3-sonnet",
          provider: "anthropic",
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          cost: calculateCost("claude-3-sonnet", response.usage.input_tokens + response.usage.output_tokens),
          degraded: true,
          latencyMs: Date.now() - start,
        });

        return { ok: true, model: "claude-3-sonnet", output, degraded: true };
      } catch (secondaryError: any) {
        Sentry.captureException(secondaryError, {
          tags: { pattern: "graceful-degradation", fallback: "template" },
        });

        console.error("Secondary LLM failed, using template:", secondaryError.message);

        // Fallback to template
        const output = generateTemplate(prompt);

        await trackUsage({
          model: "template",
          provider: "local",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
          degraded: true,
          latencyMs: Date.now() - start,
        });

        return { ok: true, model: "template", output, degraded: true };
      }
    }
  },
});

async function trackUsage(usage: any) {
  await prisma.lLMUsage.create({
    data: {
      taskRunId: "TODO_GET_FROM_CONTEXT",
      ...usage,
    },
  });
}

function calculateCost(model: string, tokens: number): number {
  const pricing: Record<string, number> = {
    "gpt-4-turbo": 0.00003, // $0.03 per 1k tokens (avg)
    "claude-3-sonnet": 0.000015, // $0.015 per 1k tokens (avg)
  };
  return (pricing[model] || 0) * tokens;
}

function generateTemplate(prompt: string): string {
  return `We're experiencing high demand. Here's a quick summary based on your request: "${prompt.slice(0, 100)}..."\n\nA detailed response will be generated shortly. Please check back in a few minutes or contact support.`;
}
```

---

## Deployment

### 1. Build & Deploy
```bash
# Build the project
npx trigger.dev@latest build

# Deploy to production
npx trigger.dev@latest deploy
```

### 2. Environment Setup
In your Trigger.dev dashboard:
1. Navigate to Settings → Environment Variables
2. Add all production variables
3. Enable production environment

### 3. Monitoring Setup

```typescript
// src/trigger/monitoring.ts
import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.ENVIRONMENT || "production",
  integrations: [new ProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

// Export instrumented task wrapper
export function monitoredTask(config: any) {
  return task({
    ...config,
    run: async (payload, ctx) => {
      const transaction = Sentry.startTransaction({
        op: "task",
        name: config.id,
      });

      try {
        const result = await config.run(payload, ctx);
        transaction.setStatus("ok");
        return result;
      } catch (error) {
        transaction.setStatus("internal_error");
        Sentry.captureException(error);
        throw error;
      } finally {
        transaction.finish();
      }
    },
  });
}
```

---

## Alerts & Runbooks

### Circuit Breaker Alerts
**Alert**: Circuit opened for critical service
**Runbook**:
1. Check service health dashboard
2. Review recent error logs in Sentry
3. If service is healthy, manually reset circuit: `redis-cli DEL circuit:{serviceName}:open`
4. If service is unhealthy, investigate root cause

### Partial Success Alerts
**Alert**: Batch failure rate >20%
**Runbook**:
1. Query failed items: `SELECT * FROM "BatchItem" WHERE success = false AND createdAt > now() - interval '1 hour'`
2. Group by reason to identify common failures
3. Re-trigger failed items after fix

### Human Escalation Alerts
**Alert**: Escalation unresolved for >2 hours
**Runbook**:
1. Check Slack notifications
2. Review escalation: `SELECT * FROM "EscalationToken" WHERE resolvedAt IS NULL`
3. Contact on-call if urgent

### Graceful Degradation Alerts
**Alert**: Template fallback used >10% of time
**Runbook**:
1. Check LLM provider status pages
2. Review API key quotas
3. Verify network connectivity
4. Check for rate limit errors

---

## Performance Tuning

### Redis Connection Pooling
```typescript
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
  retry: {
    retries: 3,
    backoff: (retryCount) => Math.min(1000 * Math.pow(2, retryCount), 3000),
  },
});
```

### Database Connection Pooling
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Connection pooling
  relationMode = "prisma"
}

generator client {
  provider = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}
```

### LLM Request Batching
```typescript
// Batch multiple prompts into single request
const responses = await Promise.all([
  callLLM("prompt1"),
  callLLM("prompt2"),
  callLLM("prompt3"),
]);
```

---

## Cost Optimization

### 1. Use Cheaper Models First
```typescript
const modelTiers = [
  { model: "gpt-3.5-turbo", cost: 0.001, provider: openai },
  { model: "claude-3-haiku", cost: 0.00025, provider: anthropic },
  { model: "gpt-4-turbo", cost: 0.03, provider: openai }, // Most expensive
];
```

### 2. Cache LLM Responses
```typescript
const cacheKey = `llm:${hash(prompt)}`;
const cached = await redis.get(cacheKey);
if (cached) return cached;

const result = await callLLM(prompt);
await redis.set(cacheKey, result, { ex: 3600 }); // 1 hour TTL
```

### 3. Monitor Spend
```typescript
// Daily spend alert
const dailySpend = await prisma.lLMUsage.aggregate({
  _sum: { cost: true },
  where: {
    createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
  },
});

if (dailySpend._sum.cost! > 100) {
  // Alert on high spend
}
```

---

## Security Checklist

- [ ] Rotate API keys quarterly
- [ ] Use separate keys for dev/staging/prod
- [ ] Enable rate limiting per user/org
- [ ] Validate all external inputs
- [ ] Encrypt sensitive data at rest
- [ ] Use HTTPS for all webhook callbacks
- [ ] Implement request signing for webhooks
- [ ] Set up audit logging for all mutations
- [ ] Configure CORS properly
- [ ] Enable 2FA for Trigger.dev dashboard

---

## Next Steps

1. ✅ Set up infrastructure (Redis, Postgres, monitoring)
2. ✅ Deploy production patterns
3. ✅ Configure alerts and runbooks
4. ✅ Run load tests
5. ✅ Document incident response procedures
6. ✅ Train team on patterns

For questions or issues, refer to [TESTING.md](./TESTING.md) or contact the platform team.
