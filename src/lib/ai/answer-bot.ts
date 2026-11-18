// Answer bot pieces (PRD FR-30): trigger, knowledge text, output guard. Pure apart from zod.
import { z } from "zod";

export type LiveKnowledge = { title: string; pricePaise: number; note: string | null; variants: { label: string; left: number }[] };

const QUESTION_WORDS = new RegExp(
  `\\b(?:price|rate|kitna|kitne|kitni|milega|milegi|milta|hai kya|h kya|kya|kab|cod|cash on delivery|size|shipping|ship|delivery|courier|return|exchange|refund|original|silver|gold|colou?r|available|stock|discount|offer|material|quality|warranty|how much|when|which)\\b`,
);

/** Does a sale-room message look like a question the bot may answer? */
export function isQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/['’`]/g, "");
  return /\?[\s\p{Extended_Pictographic}‍️]*$/u.test(t.trim()) || QUESTION_WORDS.test(t);
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

/** The only facts the bot may use: shop FAQ lines plus the live piece. Empty string when there is nothing. */
export function buildKnowledge(shopFaq: string[], live: LiveKnowledge | null): string {
  const parts: string[] = [];
  const faq = shopFaq.map((l) => l.trim()).filter(Boolean);
  if (faq.length) parts.push("Shop FAQ:\n" + faq.map((l) => `- ${l}`).join("\n"));
  if (live) {
    parts.push([
      "Piece on sale now:",
      `Title: ${live.title}`,
      `Price: ${rupees(live.pricePaise)}`,
      live.note?.trim() ? `Note: ${live.note.trim()}` : "",
      "Variants: " + (live.variants.map((v) => `${v.label} (${v.left > 0 ? `${v.left} left` : "sold out"})`).join(", ") || "none"),
    ].filter(Boolean).join("\n"));
  }
  return parts.join("\n\n");
}

export const AnswerSchema = z.object({ answerable: z.boolean(), answer: z.string() });
export type Answer = { answerable: boolean; answer: string };

const stripNum = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "").replace(/^0+(?=\d)/, "");
const numbersIn = (s: string) => new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(stripNum));
const NUM = "(\\d[\\d,]*(?:\\.\\d+)?)";
// rupee amounts, and numbers followed by %, off, days, hours (a discount or delivery promise)
const CLAIMED = [
  new RegExp(`(?:₹|rs\\.?|inr|rupees?)\\s*${NUM}`, "gi"),
  new RegExp(`${NUM}\\s*(?:₹|rs\\b|rupees?|%|percent|off\\b|days?\\b|din\\b|hours?\\b|hrs?\\b)`, "gi"),
];

/** Parse and guard the model's answer. `knowledge` is the exact text the model was given. */
export function validateAnswer(raw: unknown, knowledge: string): Answer {
  const no: Answer = { answerable: false, answer: "" };
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const m = /\{[\s\S]*\}/.exec(raw);
    try { obj = m ? JSON.parse(m[0]) : null; } catch { return no; }
  }
  const r = AnswerSchema.safeParse(obj);
  if (!r.success || !r.data.answerable) return no;
  const answer = r.data.answer.trim().slice(0, 160).trim();
  if (!answer) return no;
  const known = numbersIn(knowledge);
  for (const re of CLAIMED)
    for (const m of answer.matchAll(re)) if (!known.has(stripNum(m[1]))) return no;
  return { answerable: true, answer };
}
