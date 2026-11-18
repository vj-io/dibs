// Typed-claim helper rules (PRD FR-29). Pure. A typed message never claims anything; at most it earns a one-tap prompt.

export type LiveItem = { itemId: string; position: number; variants: { key: string; label: string }[] };
export type ClaimIntent =
  | { kind: "prompt"; itemId: string; position: number; variantKey: string | null }
  | { kind: "unclear" }
  | { kind: "none" };

const KEYWORDS = /\b(?:booked|book|mine|dibs|mera|mujhe|chahiye|chahie|chaiye|want|le lunga|le lungi|le loonga|lena hai|lena h|sold|done|ill take|i will take|take it)\b/;
const NOT_A_CLAIM = /\bwant to (?:know|ask|see|check)\b/;
const QUESTION = /\?|\b(?:kya|kitna|kitne|kitni|kaise|kab|kyun|kaun|how|what|when|which)\b/;
// "woh blue wala": points at something without saying what to do
const SOFT = /\b(?:wala|wali|waala|woh|wo|yeh|ye|this one|that one|isko|usko|wahi)\b/;

const ALIASES: string[][] = [
  ["s", "small"], ["m", "medium"], ["l", "large"], ["xl", "extra large", "xlarge"], ["xxl", "2xl", "xx large"], ["xs", "extra small"],
  ["red", "laal", "lal"], ["blue", "neela", "neeli", "nila"], ["black", "kala", "kaala", "kali"], ["white", "safed", "safaid"],
  ["green", "hara", "hari"], ["yellow", "peela", "peeli", "pila"], ["pink", "gulabi"], ["orange", "narangi"], ["grey", "gray", "slate"],
];

/** Lower-case words separated by single spaces, padded: " m size hai ". Apostrophes vanish ("i'll" -> "ill"). */
const words = (s: string) => ` ${s.toLowerCase().replace(/['’`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

function aliasesOf(label: string): string[] {
  const l = words(label).trim();
  const group = ALIASES.find((g) => g.includes(l));
  return group ? group : [l];
}

function matchVariants(text: string, variants: LiveItem["variants"]): string[] {
  const cands = variants.flatMap((v) => aliasesOf(v.label).map((a) => ({ key: v.key, a })));
  cands.sort((x, y) => y.a.length - x.a.length);          // "extra large" before "large"
  let rest = words(text);
  const hit = new Set<string>();
  for (const { key, a } of cands) {
    if (a && rest.includes(` ${a} `)) {
      hit.add(key); rest = rest.replace(` ${a} `, "  ");
      // "blue" also names "Navy Blue": the word alone does not tell them apart
      for (const v of variants) if (v.key !== key && words(v.label).includes(` ${a} `)) hit.add(v.key);
    }
  }
  return [...hit];
}

export function claimIntent(text: string, live: LiveItem, recentPositions: number[]): ClaimIntent {
  const w = words(text);
  if (w.trim().length === 0 || QUESTION.test(text.toLowerCase())) return { kind: "none" };

  const nums = new Set<number>();
  const lower = text.toLowerCase();
  for (const re of [/#\s*(\d{1,3})\b/g, /\b(\d{1,3})\s*(?:no|number|nbr)\b\.?/g, /\b(?:no|number|nbr)\.?\s*(\d{1,3})\b/g])
    for (const m of lower.matchAll(re)) nums.add(Number(m[1]));

  const keywordHit = KEYWORDS.test(w) && !NOT_A_CLAIM.test(lower);
  const variantKeys = matchVariants(text, live.variants);

  if (nums.size > 1) return { kind: "unclear" };
  if (nums.size === 1) {
    const n = [...nums][0];
    if (n !== live.position) return recentPositions.includes(n) ? { kind: "none" } : { kind: "unclear" };
  }
  if (!keywordHit && nums.size === 0) {
    return SOFT.test(w) && (variantKeys.length > 0 || live.variants.length > 1) ? { kind: "unclear" } : { kind: "none" };
  }
  if (variantKeys.length > 1) return { kind: "unclear" };
  return { kind: "prompt", itemId: live.itemId, position: live.position, variantKey: variantKeys[0] ?? (live.variants.length === 1 ? live.variants[0].key : null) };
}

/** Exact copy from the PRD Key copy table. */
export function promptText(position: number, variantLabel: string | null): string {
  return `Want this? Tap to Dibs #${position}${variantLabel ? ` · ${variantLabel}` : ""}`;
}
