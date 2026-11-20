"use client";
// Seller shell: top bar (logo, shop, who is signed in, sign out) and the section nav. Sandbox shops get the demo banner.
// Buyer messages in order rooms show on every seller page: a count on Desk, a strip under the nav, "(N)" in the tab title.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Banner, Button, Card, cx, Icon, LinkButton, Logo, type IconName } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { InboxItem, SellerMe } from "@/lib/types";
import { MeProvider } from "./kit";

const messages = (n: number) => `${n} new message${n === 1 ? "" : "s"}`;

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/seller/drops", label: "Drops", icon: "live" },
  { href: "/seller/products", label: "Products", icon: "bag" },
  { href: "/seller/desk", label: "Desk", icon: "chat" },
  { href: "/seller/club", label: "Club", icon: "bell" },
  { href: "/seller/dashboard", label: "Dashboard", icon: "sparkle" },
  { href: "/seller/shop", label: "Shop", icon: "users" },
  { href: "/health", label: "Health", icon: "shield" },
];

export function SellerShell({ me, children }: { me: SellerMe; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [noticeRead, setNoticeRead] = useState(false);
  const readNotice = () => { setNoticeRead(true); api("DELETE /api/seller/notice").then(() => router.refresh(), () => {}); };
  const signOut = async () => {
    setBusy(true);
    try { await api("DELETE /api/seller/session"); } catch { /* the cookie may already be gone */ }
    router.replace("/seller");
    router.refresh();
  };

  // seller inbox: every 15 s, when the tab comes back, and when an open order room marks its messages read
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  useEffect(() => {
    let gone = false;
    const poll = () => { api("GET /api/seller/inbox").then((r) => { if (!gone) setInbox(r.items); }, () => {}); };
    const back = () => { if (document.visibilityState === "visible") poll(); };
    poll();
    const t = setInterval(poll, 15_000);
    window.addEventListener("focus", poll);
    window.addEventListener("dibs:inbox", poll);
    document.addEventListener("visibilitychange", back);
    return () => {
      gone = true; clearInterval(t);
      window.removeEventListener("focus", poll); window.removeEventListener("dibs:inbox", poll);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  const unread = inbox.reduce((n, x) => n + x.unread, 0); // ponytail: the 20 newest orders only
  // "(N) " in front of whatever title the page sets, kept there when a navigation changes the title
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\) /, ""), want = unread ? `(${unread}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); document.title = document.title.replace(/^\(\d+\) /, ""); };
  }, [unread]);

  return (
    <MeProvider me={me}>
      <header className="border-b-[2.5px] border-ink bg-paper">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
          <Link href="/seller/drops" aria-label="Seller home" className="-ml-1 flex min-h-12 items-center rounded-md px-1"><Logo size="sm" compact /></Link>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-extrabold" data-testid="shop-name">{me.shop.name}</p>
            <p className="truncate text-sm text-muted">{me.displayName} · {me.role === "owner" ? "Owner" : "Team"}</p>
          </div>
          <Button size="sm" variant="ghost" icon="arrowRight" busy={busy} busyLabel="Signing out…" onClick={signOut}>Sign out</Button>
        </div>
        <nav aria-label="Seller" className="mx-auto max-w-7xl overflow-x-auto px-2 [scrollbar-width:none]">
          <ul className="flex min-w-max gap-1 pb-1.5">
            {NAV.map((n) => {
              const on = path === n.href || path.startsWith(n.href + "/");
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={on ? "page" : undefined}
                    className={cx("inline-flex min-h-12 items-center gap-1.5 rounded-wobble-2 border-2 px-3 font-semibold",
                      on ? "border-ink bg-lime shadow-ink-sm" : "border-transparent hover:border-ink/30")}>
                    <Icon name={n.icon} size={18} />{n.label}
                    {n.href === "/seller/desk" && unread > 0 && (
                      <Badge size="sm" tint="pink" className="ml-0.5"><span aria-hidden>{unread}</span><span className="sr-only">, {messages(unread)}</span></Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      {/* always in the page, so the polite region announces new lines (a region added with its text is often missed) */}
      <div role="status" aria-live="polite" className="mx-auto w-full max-w-7xl px-4">
        {inbox.length > 0 && (
          <Card flat tint="sky" data-testid="seller-inbox" className="mt-3 p-2 sm:p-3">
            <ul className="flex flex-col gap-1">
              {inbox.slice(0, 3).map((x) => (
                <li key={x.orderId} className="flex items-center gap-2">
                  <Icon name="chat" size={18} className="hidden shrink-0 text-sky-ink sm:block" />
                  <p className="min-w-0 flex-1 leading-snug">
                    {/* who and how many first: a phone cuts this row after ~25 letters */}
                    <span className="block truncate"><b>{x.buyer}</b> · {messages(x.unread)} · Order #{x.orderNo} · {x.item}</span>
                    <span className="line-clamp-2">{x.lastText ? `“${x.lastText}”` : "Sent a photo or file"}</span>
                  </p>
                  <LinkButton href={`/o/${x.orderId}?as=staff`} size="sm" variant="ghost" className="shrink-0"
                    aria-label={`Open order #${x.orderNo} from ${x.buyer}`}>Open</LinkButton>
                </li>
              ))}
            </ul>
            {inbox.length > 3 && <Link href="/seller/desk" className="inline-flex min-h-10 items-center font-semibold underline sm:ml-7">+{inbox.length - 3} more</Link>}
          </Card>
        )}
      </div>
      {me.shop.isSandbox && <Banner />}
      {me.proofNotice && !noticeRead && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4">
          <Card flat tint="yellow" role="status" data-testid="proof-notice" className="flex flex-wrap items-center gap-3 p-3">
            <p className="min-w-0 flex-1 basis-64">
              A password was set on this account before your email was confirmed. That password no longer works. Check that the
              UPI ID and payee name in <Link href="/seller/shop" className="font-semibold underline">your shop settings</Link> are yours.
            </p>
            <Button size="sm" variant="ghost" onClick={readNotice}>Got it</Button>
          </Card>
        </div>
      )}
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-5">{children}</main>
    </MeProvider>
  );
}
