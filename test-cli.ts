#!/usr/bin/env tsx
/**
 * CLI Test Runner - Run patterns directly without dev server
 * Usage: npx tsx test-cli.ts [pattern-name]
 * Examples:
 *   npx tsx test-cli.ts all
 *   npx tsx test-cli.ts circuit-breaker
 *   npx tsx test-cli.ts partial-success
 */

import { circuitBreaker } from "./src/trigger/circuitBreaker";
import { partialSuccess } from "./src/trigger/partialSuccess";
import { humanEscalation } from "./src/trigger/humanEscalation";
import { gracefulDegradation } from "./src/trigger/gracefulDegradation";

// Mock context for testing
const mockContext: any = {
  run: { id: "test-run-" + Date.now() },
  task: { id: "test-task" },
};

async function runCircuitBreaker() {
  console.log("\n🔵 Testing Circuit Breaker Pattern...");
  console.log("=" + "=".repeat(50));

  const payload = { calls: 20, cooldownMs: 3000 };
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const result = await circuitBreaker.run(payload, mockContext);
    console.log("\n✅ Result:", JSON.stringify(result, null, 2));
    return { success: true, result };
  } catch (error: any) {
    console.log("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function runPartialSuccess() {
  console.log("\n🟡 Testing Partial Success Pattern...");
  console.log("=" + "=".repeat(50));

  const payload = { items: ["a", "b", "c", "d", "e", "f", "g", "h"] };
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const result = await partialSuccess.run(payload, mockContext);
    console.log("\n✅ Result:", JSON.stringify(result, null, 2));
    return { success: true, result };
  } catch (error: any) {
    console.log("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function runHumanEscalation() {
  console.log("\n🟠 Testing Human Escalation Pattern...");
  console.log("=" + "=".repeat(50));

  // Test 1: Escalation
  console.log("\n📋 Test 1: Triggering escalation...");
  const payload1 = { data: "Test data requiring human review" };
  console.log("Payload:", JSON.stringify(payload1, null, 2));

  try {
    const result1 = await humanEscalation.run(payload1, mockContext);
    console.log("\n✅ Escalation Result:", JSON.stringify(result1, null, 2));

    if (result1.escalated && result1.resumeToken) {
      // Test 2: Resume with token
      console.log("\n📋 Test 2: Resuming with token...");
      const payload2 = { data: "Test data requiring human review", resumeToken: result1.resumeToken };
      console.log("Payload:", JSON.stringify(payload2, null, 2));

      const result2 = await humanEscalation.run(payload2, mockContext);
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
  console.log("=" + "=".repeat(50));

  const payload = { prompt: "Explain the benefits of error handling in AI systems" };
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const result = await gracefulDegradation.run(payload, mockContext);
    console.log("\n✅ Result:", JSON.stringify(result, null, 2));
    return { success: true, result };
  } catch (error: any) {
    console.log("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

async function runAll() {
  console.log("\n🧪 Running All Error-Handling Patterns");
  console.log("=" + "=".repeat(50));

  const start = Date.now();
  const results: Record<string, any> = {};

  // Run all tests
  results.circuitBreaker = await runCircuitBreaker();
  results.partialSuccess = await runPartialSuccess();
  results.humanEscalation = await runHumanEscalation();
  results.gracefulDegradation = await runGracefulDegradation();

  // Summary
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

  // Exit with appropriate code
  process.exit(successCount === totalTests ? 0 : 1);
}

// Main execution
const pattern = process.argv[2] || "all";

(async () => {
  console.log("\n🚀 Trigger.dev CLI Test Runner");
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
