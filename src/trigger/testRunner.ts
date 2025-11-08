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
      const cbResult = await circuitBreaker.triggerAndWait({ calls: 20, cooldownMs: 3000 });
      if (cbResult.ok) {
        results.circuitBreaker = {
          success: true,
          data: cbResult.output,
          message: "Circuit breaker pattern executed successfully",
        };
        console.log("✅ Circuit Breaker: PASSED\n");
      } else {
        throw cbResult.error;
      }
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
      const psResult = await partialSuccess.triggerAndWait({
        items: ["item1", "item2", "item3", "item4", "item5", "item6", "item7", "item8"],
      });
      if (psResult.ok) {
        results.partialSuccess = {
          success: true,
          data: psResult.output,
          message: "Partial success pattern executed successfully",
        };
        console.log("✅ Partial Success: PASSED\n");
      } else {
        throw psResult.error;
      }
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
        const heResult = await humanEscalation.triggerAndWait({
          data: "Test escalation scenario",
        });
        if (heResult.ok) {
          results.humanEscalation = {
            success: true,
            data: heResult.output,
            message: "Human escalation pattern triggered (manual resume required)",
            note: "Check dashboard for resumeToken and manually trigger second run",
          };
          console.log("✅ Human Escalation: TRIGGERED (requires manual resume)\n");
        } else {
          throw heResult.error;
        }
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
      const gdResult = await gracefulDegradation.triggerAndWait({
        prompt: "Summarize the key benefits of error handling in AI agent workflows",
      });
      if (gdResult.ok) {
        results.gracefulDegradation = {
          success: true,
          data: gdResult.output,
          message: "Graceful degradation pattern executed successfully",
        };
        console.log("✅ Graceful Degradation: PASSED\n");
      } else {
        throw gdResult.error;
      }
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
