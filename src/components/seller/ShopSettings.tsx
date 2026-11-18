"use client";
// /seller/shop: settings (owner edits, team reads) and the team list with invites.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Sheet, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { ShopSettings as Settings } from "@/lib/types";
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
      await api("POST /api/shops/:id/staff", { email: inv.email.trim(), name: inv.name.trim() }, { id: me.shop.id });
      toast(`Invited ${inv.name.trim()}. They sign in at /seller with that email.`, { tone: "good", ms: 6000 });
      setInv({ email: "", name: "" });
      await load();
    } catch (x2) { setInvErr({ top: errMsg(x2) }); } finally { setBusy(null); }
  };

  const remove = async (staffId: string, name: string) => {
    if (!confirm(`Remove ${name} from your team? Their open orders keep their name.`)) return;
    setBusy(staffId);
    try { await api("DELETE /api/shops/:id/staff/:staffId", undefined, { id: me.shop.id, staffId }); toast(`${name} removed`, { tone: "good" }); await load(); }
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
                {owner && m.role !== "owner" && (
                  <Button size="sm" variant="ghost" icon="trash" busy={busy === m.staffId} busyLabel="Removing…" onClick={() => remove(m.staffId, m.displayName)}>Remove</Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
        {owner ? (
          <Sheet title="Invite someone">
            <form onSubmit={invite} noValidate className="flex flex-col gap-4">
              <Field label="Their name" error={invErr.name}><Input name="inviteName" value={inv.name} maxLength={40} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
              <Field label="Their email" hint="They sign in at /seller with a one-time code." error={invErr.email}>
                <Input name="inviteEmail" type="email" inputMode="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
              </Field>
              {invErr.top && <p role="alert" className="font-semibold text-pink-ink">{invErr.top}</p>}
              <Button type="submit" icon="plus" busy={busy === "invite"} busyLabel="Inviting…" className="self-start">Invite</Button>
            </form>
          </Sheet>
        ) : <p className="text-muted">{demo ? DEMO_NOTE : "Only the owner can invite or remove team members."}</p>}
      </section>
    </div>
  );
}
