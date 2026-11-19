"use client";
// Seller club page: post to #drops, member count and list (remove), recent #chat, reviews (hide with a reason).
// Polls every 10 s: staff are not community members, the club record is read from our server.
import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/chat/Chat";
import { Stars } from "@/components/club/ClubPage";
import { Badge, Button, Card, EmptyState, Field, Icon, Input, LinkButton, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { ClubManage as Data, DropSummary } from "@/lib/types";
import { errMsg, when } from "@/components/seller/kit";

export function ClubManage() {
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drops, setDrops] = useState<DropSummary[]>([]);
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [posting, setPosting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [hiding, setHiding] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(() => api("GET /api/club/manage").then((x) => { setD(x); setErr(null); }, (e) => setErr(errMsg(e))), []);
  useEffect(() => {
    void load();
    api("GET /api/drops").then((r) => setDrops(r.drops.filter((x) => x.status !== "ended")), () => {});
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function post() {
    setPosting(true);
    try { await api("POST /api/club/announce", { text, dropCode: code || null }); setText(""); setCode(""); toast("Posted to #drops", { tone: "good" }); await load(); }
    catch (e) { toast(errMsg(e), { tone: "warn" }); }
    finally { setPosting(false); }
  }
  async function remove(buyerId: string) {
    try { await api("POST /api/club/remove", { buyerId }); setRemoving(null); toast("Removed from the club", { tone: "good" }); await load(); }
    catch (e) { toast(errMsg(e), { tone: "warn" }); }
  }
  async function hide() {
    if (!hiding) return;
    try { await api("POST /api/club/hide", { reviewId: hiding.id, reason: hiding.reason }); setHiding(null); toast("Review hidden", { tone: "good" }); await load(); }
    catch (e) { toast(errMsg(e), { tone: "warn" }); }
  }

  if (!d) return err ? <EmptyState title="Couldn't load the club" body={err} icon="warning" action={<Button onClick={() => void load()}>Try again</Button>} /> : <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Shop club</h1>
          <p className="flex items-center gap-1 text-muted" data-testid="club-members"><Icon name="users" size={18} />{d.memberCount} {d.memberCount === 1 ? "member" : "members"}</p>
        </div>
        <LinkButton variant="ghost" href={`/s/${d.shopSlug}/club`} icon="eye">Open the buyer page</LinkButton>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="flex items-center gap-2 text-xl"><Icon name="bell" />Post to #drops</h2>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void post(); }}>
            <Field label="Announcement" hint={`${text.length}/280 · members see it at once; drops are also posted for you when you schedule them or go live`}>
              <Textarea value={text} maxLength={280} onChange={(e) => setText(e.target.value)} placeholder="New jhumkas this Saturday, 7 pm!" />
            </Field>
            {drops.length > 0 && (
              <Field label="Link a drop (optional)">
                <Select value={code} onChange={(e) => setCode(e.target.value)}>
                  <option value="">No link</option>
                  {drops.map((x) => <option key={x.dropId} value={x.code}>{x.title} · {when(x.startsAt)}</option>)}
                </Select>
              </Field>
            )}
            <Button type="submit" icon="arrowRight" busy={posting} busyLabel="Posting…" disabled={!text.trim()}>Post</Button>
          </form>
          {d.announcements.length > 0 && (
            <ol className="flex flex-col gap-2 border-t-2 border-ink/15 pt-3" aria-label="Recent announcements">
              {[...d.announcements].reverse().slice(0, 5).map((a) => (
                <li key={a.id} className="leading-snug"><span className="font-mono text-sm text-muted">{when(a.at)}</span> {a.text}</li>
              ))}
            </ol>
          )}
        </Card>

        <Chat title="Recent club chat" lines={d.chat.map((c) => ({ id: c.msgId ?? `p${c.id}`, from: c.from ?? "", fromName: c.name ?? undefined, at: Date.parse(c.at), text: c.text }))}
          meId={null} readOnly empty="No chat yet." />

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="flex items-center gap-2 text-xl"><Icon name="users" />Members</h2>
          {d.members.length === 0 ? <p className="text-muted">Nobody has joined yet. Buyers join from the sale room.</p> : (
            <ul className="flex flex-col divide-y-2 divide-ink/10" aria-label="Members">
              {d.members.map((m) => (
                <li key={m.buyerId} className="flex min-h-12 flex-wrap items-center gap-2 py-1">
                  <span className="flex-1 font-semibold">{m.name}</span>
                  <span className="text-sm text-muted">joined {when(m.joinedAt)}</span>
                  {removing === m.buyerId ? (
                    <>
                      <Button size="sm" variant="danger" onClick={() => void remove(m.buyerId)}>Confirm remove</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                    </>
                  ) : <Button size="sm" variant="ghost" icon="cross" onClick={() => setRemoving(m.buyerId)} aria-label={`Remove ${m.name}`}>Remove</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="flex items-center gap-2 text-xl"><Icon name="sparkle" />Reviews</h2>
          {d.reviews.length === 0 ? <p className="text-muted">No reviews yet. Buyers with a paid order can review it.</p> : (
            <ul className="flex flex-col gap-2" aria-label="Reviews">
              {[...d.reviews].reverse().map((r) => (
                <li key={r.id} className="flex flex-col gap-1 rounded-wobble border-2 border-ink/20 p-2">
                  <p className="flex flex-wrap items-center gap-2"><Stars n={r.stars ?? 0} /><span className="font-semibold">{r.name ?? "Buyer"}</span>
                    {r.hiddenAt && <Badge tint="grey" icon="eye" size="sm">Hidden: {r.hiddenReason}</Badge>}</p>
                  {r.text && <p className="[overflow-wrap:anywhere]">{r.text}</p>}
                  {!r.hiddenAt && (hiding?.id === r.id ? (
                    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void hide(); }}>
                      <Field label="Why hide it?" className="min-w-0 flex-1">
                        <Input value={hiding.reason} maxLength={200} onChange={(e) => setHiding({ id: r.id, reason: e.target.value })} placeholder="Not about this order" autoFocus />
                      </Field>
                      <Button size="sm" type="submit" variant="danger" disabled={hiding.reason.trim().length < 3}>Hide</Button>
                      <Button size="sm" variant="ghost" onClick={() => setHiding(null)}>Cancel</Button>
                    </form>
                  ) : <Button size="sm" variant="ghost" icon="eye" className="self-start" onClick={() => setHiding({ id: r.id, reason: "" })}>Hide review</Button>)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
