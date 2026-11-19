"use client";
// Waiting-room reminder: .ics download, Google Calendar and a WhatsApp share, for a drop that has not started.
import { LinkButton } from "@/components/ui";
import { istWhen } from "@/lib/when";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function Remind({ dropId, title, startsAt, shareUrl }: { dropId: string; title: string; startsAt: string; shareUrl: string }) {
  const start = new Date(startsAt);
  const google = "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE", text: title, dates: `${stamp(start)}/${stamp(new Date(start.getTime() + 30 * 60_000))}`,
    details: `First tap wins. Open the sale room when it starts: ${shareUrl}`, location: shareUrl,
  });
  const wa = "https://wa.me/?text=" + encodeURIComponent(`${title}\n${istWhen(startsAt)}. First tap wins.\n${shareUrl}`);
  return (
    <section aria-label="Remind me" className="flex flex-col gap-3">
      <p className="font-hand text-xl leading-tight">Don&apos;t miss the start</p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={`/api/drops/${dropId}/calendar`} download variant="primary" icon="bell" prefetch={false}>Add to calendar</LinkButton>
        <LinkButton href={google} target="_blank" rel="noopener noreferrer" variant="ghost" icon="clock" prefetch={false}>Google Calendar</LinkButton>
        <LinkButton href={wa} target="_blank" rel="noopener noreferrer" variant="ghost" icon="share" prefetch={false}>Share on WhatsApp</LinkButton>
      </div>
    </section>
  );
}
