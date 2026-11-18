import Link from "next/link";
import type { ReactNode } from "react";
import { StatePill } from "./badge";
import { cx } from "./cx";
import { Logo, Squiggle } from "./doodles";

/** Top bar: logo (links home), optional title, LIVE badge, viewer-count slot and a right slot. */
export function AppHeader({ title, live, viewers, right, className }: {
  title?: ReactNode; live?: boolean; viewers?: ReactNode; right?: ReactNode; className?: string;
}) {
  return (
    <header className={cx("sticky top-0 z-30 border-b-[2.5px] border-ink bg-paper/95 backdrop-blur-sm", className)}>
      <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-2 px-4 py-1.5">
        <Link href="/" aria-label="Dibs home" className="-ml-1 flex min-h-12 items-center rounded-md px-1">
          <Logo size="sm" compact={!!title} />
        </Link>
        {title && <span className="min-w-0 flex-1 truncate font-semibold sm:flex-none">{title}</span>}
        {live && <StatePill state="live" size="sm" />}
        {viewers && <span className="whitespace-nowrap font-mono text-sm text-muted">{viewers}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>
      </div>
    </header>
  );
}

/** Site footer: links, team credit and the Nexconn note. */
export function Footer({ className }: { className?: string }) {
  const links = [
    { href: "/how-it-works", label: "How it works" },
    { href: "/impact", label: "Impact" },
    { href: "/try", label: "Try the demo" },
  ];
  return (
    <footer className={cx("mt-16 border-t-[2.5px] border-ink bg-card", className)}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Logo size="sm" />
          <p className="max-w-xs font-hand text-lg leading-snug text-muted">First tap wins. Everyone sees it. Nobody gets lost in the DMs.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-1 gap-y-0">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-12 items-center px-2 font-semibold underline decoration-2 hover:decoration-lime">{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-8">
        <Squiggle className="mb-4 h-2.5 w-40 text-ink/30" draw={false} />
        <p className="text-[0.95rem] text-muted">Built by Team Kaching for the Nexconn Build Challenge 2026.</p>
        <p className="text-[0.95rem] text-muted">Built on Nexconn: the sale rooms, order chats and team desk are live Nexconn channels.</p>
      </div>
    </footer>
  );
}

/** A phone-shaped frame for live previews (seller console, landing page). Content scrolls inside. */
export function PhoneFrame({ children, label, className, height = 640 }: {
  children: ReactNode; label?: ReactNode; className?: string; height?: number;
}) {
  return (
    <figure className={cx("mx-auto w-full max-w-[340px]", className)}>
      {label && <figcaption className="mb-2 text-center font-hand text-lg leading-tight text-muted">{label}</figcaption>}
      <div className="rounded-[40px_36px_42px_34px/36px_42px_34px_40px] border-[3px] border-ink bg-ink p-2 shadow-ink-lg">
        <div className="relative overflow-hidden rounded-[32px_28px_34px_26px/28px_34px_26px_32px] bg-paper" style={{ height }}>
          <div aria-hidden="true" className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-pill bg-ink" />
          <div className="grid-paper h-full overflow-y-auto overflow-x-hidden pt-8 [scrollbar-width:none]">{children}</div>
        </div>
      </div>
    </figure>
  );
}
