import { task } from "@trigger.dev/sdk/v3";
import { AbortTaskRunError } from "@trigger.dev/sdk/v3";

// Demo: first run "escalates" and asks to resume with a token.
export const humanEscalation = task({
  id: "agents.human-escalation",
  run: async (payload: { data: string; resumeToken?: string }) => {
    const start = Date.now();

    if (!payload.resumeToken) {
      // send webhook / Slack / issue create here (omitted for example)
      return {
        ok: false,
        escalated: true,
        message: "Escalated for review. Re-run with resumeToken to continue.",
        resumeToken: "RESUME-123",
        durationMs: Date.now() - start,
      };
    }

    // resumed by human with token → proceed
    if (payload.resumeToken !== "RESUME-123") throw new AbortTaskRunError("Invalid resume token");
    return { ok: true, resumed: true, durationMs: Date.now() - start };
  },
});
