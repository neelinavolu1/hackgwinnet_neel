import { STEPS, type StepName } from "./chain";
import { getClient, mockClient, type ClientEnv } from "./jev";
import { redact } from "./redaction";

const MAX_TEXT = 20_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/**
 * One classification step. Shared by the Pages Function and the `next dev` route.
 * Stores nothing and logs nothing. Steps and labels are allow-listed, so this can't be used
 * as an open proxy to the Jev key.
 */
export async function handleClassify(body: unknown, env: ClientEnv) {
  const { step, text, labels } = (body ?? {}) as { step?: string; text?: unknown; labels?: unknown };
  const def = STEPS[step as StepName];
  if (!def || typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) return json({ error: "Bad request" }, 400);
  const chosen = Array.isArray(labels) && labels.length > 0 ? labels : def.labels;
  if (!chosen.every((l) => def.labels.includes(l))) return json({ error: "Bad labels" }, 400);

  // Second lock on the door: the browser already redacted, and this runs the same rules again.
  const clean = redact(text).redacted;
  const { classify, name } = getClient(env);
  try {
    return json({ results: await classify(clean, chosen, def), client: name });
  } catch {
    // Keeps a live demo going, and the client tag makes the UI say so out loud.
    return json({ results: await mockClient(clean, chosen, def), client: "mock-fallback" });
  }
}
