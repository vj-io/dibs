// DB-backed fixed-window rate limits (rate_add), so a limit holds across server instances. Server only.
import { fn } from "./db.ts";
import { fail } from "./http.ts";

/** Throws 429 when `key` has had more than `max` hits in the current `windowSeconds` window. */
export async function rateLimit(key: string, max: number, windowSeconds: number, message = "Too many tries. Wait a moment and try again."): Promise<void> {
  const n = await fn<number>("rate_add", key, windowSeconds);
  if (n > max) fail(429, "rate_limited", message);
}
