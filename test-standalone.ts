#!/usr/bin/env tsx
/**
 * Standalone CLI Test - Tests pattern logic without Trigger.dev runtime
 * Usage: npx tsx test-standalone.ts [pattern-name]
 */

import { retry } from "@trigger.dev/sdk/v3";

// ========== Circuit Breaker Pattern (Standalone) ==========
let consecutive = 0;
let openedUntil = 0;

async function testCircuitBreaker(payload: { calls: number; cooldownMs?: number }) {
  const start = Date.now();
  const cooldown = payload.cooldownMs ?? 5000;
  const maxConsecutive = 5;
  const results: Array<{ ok: boolean; status?: number }> = [];

  for (let i = 0; i < payload.calls; i++) {
    const now = Date.now();
    if (now < openedUntil) {
      results.push({ ok: false, status: 503 });
      continue;
    }

    const r = await retry.onThrow(
      async () => {
        if (Math.random() < 0.3) throw Object.assign(new Error("Upstream 5xx"), { status: 502 });
        return { ok: true as const, status: 200 };
      },
      { maxAttempts: 2, factor: 2 }
    ).catch((e: any) => ({ ok: false as const, status: e?.status ?? 500 }));

    results.push(r);
    consecutive = r.ok ? 0 : consecutive + 1;
    if (consecutive >= maxConsecutive) {
      openedUntil = Date.now() + cooldown;
    }
  }

  const durationMs = Date.now() - start;
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;

  return {
    ok: failCount === 0,
    attempts: results.length,
    okCount,
    failCount,
    consecutivelyTripped: consecutive >= maxConsecutive,
    openUntil: openedUntil || null,
    durationMs,
  };
}

// ========== Partial Success Pattern (Standalone) ==========
async function testPartialSuccess(payload: { items: string[] }) {
  const start = Date.now();
  const results: Record<string, { ok: boolean; attempts: number; reason?: string }> = {};

  for (const id of payload.items) {
    const key = `item:${id}`;
    let attempts = 0;

    const res = await (async () => {
      try {
        return await retry.onThrow(
          async () => {
            attempts++;
            const r = Math.random();
            if (r < 0.05) throw Object.assign(new Error("Token limit"), { code: "TOKEN_LIMIT" });
            if (r < 0.10) throw Object.assign(new Error("Rate limited"), { code: "RATE_LIMIT" });
            return { ok: true as const };
          },
          { maxAttempts: 3, factor: 2 }
        );
      } catch (e: any) {
        return { ok: false as const, reason: e?.code || e?.message };
      }
    })();

    results[key] = { ok: res.ok, attempts, reason: (res as any).reason };
  }

  const ok = Object.values(results).filter(r => r.ok).length;
  const failed = Object.values(results).length - ok;
  return { ok: failed === 0, okCount: ok, failedCount: failed, durationMs: Date.now() - start, results };
}

// ========== Human Escalation Pattern (Standalone) ==========
async function testHumanEscalation(payload: { data: string; resumeToken?: string }) {
  const start = Date.now();

  if (!payload.resumeToken) {
    return {
      ok: false,
      escalated: true,
      message: "Escalated for review. Re-run with resumeToken to continue.",
      resumeToken: "RESUME-123",
      durationMs: Date.now() - start,
    };
  }

  if (payload.resumeToken !== "RESUME-123") {
    throw new Error("Invalid resume token");
  }

  return { ok: true, resumed: true, durationMs: Date.now() - start };
}

// ========== Graceful Degradation Pattern (Standalone) ==========
async function callLLM(model: "primary" | "secondary", prompt: string, mock = true) {
  if (mock) {
    if (model === "primary") throw Object.assign(new Error("Primary down"), { code: "PRIMARY_DOWN" });
    return `fallback(${prompt.slice(0, 12)})`;
  }
  throw new Error("Real LLM not implemented");
}

async function testGracefulDegradation(payload: { prompt: string }) {
  const start = Date.now();
  const mock = process.env.LLM_MOCK !== "0";

  try {
    const a = await callLLM("primary", payload.prompt, mock);
    return { ok: true, model: "primary", output: a, durationMs: Date.now() - start };
  } catch {
    try {
      const b = await callLLM("secondary", payload.prompt, mock);
      return { ok: true, model: "secondary", degraded: true, output: b, durationMs: Date.now() - start };
    } catch {
      return {
        ok: true,
        model: "template",
        degraded: true,
        output: `We're experiencing issues. Draft: ${payload.prompt.slice(0, 20)}…`,
        durationMs: Date.now() - start,
      };
    }
  }
}

// ========== Test Runners ==========
async function runCircuitBreaker() {
  console.log("\n🔵 Testing Circuit Breaker Pattern...");
  console.log("=".repeat(50));

  const payload = { calls: 20, cooldownMs: 3000 };
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const result = await testCircuitBreaker(payload);
    console.log("\n✅ Result:", JSON.stringify(result, null, 2));
    return { success: true, result };
  } catch (error: any) {
    console.log("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function runPartialSuccess() {
  console.log("\n🟡 Testing Partial Success Pattern...");
  console.log("=".repeat(50));

  const payload = { items: ["a", "b", "c", "d", "e", "f", "g", "h"] };
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const result = await testPartialSuccess(payload);
    console.log("\n✅ Result:", JSON.stringify(result, null, 2));
    return { success: true, result };
  } catch (error: any) {
    console.log("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function runHumanEscalation() {
  console.log("\n🟠 Testing Human Escalation Pattern...");
  console.log("=".repeat(50));

  // Test 1: Escalation
  console.log("\n📋 Test 1: Triggering escalation...");
  const payload1 = { data: "Test data requiring human review" };
  console.log("Payload:", JSON.stringify(payload1, null, 2));

  try {
    const result1 = await testHumanEscalation(payload1);
    console.log("\n✅ Escalation Result:", JSON.stringify(result1, null, 2));

    if (result1.escalated && result1.resumeToken) {
      // Test 2: Resume with token
      console.log("\n📋 Test 2: Resuming with token...");
      const payload2 = { data: "Test data requiring human review", resumeToken: result1.resumeToken };
      console.log("Payload:", JSON.stringify(payload2, null, 2));

      const result2 = await testHumanEscalation(payload2);
      console.log("\n✅ Resume Result:", JSON.stringify(result2, null, 2));

      return { success: true, result: { escalation: result1, resume: result2 } };
    }

    return { success: true, result: result1 };
  } catch (error: any) {
    console.log("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function runGracefulDegradation() {
  console.log("\n🟢 Testing Graceful Degradation Pattern...");
  console.log("=".repeat(50));

  const payload = { prompt: "Explain the benefits of error handling in AI systems" };
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const result = await testGracefulDegradation(payload);
    console.log("\n✅ Result:", JSON.stringify(result, null, 2));
    return { success: true, result };
  } catch (error: any) {
    console.log("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function runAll() {
  console.log("\n🧪 Running All Error-Handling Patterns");
  console.log("=".repeat(50));

  const start = Date.now();
  const results: Record<string, any> = {};

  results.circuitBreaker = await runCircuitBreaker();
  results.partialSuccess = await runPartialSuccess();
  results.humanEscalation = await runHumanEscalation();
  results.gracefulDegradation = await runGracefulDegradation();

  const durationMs = Date.now() - start;
  const successCount = Object.values(results).filter((r: any) => r.success).length;
  const totalTests = Object.keys(results).length;

  console.log("\n" + "=".repeat(50));
  console.log("📊 Test Summary");
  console.log("=".repeat(50));
  console.log(`✅ Passed: ${successCount}/${totalTests}`);
  console.log(`❌ Failed: ${totalTests - successCount}/${totalTests}`);
  console.log(`⏱️  Duration: ${durationMs}ms`);
  console.log("=".repeat(50) + "\n");

  process.exit(successCount === totalTests ? 0 : 1);
}

// Main execution
const pattern = process.argv[2] || "all";

(async () => {
  console.log("\n🚀 Standalone CLI Test Runner");
  console.log("Testing pattern:", pattern);

  switch (pattern) {
    case "all":
      await runAll();
      break;
    case "circuit-breaker":
    case "circuitBreaker":
      await runCircuitBreaker();
      break;
    case "partial-success":
    case "partialSuccess":
      await runPartialSuccess();
      break;
    case "human-escalation":
    case "humanEscalation":
      await runHumanEscalation();
      break;
    case "graceful-degradation":
    case "gracefulDegradation":
      await runGracefulDegradation();
      break;
    default:
      console.error(`\n❌ Unknown pattern: ${pattern}`);
      console.log("\nAvailable patterns:");
      console.log("  - all");
      console.log("  - circuit-breaker");
      console.log("  - partial-success");
      console.log("  - human-escalation");
      console.log("  - graceful-degradation");
      process.exit(1);
  }
})();
