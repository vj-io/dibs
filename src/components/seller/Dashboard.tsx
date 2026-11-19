"use client";
// /seller/dashboard: per-drop results, straight from GET /api/drops/:id/dashboard. Nothing estimated: null = not measured.
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonClasses, Card, cx, EmptyState, Field, Icon, LinkButton, Select, Skeleton, StatePill } from "@/components/ui";
import { api } from "@/lib/client/api";
import { rupees, tapTime } from "@/lib/codec";
import type { DropDashboard, DropSummary } from "@/lib/types";
import { DROP_PILL } from "./DropsPage";
import { errMsg, when } from "./kit";

export function Dashboard() {
  const router = useRouter();
  const q = useSearchParams().get("drop");
  const [drops, setDrops] = useState<DropSummary[] | null>(null);
  const [d, setD] = useState<DropDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api("GET /api/drops").then((r) => setDrops(r.drops), (e) => setErr(errMsg(e))); }, []);
  const dropId = q && drops?.some((x) => x.dropId === q) ? q : drops?.[0]?.dropId ?? null;
  const drop = drops?.find((x) => x.dropId === dropId);

  useEffect(() => {
    if (!dropId) return;
    let gone = false;
    api("GET /api/drops/:id/dashboard", undefined, { id: dropId }).then((r) => { if (!gone) { setD(r); setErr(null); } }, (e) => !gone && setErr(errMsg(e)));
    return () => { gone = true; };
  }, [dropId]);

  if (err && !drops) return <EmptyState icon="warning" title="Couldn't load your results." body={err} action={<Button onClick={() => location.reload()}>Try again</Button>} />;
  if (!drops) return <div className="flex flex-col gap-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-48" /></div>;
  if (!drops.length) return <EmptyState icon="sparkle" title="No drops yet, so no results." body="Results appear here after your first drop: taps, holds, paid orders and how fast buyers got an answer." action={<LinkButton href="/seller/drops" icon="plus">Make a drop</LinkButton>} />;

  const cur = d && d.dropId === dropId ? d : null;
  const max = cur ? Math.max(1, cur.taps) : 1;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl">Results</h1>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Drop" className="min-w-0 max-w-md flex-1 basis-56">
          <Select name="drop" value={dropId ?? ""} onChange={(e) => router.replace(`/seller/dashboard?drop=${e.target.value}`)}>
            {drops.map((x) => <option key={x.dropId} value={x.dropId}>{x.title} · {when(x.startsAt)}</option>)}
          </Select>
        </Field>
        {dropId && <a href={`/api/exports/orders.csv?dropId=${dropId}`} download className={buttonClasses("ghost")} data-testid="csv-download">
          <Icon name="arrowRight" size={20} className="rotate-90" />Download orders (CSV)</a>}
      </div>
      {drop && (
        <p className="flex flex-wrap items-center gap-2">
          <StatePill size="sm" state={DROP_PILL[drop.status].state} label={DROP_PILL[drop.status].label} />
          {drop.isSandbox && <><StatePill size="sm" state="demo" /><span className="text-muted">Demo drop: these numbers never count in Impact totals.</span></>}
        </p>
      )}
      {!cur ? (err ? <p role="alert" className="font-semibold text-pink-ink">{err}</p> : <Skeleton className="h-48" />) : !cur.taps ? (
        <EmptyState icon="tap" title="No taps in this drop yet." body="Numbers show up once buyers tap Dibs." />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="dash">
            <Tile label="Taps" value={String(cur.taps)} testid="dash-taps" />
            <Tile label="Holds" value={String(cur.holds)} testid="dash-holds" />
            <Tile label="Paid orders" value={String(cur.paidOrders)} testid="dash-paid" />
            <Tile label="Paid value" value={rupees(cur.paidValuePaise)} testid="dash-value" />
            <Tile label="Waitlist saves" value={String(cur.waitlistSaves)} hint="Sold to a promoted buyer" testid="dash-saves" />
            <Tile label="Median winning tap" value={cur.medianWinMs == null ? "not measured yet" : tapTime(cur.medianWinMs)} hint="From the piece going live to the tap that won it" testid="dash-median" />
            {cur.viewers != null && <Tile label="Viewers" value={String(cur.viewers)} testid="dash-viewers" />}
          </dl>
          <Card flat className="flex flex-col gap-3">
            <h2 className="text-xl">From tap to paid</h2>
            {[["Taps", cur.taps], ["Holds", cur.holds], ["Paid", cur.paidOrders]].map(([label, n]) => (
              <div key={label} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2">
                <span className="font-semibold">{label}</span>
                <span className={cx("h-6 rounded-wobble", Number(n) ? "border-2 border-ink bg-lime" : "border-l-2 border-ink")} style={{ width: Number(n) ? `${Math.max(2, (Number(n) / max) * 100)}%` : 0 }} aria-hidden="true" />
                <span className="text-right font-mono">{n}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint, testid }: { label: string; value: string; hint?: string; testid: string }) {
  return (
    <Card flat className="flex flex-col gap-1 p-3">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="font-mono text-2xl font-bold tabular-nums" data-testid={testid}>{value}</dd>
      {hint && <dd className="text-sm text-muted">{hint}</dd>}
    </Card>
  );
}
