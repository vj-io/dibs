"use client";
// Staff-only health page: polls GET /api/health every 5 s. Status is always icon + word, never colour alone.
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import { getLive, type LiveStatus } from "@/lib/client/live";
import type { HealthReport } from "@/lib/types";
import { AppHeader, Badge, Card, EmptyState, Footer, Icon, LinkButton, Skeleton, type IconName, type Tint } from "@/components/ui";

type Level = "OK" | "Degraded" | "Down";
const LEVEL: Record<Level, { tint: Tint; icon: IconName }> = {
  OK: { tint: "mint", icon: "check" },
  Degraded: { tint: "peach", icon: "warning" },
  Down: { tint: "pink", icon: "cross" },
};

function Pill({ level, children }: { level: Level; children?: React.ReactNode }) {
  return <Badge tint={LEVEL[level].tint} icon={LEVEL[level].icon}>{children ?? level}</Badge>;
}

const SENDS = /^(?:room_send|group_send|user_)/;

/**
 * The headline is about the sale only. Down: the health API (and so the database) does not answer, or every one of
 * at least 3 recent Nexconn sends failed. Degraded: outbox messages failed (24 h) or stuck, or a sweep failed.
 * AI helpers, single Nexconn errors and this browser's connection are reported as notes and never change it.
 */
function judge(h: HealthReport | null, failed: boolean, browser: LiveStatus | "unavailable" | "checking"): { level: Level; reasons: string[]; notes: string[] } {
  if (failed) return { level: "Down", reasons: ["The health API (and with it the database) did not answer."], notes: [] };
  if (!h) return { level: "OK", reasons: [], notes: [] };
  const down: string[] = [], deg: string[] = [], notes: string[] = [];
  const sends = h.nexconn.recent.filter((c) => SENDS.test(c.kind));
  if (sends.length >= 3 && sends.every((c) => !c.ok)) down.push("Every recent Nexconn send failed.");
  if (h.outbox.failed > 0) deg.push(`${h.outbox.failed} outbox message(s) failed for good in the last 24 h.`);
  if (h.outbox.stuck > 0) deg.push(`${h.outbox.stuck} outbox message(s) waiting for over 2 minutes.`);
  if (h.sweeps.some((s) => !s.ok)) deg.push("A recent sweep did not finish cleanly.");
  const bad = h.nexconn.recent.filter((c) => !c.ok);
  if (bad.length && !down.length) notes.push(`Nexconn: ${bad.length} of the last ${h.nexconn.recent.length} calls failed (retried by the outbox).`);
  const ai = h.ai.reduce((t, a) => ({ calls: t.calls + a.calls, ok: t.ok + a.ok }), { calls: 0, ok: 0 });
  if (ai.calls > ai.ok) notes.push(`AI helpers: ${ai.calls - ai.ok} of ${ai.calls} model calls failed in 24 h; those messages fell back to rules.`);
  if (browser === "offline" || browser === "unavailable") notes.push("This browser has no live connection.");
  return { level: down.length ? "Down" : deg.length ? "Degraded" : "OK", reasons: [...down, ...deg], notes };
}

const clock = (t: number | string) => new Date(t).toLocaleTimeString("en-IN", { hour12: false });
const age = (iso: string | null) => (iso ? `${Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))} s ago` : "none");

export function HealthClient() {
  const [auth, setAuth] = useState<"checking" | "in" | "out">("checking");
  const [h, setH] = useState<HealthReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [browser, setBrowser] = useState<LiveStatus | "unavailable" | "checking">("checking");
  const [kind, setKind] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    api("GET /api/seller/me").then((r) => { if (!dead) setAuth(r.me ? "in" : "out"); }).catch(() => { if (!dead) setAuth("out"); });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    if (auth !== "in") return;
    let dead = false;
    const tick = async () => {
      try {
        const r = await api("GET /api/health");
        if (dead) return;
        setH(r); setFailed(false); setAt(Date.now());
      } catch (e) {
        if (dead) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { setAuth("out"); return; }
        setFailed(true); setAt(Date.now());
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => { dead = true; clearInterval(id); };
  }, [auth]);

  useEffect(() => {
    if (auth !== "in") return;
    let off: (() => void) | undefined;
    let dead = false;
    getLive("staff").then((l) => { if (dead) return; setKind(l.kind); off = l.onStatus((s) => setBrowser(s)); }).catch(() => { if (!dead) setBrowser("unavailable"); });
    return () => { dead = true; off?.(); };
  }, [auth]);

  const { level, reasons, notes } = judge(h, failed, browser);

  return (
    <>
      <AppHeader title="Health" right={<LinkButton href="/seller" variant="ghost" size="sm">Seller</LinkButton>} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {auth === "checking" && <Skeleton className="h-40" />}
        {auth === "out" && (
          <EmptyState icon="lock" title="Staff only" body="Sign in as a seller or staff member to see how Dibs is running."
            action={<LinkButton href="/seller" variant="primary" size="md">Sign in at /seller</LinkButton>} />
        )}
        {auth === "in" && (
          <div className="flex flex-col gap-6">
            <Card tint={LEVEL[level].tint} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl" role="status" aria-live="polite">Status: {level}</h1>
                <Pill level={level} />
              </div>
              {reasons.length > 0 ? <ul className="list-disc pl-6">{reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p>{h ? "No failure signals right now." : "Waiting for the first reading…"}</p>}
              <p className="text-[0.95rem]">
                {at ? `Updated ${clock(at)}, refreshes every 5 s.` : "Loading…"} Rules: Down when the database or Nexconn sends fail; Degraded when outbox messages fail or get stuck, or a sweep fails. AI helpers and single call errors are notes below and never change the status.
              </p>
              {notes.length > 0 && (
                <>
                  <h2 className="text-lg">Notes (do not change the status)</h2>
                  <ul className="list-disc pl-6">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </>
              )}
            </Card>

            {h && (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card flat as="section" aria-labelledby="h-rt">
                  <h2 id="h-rt" className="text-xl">Realtime</h2>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="font-semibold">Server transport</dt><dd className="font-mono">{h.mode}</dd>
                    <dt className="font-semibold">Card format</dt><dd>{h.textEnvelope ? "text envelope" : "custom types"}</dd>
                    <dt className="font-semibold">This browser</dt>
                    <dd className="flex items-center gap-2">
                      <Pill level={browser === "connected" ? "OK" : browser === "connecting" || browser === "checking" ? "Degraded" : "Down"}>
                        {browser === "checking" ? "checking" : browser === "unavailable" ? "no connection" : browser}
                      </Pill>
                      {kind && <span className="font-mono text-sm text-muted">{kind}</span>}
                    </dd>
                  </dl>
                  <h3 className="mt-4 font-extrabold">Feature flags</h3>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {Object.entries(h.features).map(([k, v]) => (
                      <li key={k}><Badge tint={v ? "mint" : "grey"} icon={v ? "check" : "pause"} size="sm">{k}: {v ? "on" : "off"}</Badge></li>
                    ))}
                  </ul>
                </Card>

                <Card flat alt as="section" aria-labelledby="h-ob">
                  <h2 id="h-ob" className="text-xl">Outbox</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tint={h.outbox.pending ? "yellow" : "mint"} icon={h.outbox.pending ? "clock" : "check"}>{h.outbox.pending} pending</Badge>
                    <Badge tint={h.outbox.failed ? "pink" : "mint"} icon={h.outbox.failed ? "cross" : "check"}>{h.outbox.failed} failed (24 h)</Badge>
                    <Badge tint={h.outbox.stuck ? "pink" : "mint"} icon={h.outbox.stuck ? "clock" : "check"}>{h.outbox.stuck} stuck</Badge>
                    <span className="text-muted">Oldest pending: {age(h.outbox.oldestPendingAt)}</span>
                  </div>
                  {h.outbox.recentFailures.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1 text-[0.95rem]">
                      {h.outbox.recentFailures.map((f) => (
                        <li key={f.id} className="break-words"><span className="font-mono font-bold">{f.msgType}</span> {clock(f.at)}: {f.error ?? "no error text"}</li>
                      ))}
                    </ul>
                  )}
                  <h3 className="mt-4 font-extrabold">Cron sweeps (latest 5)</h3>
                  {h.sweeps.length === 0 ? <p className="text-muted">No sweep recorded yet.</p> : (
                    <ul className="mt-1 flex flex-col gap-1">
                      {h.sweeps.map((s) => (
                        <li key={s.at} className="flex flex-wrap items-center gap-2 text-[0.95rem]">
                          <Badge tint={s.ok ? "mint" : "pink"} icon={s.ok ? "check" : "cross"} size="sm">{s.ok ? "ok" : "failed"}</Badge>
                          <span className="font-mono">{clock(s.at)}</span><span>{s.ms} ms, {s.drops} drop(s)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card flat as="section" aria-labelledby="h-nx" className="lg:col-span-2">
                  <h2 id="h-nx" className="text-xl">Nexconn calls</h2>
                  <p className="text-muted">Recent calls are kept in server memory, so they reset when the server restarts.</p>
                  {h.nexconn.recent.length === 0 ? <p className="mt-2">No Nexconn call since this server started{h.mode === "mock" ? " (mock mode makes none)" : ""}.</p> : (
                    <ul className="mt-2 flex flex-col gap-1">
                      {[...h.nexconn.recent].reverse().map((c, i) => (
                        <li key={`${c.at}-${i}`} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 ${c.ok ? "" : "border-2 border-ink bg-pink-soft"}`}>
                          <Badge tint={c.ok ? "mint" : "pink"} icon={c.ok ? "check" : "cross"} size="sm">{c.ok ? "ok" : "failed"}</Badge>
                          <span className="font-mono">{c.kind}</span>
                          <span className={c.ok ? "font-mono text-muted" : "font-mono font-extrabold"}>code {c.code}</span>
                          <span className="font-mono">{c.ms} ms</span>
                          <span className="font-mono text-sm text-muted">{clock(c.at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {h.nexconn.lastHour.length > 0 && (
                    <>
                      <h3 className="mt-4 font-extrabold">Last hour, by call kind</h3>
                      <ul className="mt-1 flex flex-col gap-1 text-[0.95rem]">
                        {h.nexconn.lastHour.map((k) => (
                          <li key={k.kind} className="flex flex-wrap gap-x-3">
                            <span className="font-mono font-bold">{k.kind}</span>
                            <span>{k.calls} calls</span>
                            <span>{k.failures} failed{k.lastErrorCode ? ` (last code ${k.lastErrorCode})` : ""}</span>
                            <span>median {k.p50Ms ?? "n/a"} ms</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Card>

                <Card flat alt as="section" aria-labelledby="h-ai" className="lg:col-span-2">
                  <h2 id="h-ai" className="text-xl">AI helpers (last 24 hours)</h2>
                  {h.ai.length === 0 ? <p className="mt-2">No AI call in the last 24 hours.</p> : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {h.ai.map((a) => {
                        const rate = a.calls ? Math.round((a.ok / a.calls) * 100) : 0;
                        return (
                          <li key={`${a.job}-${a.model}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Badge tint={a.ok === a.calls ? "mint" : "peach"} icon={a.ok === a.calls ? "check" : "warning"} size="sm">{a.ok === a.calls ? "ok" : "some failed"}</Badge>
                            <span className="font-bold">{a.job}</span>
                            <span className="font-mono text-sm">{a.model ?? "rules only"}</span>
                            <span>{a.ok}/{a.calls} ok ({rate}%)</span>
                            <span>average {a.avgMs ?? "n/a"} ms</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>
            )}
            <p className="flex items-center gap-2 text-muted"><Icon name="lock" size={18} /> Staff only. No secrets are shown on this page.</p>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
