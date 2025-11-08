import { task } from "@trigger.dev/sdk/v3";
import { retry } from "@trigger.dev/sdk/v3";

export const partialSuccess = task({
  id: "agents.partial-success",
  run: async (payload: { items: string[] }) => {
    const start = Date.now();
    const results: Record<string, { ok: boolean; attempts: number; reason?: string }> = {};

    for (const id of payload.items) {
      const key = `item:${id}`; // idempotency hint for real impl
      let attempts = 0;

      const res = await (async () => {
        try {
          return await retry.onThrow(
            async () => {
              attempts++;
              // simulate token/rate errors
              const r = Math.random();
              if (r < 0.05) throw Object.assign(new Error("Token limit"), { code: "TOKEN_LIMIT" });
              if (r < 0.10) throw Object.assign(new Error("Rate limited"), { code: "RATE_LIMIT" });
              return { ok: true as const };
            },
            { maxAttempts: 3, factor: 2 }
          );
        } catch (e: any) {
          // For token limits, don't retry - return failure immediately
          return { ok: false as const, reason: e?.code || e?.message };
        }
      })();

      results[key] = { ok: res.ok, attempts, reason: (res as any).reason };
    }

    const ok = Object.values(results).filter(r => r.ok).length;
    const failed = Object.values(results).length - ok;
    return { ok: failed === 0, okCount: ok, failedCount: failed, durationMs: Date.now() - start, results };
  },
});
