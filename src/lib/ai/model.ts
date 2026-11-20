// Server only. One place that calls a model: AI_MODEL, then AI_FALLBACK_MODELS, validated with zod.
// Never imports the DB; call counts go through setAiRecorder. Returns null on any failure: the app carries on.
// Only message text and shop/item data may be passed in (no names, no phone numbers).
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import type { z } from "zod";

export type AiJob = "claim" | "answer" | "scam" | "translate";
export type AiRecorder = (r: { job: AiJob; model: string; ms: number; ok: boolean }) => void;

let record: AiRecorder = () => {};
export function setAiRecorder(fn: AiRecorder) { record = fn; }

const restingUntil = new Map<string, number>(); // model -> time it may be tried again
const QUOTA = /quota|rate.?limit|429|resource.?exhausted/i, BUSY = /high demand|overloaded|503|unavailable/i;

/** A per-minute limit says "retry in 23s": rest that long. No short retry time means the daily quota is gone: half an hour. */
export function quotaRestMs(msg: string): number {
  const m = /retry (?:in|after) ([\d.]+)\s*s\b|"retryDelay":\s*"([\d.]+)s"/i.exec(msg);
  const secs = m ? Number(m[1] ?? m[2]) : NaN;
  return secs > 0 && secs <= 120 ? Math.ceil(secs + 1) * 1000 : 30 * 60_000;
}

export const modelChain = (): string[] =>
  [...new Set([process.env.AI_MODEL || "google/gemini-3.5-flash-lite", ...(process.env.AI_FALLBACK_MODELS ?? "").split(",")].map((m) => m.trim()).filter(Boolean))];

/** First complete {...} object in a model answer, tolerating code fences or chatter around it. */
function parseJsonObject(raw: string): unknown {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no json");
  return JSON.parse(raw.slice(a, b + 1));
}

export async function generateJson<T>(
  job: AiJob, schema: z.ZodType<T>, system: string, prompt: string, opts: { timeoutMs: number; perModelMs?: number },
): Promise<T | null> {
  const t0 = Date.now(), deadline = t0 + opts.timeoutMs;
  let used = "none", ok = false, out: T | null = null;
  try {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("no key");
    const chain = modelChain().filter((m) => (restingUntil.get(m) ?? 0) <= Date.now());
    models: for (const m of chain) {
      used = m;
      let hint = "";
      for (let attempt = 0; attempt < 2; attempt++) {            // one retry on invalid output
        const left = deadline - Date.now();
        if (left < 200) break models;
        try {
          const r = await generateText({
            model: google(m.replace(/^google\//, "")),
            instructions: system, prompt: prompt + hint, temperature: 0, maxOutputTokens: 400, maxRetries: 0,
            abortSignal: AbortSignal.timeout(Math.min(left, opts.perModelMs ?? left)),
          });
          const parsed = schema.safeParse(parseJsonObject(r.text));
          if (parsed.success) { out = parsed.data; ok = true; break models; }
          hint = "\n\nYour last answer was not valid. Reply with ONLY the JSON object, exactly in the requested shape.";
        } catch (e) {
          if (e instanceof SyntaxError || (e instanceof Error && e.message === "no json")) { hint = "\n\nReply with ONLY a JSON object."; continue; }
          const msg = (e instanceof Error ? e.message : String(e)) + " " + String((e as { responseBody?: unknown })?.responseBody ?? "");
          if (QUOTA.test(msg)) restingUntil.set(m, Date.now() + quotaRestMs(msg));
          else if (BUSY.test(msg)) restingUntil.set(m, Date.now() + 60_000);
          else if (/abort|timeout/i.test(msg) && !opts.perModelMs) break models; // out of time: stop (with perModelMs, a slow model hands over to the next)
          break;                                                    // next model
        }
      }
    }
  } catch { /* out stays null */ }
  // no model was tried (no key, or every model resting after a rate limit): a rules-only decision, not a failed AI call
  if (used !== "none") record({ job, model: used, ms: Date.now() - t0, ok });
  return out;
}
