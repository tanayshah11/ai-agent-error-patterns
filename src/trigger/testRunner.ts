import { task } from "@trigger.dev/sdk/v3";
import { circuitBreaker } from "./circuitBreaker";
import { partialSuccess } from "./partialSuccess";
import { humanEscalation } from "./humanEscalation";
import { gracefulDegradation } from "./gracefulDegradation";

/**
 * Test runner that validates all 4 error-handling patterns
 * Run this task to test all patterns in sequence
 */
export const testAllPatterns = task({
  id: "agents.test-all-patterns",
  run: async (payload: { skipEscalation?: boolean }, ctx) => {
    const results: Record<string, any> = {};
    const start = Date.now();

    console.log("🧪 Testing all error-handling patterns...\n");

    // Test 1: Circuit Breaker
    console.log("1️⃣ Testing Circuit Breaker pattern...");
    try {
      const cb = await circuitBreaker.run({ calls: 20, cooldownMs: 3000 }, ctx);
      results.circuitBreaker = {
        success: true,
        data: cb,
        message: "Circuit breaker pattern executed successfully",
      };
      console.log("✅ Circuit Breaker: PASSED\n");
    } catch (e: any) {
      results.circuitBreaker = {
        success: false,
        error: e.message,
      };
      console.log(`❌ Circuit Breaker: FAILED - ${e.message}\n`);
    }

    // Test 2: Partial Success
    console.log("2️⃣ Testing Partial Success pattern...");
    try {
      const ps = await partialSuccess.run({
        items: ["item1", "item2", "item3", "item4", "item5", "item6", "item7", "item8"],
      }, ctx);
      results.partialSuccess = {
        success: true,
        data: ps,
        message: "Partial success pattern executed successfully",
      };
      console.log("✅ Partial Success: PASSED\n");
    } catch (e: any) {
      results.partialSuccess = {
        success: false,
        error: e.message,
      };
      console.log(`❌ Partial Success: FAILED - ${e.message}\n`);
    }

    // Test 3: Human Escalation (skip by default in automated tests)
    if (!payload.skipEscalation) {
      console.log("3️⃣ Testing Human Escalation pattern...");
      try {
        // First run - should escalate
        const he1 = await humanEscalation.run({
          data: "Test escalation scenario",
        }, ctx);

        results.humanEscalation = {
          success: true,
          data: he1,
          message: "Human escalation pattern triggered (manual resume required)",
          note: "Check dashboard for resumeToken and manually trigger second run",
        };
        console.log("✅ Human Escalation: TRIGGERED (requires manual resume)\n");
      } catch (e: any) {
        results.humanEscalation = {
          success: false,
          error: e.message,
        };
        console.log(`❌ Human Escalation: FAILED - ${e.message}\n`);
      }
    } else {
      results.humanEscalation = { skipped: true };
      console.log("3️⃣ Human Escalation: SKIPPED\n");
    }

    // Test 4: Graceful Degradation
    console.log("4️⃣ Testing Graceful Degradation pattern...");
    try {
      const gd = await gracefulDegradation.run({
        prompt: "Summarize the key benefits of error handling in AI agent workflows",
      }, ctx);
      results.gracefulDegradation = {
        success: true,
        data: gd,
        message: "Graceful degradation pattern executed successfully",
      };
      console.log("✅ Graceful Degradation: PASSED\n");
    } catch (e: any) {
      results.gracefulDegradation = {
        success: false,
        error: e.message,
      };
      console.log(`❌ Graceful Degradation: FAILED - ${e.message}\n`);
    }

    const durationMs = Date.now() - start;
    const successCount = Object.values(results).filter(r => r.success).length;
    const totalTests = Object.keys(results).filter(k => !results[k].skipped).length;

    console.log(`\n📊 Test Summary: ${successCount}/${totalTests} patterns passed`);

    return {
      ok: successCount === totalTests,
      totalTests,
      successCount,
      failedCount: totalTests - successCount,
      durationMs,
      results,
      timestamp: new Date().toISOString(),
    };
  },
});
