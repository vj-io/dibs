"use client";
// Sale-room chat for staff: messages with sender labels, post as Seller/Team, per-message Mute 10 min / Ban / Unban.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, cx, Icon, Input, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { LiveMsg } from "@/lib/client/live";
import { ASSISTANT_ID } from "@/lib/codec";
import type { ConsoleState } from "@/lib/types";
import { clock, errMsg } from "./kit";

type Who = { label: string; tint: "lime" | "sky" | "violet" | "card"; buyerId: string | null };

export function RoomChat({ dropId, msgs, send, ownerIds, bans, names, onChanged, disabled }: {
  dropId: string; msgs: LiveMsg[]; send: (text: string) => Promise<void>;
  /** Nexconn ids of the shop owner(s): their lines say "Seller", other staff "Team". */
  ownerIds: Set<string>;
  bans: ConsoleState["bans"];
  /** Display name -> buyer id, for demo bots whose chat id isn't a buyer id. */
  names: Map<string, string>;
  onChanged: () => void; disabled?: string;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs.length]);

  const who = (m: LiveMsg): Who => {
    if (m.from.startsWith("s_")) return { label: ownerIds.has(m.from) ? "Seller" : "Team", tint: "lime", buyerId: null };
    if (m.from === ASSISTANT_ID) return { label: "🤖 Dibs assistant", tint: "violet", buyerId: null };
    if (m.from.startsWith("demo_bot_")) return { label: "🤖 Demo buyer", tint: "violet", buyerId: names.get(m.fromName ?? "") ?? null };
    if (m.from.startsWith("b_")) return { label: "Buyer", tint: "card", buyerId: m.from.slice(2) };
    return { label: "System", tint: "sky", buyerId: null };
  };

  const moderate = async (buyerId: string, action: "mute" | "ban" | "unban", name: string) => {
    setBusy(`${buyerId}:${action}`);
    try {
      await api("POST /api/drops/:id/moderate", { buyerId, action, ...(action === "mute" ? { minutes: 10 } : {}) }, { id: dropId });
      toast(action === "mute" ? `${name} muted for 10 minutes` : action === "ban" ? `${name} banned from this shop's drops` : `${name} can chat again`, { tone: "good" });
      setMenu(null);
      onChanged();
    } catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setBusy(null); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try { await send(t); setText(""); } catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setSending(false); }
  };

  return (
    <Card flat className="flex flex-col gap-3" data-testid="room-chat">
      <h2 className="flex items-center gap-2 text-xl"><Icon name="chat" />Room chat</h2>
      <ol ref={list} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
        className="flex max-h-96 min-h-32 flex-col gap-2 overflow-y-auto pr-1" aria-label="Room messages" aria-live="polite">
        {!msgs.length && <li className="m-auto text-muted">No messages yet.</li>}
        {msgs.map((m) => {
          const w = who(m);
          const name = m.fromName || w.label;
          const ban = w.buyerId ? bans.find((b) => b.buyerId === w.buyerId) : undefined;
          return (
            <li key={m.id} className="rounded-wobble border-2 border-ink/20 bg-paper px-2.5 py-1.5" data-testid="chat-line">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 truncate font-semibold">{name}</span>
                {w.label !== name && <Badge size="sm" tint={w.tint}>{w.label}</Badge>}
                {ban && <Badge size="sm" tint={ban.kind === "ban" ? "pink" : "peach"} icon="lock">{ban.kind === "ban" ? "Banned" : "Muted"}</Badge>}
                <span className="ml-auto font-mono text-sm text-muted">{clock(m.at)}</span>
                {w.buyerId !== null || m.from.startsWith("demo_bot_") ? (
                  <button type="button" aria-label={`Moderate ${name}`} aria-expanded={menu === m.id} onClick={() => setMenu(menu === m.id ? null : m.id)}
                    className="-my-2 grid size-12 place-items-center rounded-full font-extrabold">⋯</button>
                ) : null}
              </div>
              <p className="break-words">{m.text}</p>
              {menu === m.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {w.buyerId ? (
                    <>
                      <Button size="sm" variant="ghost" icon="pause" busy={busy === `${w.buyerId}:mute`} busyLabel="Muting…" onClick={() => moderate(w.buyerId!, "mute", name)}>Mute 10 min</Button>
                      <Button size="sm" variant="danger" icon="lock" busy={busy === `${w.buyerId}:ban`} busyLabel="Banning…" onClick={() => moderate(w.buyerId!, "ban", name)}>Ban</Button>
                      {ban && <Button size="sm" variant="ghost" icon="check" busy={busy === `${w.buyerId}:unban`} busyLabel="Lifting…" onClick={() => moderate(w.buyerId!, "unban", name)}>Unban</Button>}
                    </>
                  ) : <p className="text-[0.95rem] text-muted">This demo buyer hasn&apos;t claimed yet, so it can&apos;t be picked out. Use the moderation log below once the scam shield flags it.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="room-say" className="sr-only">Message the room</label>
        <Input id="room-say" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder={disabled ?? "Say something to the room"} disabled={!!disabled} className="flex-1" />
        <Button type="submit" icon="arrowRight" busy={sending} busyLabel="…" disabled={!!disabled || !text.trim()} className={cx("shrink-0")}>Send</Button>
      </form>
    </Card>
  );
}
