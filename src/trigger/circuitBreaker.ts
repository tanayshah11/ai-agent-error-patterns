import { task } from "@trigger.dev/sdk/v3";
import { retry } from "@trigger.dev/sdk/v3";

// Demo in-memory breaker for examples (not persisted)
let consecutive = 0;
let openedUntil = 0;

export const circuitBreaker = task({
  id: "agents.circuit-breaker",
  run: async (payload: { calls: number; cooldownMs?: number }) => {
    const start = Date.now();
    const cooldown = payload.cooldownMs ?? 5000;
    const maxConsecutive = 5;
    const results: Array<{ ok: boolean; status?: number }> = [];

    for (let i = 0; i < payload.calls; i++) {
      const now = Date.now();
      if (now < openedUntil) {
        results.push({ ok: false, status: 503 }); // fail fast while open
        continue;
      }

      const r = await retry.onThrow(
        async () => {
          // simulate flaky upstream (30% fail)
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
  },
});
