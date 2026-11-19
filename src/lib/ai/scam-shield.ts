// Scam shield rules (PRD FR-31 rule 1), hardened. Pure: no imports.
// Blocks contact and payment details in the public sale room; never blocks prices, item numbers or sizes.

export type ScamRule = "phone" | "upi" | "pay_link" | "pay_request";
/** What a buyer sees when a message is refused or removed. */
export const BLOCKED_TEXT = "Phone numbers and UPI IDs can't be shared in the sale room. Use your order chat.";

const HANDLES = [
  "ybl", "okaxis", "okhdfcbank", "okicici", "oksbi", "paytm", "upi", "ibl", "axl", "apl", "axisbank", "sbi", "icici",
  "hdfcbank", "hdfc", "pnb", "cnrb", "barodampay", "fbl", "ikwik", "freecharge", "kotak", "yesbank", "yapl", "abfspay",
  "waicici", "wahdfcbank", "waaxis", "wasbi", "rapl", "okbizaxis", "ptyes", "pthdfc", "ptsbi", "ptaxis", "axb", "postbank",
  "aubank", "idfcfirst", "mahb", "uboi", "cbin", "naviaxis", "tapicici", "jupiteraxis", "superyes", "bandhan",
].join("|");
const MAIL = "gmail|yahoo|hotmail|outlook|icloud|proton|protonmail|rediffmail";

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  shunya: "0", ek: "1", teen: "3", char: "4", chaar: "4", panch: "5", paanch: "5", chhe: "6", che: "6", chhah: "6",
  saat: "7", aath: "8", nau: "9",
};

/** Lower-case, ASCII digits (Devanagari and full-width too), no zero-width characters, curly apostrophes removed. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x966))
    .toLowerCase();
}

/** Indian mobile number hiding in digits, spaced digits or digit words (best effort). */
function hasPhone(t: string): boolean {
  const words = t.replace(/[a-z]+/g, (w) => DIGIT_WORDS[w] ?? w);
  const runs = words.match(/\d+(?:[\s\-.,()/_]+\d+)*/g) ?? [];
  for (const run of runs) {
    const groups = run.match(/\d+/g)!;
    for (let i = 0; i < groups.length; i++) {
      if (/^(?:91|0091|0)?[6-9]\d{9}$/.test(groups[i])) return true;
      let sum = "";
      let j = i;
      while (j < groups.length && sum.length < 10) sum += groups[j++];
      if (sum.length !== 10 || !/^[6-9]/.test(sum) || j - i < 2) continue;
      // "8 9 10 11 12 13" (a size list) counts up by one: not a phone number
      const nums = groups.slice(i, j).map(Number);
      if (nums.every((n, k) => k === 0 || n === nums[k - 1] + 1)) continue;
      return true;
    }
  }
  return false;
}

const UPI_ID = new RegExp(
  [
    `[\\w.\\-]+@[a-z]{2,}`,                                                 // PRD rule: x@word (also covers emails)
    `[\\w.\\-]{2,}\\s*@\\s*(?:${HANDLES})\\b`,                                  // "name @ okaxis"
    `[\\w.\\-]{2,}\\s*[(\\[{<]\\s*(?:at|@)\\s*[)\\]}>]\\s*[a-z]{2,}`,           // name(at)paytm, name[at]gmail
    `[\\w.\\-]{2,}\\s+at\\s+(?:the\\s+rate\\s+(?:of\\s+)?)?(?:${HANDLES}|${MAIL})\\b`, // "name at ybl", "name at the rate of ybl"
  ].join("|"),
);

const PAY_LINK = new RegExp(
  [
    `upi:\\/\\/`, `\\bpay\\.[a-z]`, `https?:\\/\\/\\S*pay`, `\\b[a-z0-9.\\-]*pay[a-z0-9\\-]*\\.(?:com|in|me|co|app|link|page)\\b`,
    `phon\\.pe`, `paytm\\.me`, `rzp\\.io`, `razorpay`, `\\bbhim\\b.*\\blink\\b`,
  ].join("|"),
);
// WhatsApp / Telegram links are contact details like a number is
const CONTACT_LINK = /\b(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me)\b/;

const APPS = "gpay|g\\s?pay|google\\s?pay|phone\\s?pe|paytm|bhim|amazon\\s?pay|cred|mobikwik|upi";
const NUM = "\\d[\\d\\s\\-.,]{2,}\\d|\\d{2,}";
const PAY_REQUEST = new RegExp(
  [
    `\\b(?:${APPS})\\b[^\\d]{0,30}(?:${NUM})`,                                   // "gpay 98..." / "paytm on 500"
    `(?:${NUM})[^\\d]{0,30}\\b(?:${APPS})\\b`,                                   // "500 on gpay"
    `\\b(?:pay|send|transfer|bhej|bhejo|bhejna|de\\s?do)\\b[^\\d]{0,20}(?:${NUM})\\b[^\\d]{0,20}\\b(?:advance|first|me|to\\s+me|here|now\\s+on|on\\s+this|mujhe|account|acc)\\b`,
    `\\b(?:pay|send|transfer)\\s+(?:me|to\\s+me|here|on\\s+this|advance)\\b[^\\d]{0,20}(?:${NUM})`,
    `\\b(?:send|transfer)\\s+(?:the\\s+)?money\\b`,
    `\\b(?:paisa|paise|payment)\\s+(?:bhej|send|transfer|kar\\s+do|karo)\\b[^\\d]{0,20}(?:${NUM})`,
    `\\b(?:account\\s*(?:no|number|num)|a\\/c|acc\\s*no|ifsc)\\b`,
  ].join("|"),
);

export function scamRules(text: string): { blocked: boolean; rule: ScamRule | null } {
  const t = normalise(text);
  const compact = t.replace(/['’`]/g, "");
  if (CONTACT_LINK.test(compact)) return { blocked: true, rule: "phone" };
  if (hasPhone(compact)) return { blocked: true, rule: "phone" };
  if (PAY_LINK.test(compact)) return { blocked: true, rule: "pay_link" };
  if (UPI_ID.test(compact)) return { blocked: true, rule: "upi" };
  if (PAY_REQUEST.test(compact)) return { blocked: true, rule: "pay_request" };
  return { blocked: false, rule: null };
}

const BORDERLINE = new RegExp(
  [
    `\\bd\\.?m\\b`, `\\binbox\\b`, `\\bwhats\\s?app\\b`, `\\bwa\\b`, `\\btelegram\\b`, `\\binsta(?:gram)?\\b`,
    `\\b(?:msg|message|text|ping|pm|call|contact|connect)\\s+(?:me|us)\\b`, `\\bpersonally\\b`, `\\bpersonal\\b`,
    `\\b(?:cheaper|cheap|lower|better|special|discount)\\s+(?:rate|price|deal)\\b`, `\\boutside\\b`, `\\bprivate(?:ly)?\\b`,
    `\\bdirect(?:ly)?\\b`, `\\bsasta\\b`, `\\bsasti\\b`, `\\balag\\s+se\\b`, `\\bapne\\s+pass\\b`, `\\bmujhe\\s+(?:msg|message|call)\\b`,
    `\\bnumber\\s+(?:do|de|dedo|send|share)\\b`, `\\bshare\\s+(?:your\\s+)?(?:number|no)\\b`,
  ].join("|"),
);

/** Text that rules let through but that is worth one AI look. */
export function borderline(text: string): boolean {
  return BORDERLINE.test(normalise(text).replace(/['’`]/g, ""));
}
