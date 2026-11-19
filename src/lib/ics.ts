// Minimal RFC 5545 calendar file: one VEVENT, UTC times, CRLF lines folded at 75 octets, a 10-minute alarm. Pure.
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds on code-point boundaries so a multi-byte character is never split. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; } // continuation lines lose 1 octet to the leading space
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(e: { uid: string; title: string; startsAt: Date; minutes?: number; url: string; now?: Date }): string {
  const end = new Date(e.startsAt.getTime() + (e.minutes ?? 30) * 60_000);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dibs//Drop reminder//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}@dibs`,
    `DTSTAMP:${utc(e.now ?? new Date())}`,
    `DTSTART:${utc(e.startsAt)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc(`First tap wins. Open the sale room when it starts: ${e.url}`)}`,
    `URL:${e.url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, "TRIGGER:-PT10M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
