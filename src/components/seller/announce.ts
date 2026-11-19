// Drop announcement texts (English, Hinglish) with the start time in words, India time. Pure: server, browser, tests.

const IST = "Asia/Kolkata";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
const hourIn = (d: Date) => Number(d.toLocaleString("en-GB", { timeZone: IST, hour: "numeric", hourCycle: "h23" }));
const timeEn = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(/\s?([ap])m/i, " $1m").toLowerCase();

/** "tonight 8 pm" / "today 3:30 pm" / "tomorrow 8 pm" / "Fri 21 Nov, 8 pm" and the Hinglish twin, in India time. */
export function whenWords(iso: string, now = new Date()): { en: string; hi: string } {
  const d = new Date(iso), t = timeEn(d), h = hourIn(d);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const part = h >= 17 ? "raat" : h >= 12 ? "dopahar" : "subah";
  const hiTime = `${t.replace(/ [ap]m$/, "")} baje`;
  if (dayKey(d) === dayKey(now)) return { en: `${h >= 17 ? "tonight" : "today"} ${t}`, hi: `aaj ${part} ${hiTime}` };
  if (dayKey(d) === dayKey(tomorrow)) return { en: `tomorrow ${t}`, hi: `kal ${part} ${hiTime}` };
  const date = d.toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" });
  return { en: `${date}, ${t}`, hi: `${date}, ${part} ${hiTime}` };
}

export function announcements(shop: string, title: string, startsAt: string, url: string, now = new Date()) {
  const w = whenWords(startsAt, now);
  return {
    en: `${title} by ${shop}: drop ${w.en}! First tap wins.\nOpen the link, and when a piece goes live tap Dibs. If you get it, pay by UPI and chat with us about your order.\n${url}`,
    hi: `${title} by ${shop}: drop ${w.hi}! Jo pehle tap karega, wahi jeetega.\nLink kholo, piece live hote hi Dibs dabao. Mil gaya toh UPI se pay karo, order ki baat humse chat mein.\n${url}`,
  };
}
