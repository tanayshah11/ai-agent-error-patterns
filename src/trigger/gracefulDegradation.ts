import { task } from "@trigger.dev/sdk/v3";

async function callLLM(model: "primary" | "secondary", prompt: string, mock = true) {
  if (mock) {
    if (model === "primary") throw Object.assign(new Error("Primary down"), { code: "PRIMARY_DOWN" });
    return `fallback(${prompt.slice(0, 12)})`;
  }
  // Real LLM call would go here using OPENAI_API_KEY; omitted for example.
  throw new Error("Real LLM not implemented");
}

export const gracefulDegradation = task({
  id: "agents.graceful-degradation",
  run: async (payload: { prompt: string }) => {
    const start = Date.now();
    const mock = process.env.LLM_MOCK === "1";

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
  },
});
