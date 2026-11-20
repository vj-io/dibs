// Order-chat translation pieces with no imports, so the order room (client) can use defaultTarget. The model call is in jobs.ts.
export type Lang = "en" | "hi";
export const MAX_TRANSLATE_CHARS = 500;

/** Staff read English; a buyer reads Hindi when the browser asks for Hindi ("hi", "hi-IN"), else English. */
export const defaultTarget = (viewer: "buyer" | "staff", browserLang = ""): Lang =>
  viewer === "buyer" && /^hi\b/i.test(browserLang) ? "hi" : "en";

/**
 * Wraps a translator with an in-process cache keyed by target + text, so a repeated tap costs no model call.
 * Failures (null) are not cached. Past `max` entries the oldest goes.
 * ponytail: one cache per server instance; a shared cache (a table) only if the same lines are translated across instances a lot.
 */
export function cachedTranslator(ai: (text: string, to: Lang) => Promise<string | null>, max = 500) {
  const cache = new Map<string, string>();
  return async (text: string, to: Lang): Promise<string | null> => {
    const key = `${to}\n${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const out = await ai(text, to);
    if (out === null) return null;
    if (cache.size >= max) cache.delete(cache.keys().next().value!);
    cache.set(key, out);
    return out;
  };
}
