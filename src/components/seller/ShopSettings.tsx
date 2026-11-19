"use client";
// /seller/shop: settings (owner edits, team reads) and the team list with invites.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Avatar, Badge, Button, Card, EmptyState, Field, Icon, Input, Sheet, Skeleton, useToast } from "@/components/ui";
import { SetPassword } from "./SetPassword";
import { api } from "@/lib/client/api";
import type { ShopSettings as Settings, StaffInviteRes } from "@/lib/types";
import { errMsg, useMe } from "./kit";
import { ShopForm } from "./ShopForm";

export const DEMO_NOTE = "The demo shop can't be edited. Create your own shop to try this.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ShopSettings() {
  const me = useMe();
  const toast = useToast();
  const demo = me.shop.isSandbox; // the shared demo shop is read-only (the API refuses writes: demo_read_only)
  const owner = me.role === "owner" && !demo;
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inv, setInv] = useState({ email: "", name: "" });
  const [invErr, setInvErr] = useState<{ email?: string; name?: string; top?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);

  const load = useCallback(() => api("GET /api/shops/:id", undefined, { id: me.shop.id }).then(setS, (e) => setErr(errMsg(e))), [me.shop.id]);
  useEffect(() => { void load(); }, [load]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const x: typeof invErr = {};
    if (!EMAIL.test(inv.email.trim())) x.email = "Enter their email address.";
    if (!inv.name.trim() || inv.name.trim().length > 40) x.name = "Their name, up to 40 characters.";
    setInvErr(x);
    if (x.email || x.name) return;
    setBusy("invite");
    try {
      const r = await api("POST /api/shops/:id/staff", { email: inv.email.trim(), name: inv.name.trim() }, { id: me.shop.id }) as StaffInviteRes;
      setLink({ name: inv.name.trim(), url: r.inviteUrl });
      setInv({ email: "", name: "" });
      await load();
    } catch (x2) { setInvErr({ top: errMsg(x2) }); } finally { setBusy(null); }
  };

  const relink = async (staffId: string, name: string) => {
    setBusy(`link:${staffId}`);
    try { const r = await api("POST /api/shops/:id/staff/:staffId/link", undefined, { id: me.shop.id, staffId }); setLink({ name, url: r.inviteUrl }); }
    catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setBusy(null); }
  };
  const copyLink = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); toast("Invite link copied", { tone: "good" }); }
    catch { toast("Couldn't copy. Press and hold the link to copy it.", { tone: "warn" }); }
  };

  const remove = async (staffId: string, name: string) => {
    if (!confirm(`Remove ${name} from your team? Their open orders keep their name.`)) return;
    setBusy(staffId);
    try {
      await api("DELETE /api/shops/:id/staff/:staffId", undefined, { id: me.shop.id, staffId });
      toast(`${name} removed. Their invite link no longer works.`, { tone: "good" });
      if (link?.name === name) setLink(null);
      await load();
    }
    catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setBusy(null); }
  };

  if (err) return <EmptyState icon="warning" title="Couldn't load your shop." body={err} action={<Button onClick={() => { setErr(null); void load(); }}>Try again</Button>} />;
  if (!s) return <div className="flex flex-col gap-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl">Shop settings</h1>
        {!owner && <p className="rounded-wobble border-2 border-ink bg-sky px-3 py-2 font-semibold">{demo ? DEMO_NOTE : "Only the shop owner can change these. You can see them here."}</p>}
        <Sheet><ShopForm initial={s} readOnly={!owner} onSaved={setS} /></Sheet>
      </section>
      <section className="flex flex-col gap-4" aria-labelledby="team-h">
        <h2 id="team-h" className="text-2xl">Your team</h2>
        <ul className="flex flex-col gap-2" data-testid="team">
          {s.staff.map((m) => (
            <li key={m.staffId}>
              <Card flat className="flex flex-wrap items-center gap-3 p-3">
                <Avatar name={m.displayName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{m.displayName}{m.staffId === me.staffId && <span className="text-muted"> (you)</span>}</p>
                  {m.email && <p className="truncate text-sm text-muted">{m.email}</p>}
                </div>
                <Badge size="sm" tint={m.role === "owner" ? "lime" : m.status === "pending" ? "yellow" : "mint"} icon={m.role === "owner" ? "sparkle" : m.status === "pending" ? "clock" : "check"}>
                  {m.role === "owner" ? "Owner" : m.status === "pending" ? "Invited" : "Team"}
                </Badge>
                {owner && m.status === "pending" && (
                  <Button size="sm" variant="ghost" icon="copy" busy={busy === `link:${m.staffId}`} busyLabel="Getting link…" onClick={() => relink(m.staffId, m.displayName)}>Invite link</Button>
                )}
                {owner && m.role !== "owner" && (
                  <Button size="sm" variant="ghost" icon="trash" busy={busy === m.staffId} busyLabel="Removing…" onClick={() => remove(m.staffId, m.displayName)}>Remove</Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
        {link && (
          <Card tint="lime" className="flex flex-col gap-2" data-testid="invite-link">
            <p className="font-extrabold">Send this link to {link.name}</p>
            <p className="text-[0.95rem]">Send it on WhatsApp or anywhere you chat. Whoever opens it can join your team with that email, so send it only to {link.name}. It works for 7 days, once. Removing them cancels it.</p>
            <p className="break-all rounded-wobble border-2 border-ink/30 bg-card p-2 font-mono text-sm">{link.url}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon="copy" onClick={copyLink}>Copy invite link</Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`Join ${me.shop.name} on Dibs: ${link.url}`)}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center gap-2 rounded-wobble-2 border-[2.5px] border-ink bg-mint px-3.5 font-extrabold shadow-ink-sm"><Icon name="share" size={20} />WhatsApp</a>
            </div>
          </Card>
        )}
        {owner ? (
          <Sheet title="Invite someone">
            <form onSubmit={invite} noValidate className="flex flex-col gap-4">
              <Field label="Their name" error={invErr.name}><Input name="inviteName" value={inv.name} maxLength={40} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
              <Field label="Their email" hint="You get a link to send them. No email needed." error={invErr.email}>
                <Input name="inviteEmail" type="email" inputMode="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
              </Field>
              {invErr.top && <p role="alert" className="font-semibold text-pink-ink">{invErr.top}</p>}
              <Button type="submit" icon="plus" busy={busy === "invite"} busyLabel="Inviting…" className="self-start">Invite</Button>
            </form>
          </Sheet>
        ) : <p className="text-muted">{demo ? DEMO_NOTE : "Only the owner can invite or remove team members."}</p>}
        {!demo && <SetPassword />}
      </section>
    </div>
  );
}
