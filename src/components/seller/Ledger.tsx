"use client";
// Claims ledger: one row per claim, grouped holds -> waitlist -> paid -> ended, so a promotion visibly moves up.
// Stacked rows at every width (never a squeezed table). Tap a name to see the phone number.
import { useRef, useState } from "react";
import { Avatar, Badge, Button, Countdown, cx, Icon, StatePill, type PillState } from "@/components/ui";
import { tapTime } from "@/lib/codec";
import type { ClaimState, ConsoleLedgerEntry } from "@/lib/types";
import { holdOrder } from "./consoleLogic";
import { useMe, waBuyer } from "./kit";

const PILL: Record<ClaimState, { state: PillState; label?: string }> = {
  held: { state: "held", label: "Held" },
  payment_claimed: { state: "payment_claimed", label: "Says paid" },
  paid: { state: "paid" },
  shipped: { state: "shipped" },
  waitlisted: { state: "waitlisted" },
  expired: { state: "expired" },
  released: { state: "released" },
  cancelled: { state: "cancelled" },
  left: { state: "released", label: "Left waitlist" },
  missed: { state: "closed", label: "Missed" },
};
const RANK: Record<ClaimState, number> = { held: 0, payment_claimed: 0, waitlisted: 1, paid: 2, shipped: 2, expired: 3, released: 3, cancelled: 3, left: 3, missed: 3 };
export const ACTIVE = new Set<ClaimState>(["held", "payment_claimed", "paid", "shipped"]);

export function sortLedger(rows: ConsoleLedgerEntry[]) {
  return [...rows].sort((a, b) => RANK[a.state] - RANK[b.state]
    || (a.state === "waitlisted" && b.state === "waitlisted" ? (a.waitPosition ?? 99) - (b.waitPosition ?? 99) : 0)
    || Date.parse(b.committedAt) - Date.parse(a.committedAt));
}

export function Ledger({ rows, showPiece, onOpen, onCancel }: {
  rows: ConsoleLedgerEntry[]; showPiece: boolean;
  onOpen: (r: ConsoleLedgerEntry) => void; onCancel: (r: ConsoleLedgerEntry) => void;
}) {
  const [phoneFor, setPhoneFor] = useState<string | null>(null);
  const me = useMe();
  // While the pointer is over the list or a row has focus, rows keep their places (a row never slides away from
  // the button about to be pressed); the fresh order applies on leave.
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const hover = useRef(false), list = useRef<HTMLOListElement>(null);
  const sorted = sortLedger(rows);
  const freeze = () => setFrozen((f) => f ?? sorted.map((r) => r.claimId));
  const thaw = () => { if (!hover.current && !list.current?.contains(document.activeElement)) setFrozen(null); };
  return (
    <ol ref={list} className="flex flex-col gap-2" aria-label="Claims" data-testid="ledger" data-frozen={frozen ? "" : undefined}
      onPointerEnter={() => { hover.current = true; freeze(); }} onPointerLeave={() => { hover.current = false; thaw(); }}
      onFocus={freeze} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTimeout(thaw, 0); }}>
      {holdOrder(sorted, frozen).map((r) => {
        const p = PILL[r.state];
        const promotedHold = r.promoted && (r.state === "held" || r.state === "payment_claimed");
        return (
          // key = claim: a row keeps its DOM node (and focus) when its state changes
          <li key={r.claimId} data-testid="ledger-row" data-state={r.state} data-buyer={r.buyer}
            className={cx("pop-in flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-wobble border-2 border-ink px-3 py-2",
              promotedHold ? "bg-lime/50" : r.state === "waitlisted" ? "bg-yellow/60" : RANK[r.state] === 3 ? "bg-grey/60" : "bg-card")}>
            <Avatar name={r.buyer} bot={r.isBot} size={36} />
            <div className="min-w-0 flex-1 basis-40">
              <button type="button" title={r.phone ?? undefined} onClick={() => setPhoneFor(phoneFor === r.claimId ? null : r.claimId)}
                aria-expanded={phoneFor === r.claimId} className="max-w-full truncate text-left font-semibold underline decoration-ink/30 decoration-dotted underline-offset-4">
                {r.buyer}
              </button>
              {r.isBot && <span className="ml-1.5 rounded-pill border-2 border-violet-ink bg-violet px-1.5 text-sm font-semibold text-violet-ink">🤖 Demo buyer</span>}
              {phoneFor === r.claimId && <span className="block font-mono text-sm">{r.phone ?? (r.isBot ? "Demo buyer, no phone" : "No phone")}</span>}
              <span className="block text-[0.95rem] text-muted">
                {showPiece && <>#{r.position} {r.title} · </>}{r.variantLabel}
                {r.ms != null && <> · tapped in <span className="font-mono text-ink">{tapTime(r.ms)}</span></>}
                {r.orderNo != null && <> · order #{r.orderNo}</>}
                {r.assignedTo && <> · {r.assignedTo}</>}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {promotedHold && <Badge size="sm" tint="yellow" icon="arrowRight" className="pop-in">from waitlist</Badge>}
              <StatePill size="sm" state={p.state} label={r.state === "waitlisted" && r.waitPosition ? `#${r.waitPosition} waitlist` : p.label} />
              {r.state === "held" && r.expiresAt && <Countdown size="sm" expiresAt={r.expiresAt} />}
            </div>
            {r.orderId && (ACTIVE.has(r.state)) && (
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" icon="chat" onClick={() => onOpen(r)}>Order</Button>
                <WaButton href={me.shop.isSandbox || r.isBot ? null : waBuyer(r.phone, { shop: me.shop.name, buyer: r.buyer, orderNo: r.orderNo, item: r.title, variant: r.variantLabel, orderId: r.orderId })} who={r.buyer} />
                {(r.state === "held" || r.state === "payment_claimed") && (
                  <Button size="sm" variant="ghost" icon="cross" onClick={() => onCancel(r)} aria-label={`Cancel hold for ${r.buyer}`}>Cancel</Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** "WhatsApp buyer" link (opens WhatsApp with the order summary); nothing when there is no phone to message. */
export function WaButton({ href, who }: { href: string | null; who: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${who}`} data-testid="wa-buyer"
      className="inline-flex min-h-12 items-center gap-1.5 rounded-wobble-2 border-[2.5px] border-ink bg-mint px-3 font-extrabold shadow-ink-sm">
      <Icon name="share" size={18} />WhatsApp buyer
    </a>
  );
}
