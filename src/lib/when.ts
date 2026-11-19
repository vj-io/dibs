// Drop start time written out in IST ("Tonight · 8:00 pm IST", "Sat 21 Nov · 8:00 pm IST"). Pure: runs on server and client.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_MS = 5.5 * 3600_000; // India has no daylight saving

/** Shifted so the UTC getters read IST wall-clock fields. */
const ist = (ms: number) => new Date(ms + IST_MS);
const dayNo = (d: Date) => Math.floor(d.getTime() / 86_400_000);

export function istWhen(iso: string | Date, now: number = Date.now()): string {
  const at = ist(new Date(iso).getTime());
  const h = at.getUTCHours(), m = at.getUTCMinutes();
  const clock = `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"} IST`;
  const diff = dayNo(at) - dayNo(ist(now));
  const day = diff === 0 ? (h >= 17 ? "Tonight" : "Today") : diff === 1 ? "Tomorrow"
    : `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  return `${day} · ${clock}`;
}
