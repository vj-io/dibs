"use client";
// Seller shell: top bar (logo, shop, who is signed in, sign out) and the section nav. Sandbox shops get the demo banner.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Banner, Button, cx, Icon, Logo, type IconName } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { SellerMe } from "@/lib/types";
import { MeProvider } from "./kit";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/seller/drops", label: "Drops", icon: "live" },
  { href: "/seller/products", label: "Products", icon: "bag" },
  { href: "/seller/desk", label: "Desk", icon: "chat" },
  { href: "/seller/dashboard", label: "Dashboard", icon: "sparkle" },
  { href: "/seller/shop", label: "Shop", icon: "users" },
  { href: "/health", label: "Health", icon: "shield" },
];

export function SellerShell({ me, children }: { me: SellerMe; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try { await api("DELETE /api/seller/session"); } catch { /* the cookie may already be gone */ }
    router.replace("/seller");
    router.refresh();
  };
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
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      {me.shop.isSandbox && <Banner />}
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-5">{children}</main>
    </MeProvider>
  );
}
