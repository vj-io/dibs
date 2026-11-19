"use client";
// Chat panel for the sale room (open channel) and the order room (group with read receipts).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ASSISTANT_ID, BOT_ID } from "@/lib/codec";
import { hhmm } from "@/lib/client/hooks";
import { Avatar, Icon, cx } from "@/components/ui";

export type ChatLine = { id: string; from: string; fromName?: string; at: number; text: string };

export const MAX_CHARS = 200;
const GAP_MS = 2000;
const EMOJI = ["😍", "🔥", "🙏", "👀", "😭"];

type Who = { name: string; tag?: string; bot?: boolean; staff?: boolean; mine: boolean };

/** Who sent a line: assistant and demo bots carry 🤖, staff carry their role. */
export function whoIs(l: ChatLine, meId: string | null): Who {
  if (l.from === meId) return { name: "You", mine: true };
  if (l.from === ASSISTANT_ID) return { name: "Dibs assistant", tag: "🤖 Dibs assistant", bot: true, mine: false };
  if (l.from === BOT_ID) return { name: "Dibs", tag: "🤖 Dibs", bot: true, mine: false };
  if (l.from.startsWith("demo_bot_")) return { name: l.fromName || "Demo buyer", tag: "🤖 Demo buyer", bot: true, mine: false };
  if (l.from.startsWith("demo_")) return { name: l.fromName || "Demo staff", tag: "🤖 Demo staff", bot: true, mine: false };
  if (l.from.startsWith("s_")) return { name: l.fromName || "Seller", tag: "Seller team", staff: true, mine: false };
  return { name: l.fromName || "Buyer", mine: false };
}

export function Chat({
  title = "Chat", lines, meId, onSend, readOnly, disabledReason, note, receipts, collapsible, defaultOpen = true, empty, className, maxHeight = "max-h-80",
}: {
  title?: ReactNode;
  lines: ChatLine[];
  meId: string | null;
  /** Rejects with an Error whose message is shown under the input. */
  onSend?: (text: string) => Promise<void>;
  readOnly?: boolean;
  /** Input visible but locked, with this sentence (muted, banned, not joined). */
  disabledReason?: string | null;
  /** One line under the input (e.g. a scam-shield notice). */
  note?: string | null;
  /** message id -> time it was seen (ms) by someone else */
  receipts?: Record<string, number>;
  collapsible?: boolean;
  defaultOpen?: boolean;
  empty?: ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [cool, setCool] = useState(false);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const panelId = useId();

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, open]);

  async function submit(t: string) {
    const v = t.trim().slice(0, MAX_CHARS);
    if (!v || !onSend || cool || sending) return;
    setSending(true); setErr(null);
    try {
      await onSend(v);
      setText("");
      stick.current = true;
      setCool(true);
      setTimeout(() => setCool(false), GAP_MS);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  const locked = !!disabledReason;
  return (
    <section className={cx("rounded-wobble-2 border-[2.5px] border-ink bg-card shadow-ink-sm", className)} aria-label={typeof title === "string" ? title : "Chat"}>
      <h2 className="text-lg">
        {collapsible ? (
          <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}
            className="flex min-h-12 w-full items-center gap-2 px-4 text-left font-extrabold">
            <Icon name="chat" size={20} />
            <span className="flex-1">{title}</span>
            <span className="font-mono text-sm font-normal text-muted">{lines.length || ""}</span>
            <Icon name={open ? "chevronUp" : "chevronDown"} size={20} />
            <span className="sr-only">{open ? "Hide chat" : "Show chat"}</span>
          </button>
        ) : (
          <span className="flex min-h-12 items-center gap-2 px-4 font-extrabold"><Icon name="chat" size={20} />{title}</span>
        )}
      </h2>
      <div id={panelId} hidden={!open} className="border-t-2 border-ink/15">
        <ol ref={list} aria-label="Messages"
          onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
          className={cx("flex flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-3", maxHeight)}>
          {lines.length === 0 && <li className="py-4 text-center font-hand text-lg text-muted">{empty ?? "No messages yet. Say hi 👋"}</li>}
          {lines.map((l) => {
            const w = whoIs(l, meId);
            const seen = receipts?.[l.id];
            return (
              <li key={l.id} className={cx("flex max-w-full items-end gap-2", w.mine && "flex-row-reverse")}>
                {!w.mine && <Avatar name={w.name} bot={w.bot} size={30} />}
                <div className={cx("flex min-w-0 max-w-[85%] flex-col", w.mine && "items-end")}>
                  <span className="flex flex-wrap items-center gap-1 px-1 text-sm leading-tight">
                    <span className="font-semibold">{w.name}</span>
                    {w.tag && (
                      <span className={cx("rounded-pill border px-1.5 text-xs font-semibold",
                        w.bot ? "border-violet-ink bg-violet text-violet-ink" : "border-sky-ink bg-sky text-sky-ink")}>{w.tag}</span>
                    )}
                    <span className="font-mono text-xs text-muted">{hhmm(l.at)}</span>
                  </span>
                  <p className={cx("rounded-wobble border-2 border-ink px-3 py-1.5 leading-snug [overflow-wrap:anywhere]",
                    w.mine ? "bg-lime" : w.bot ? "bg-violet" : w.staff ? "bg-sky" : "bg-paper")}>{l.text}</p>
                  {w.mine && seen && <span className="px-1 font-mono text-xs text-muted">Seen {hhmm(seen)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
        {!readOnly && onSend && (
          <form className="flex flex-col gap-2 border-t-2 border-ink/15 p-3" onSubmit={(e) => { e.preventDefault(); void submit(text); }}>
            {locked ? (
              <p role="status" className="flex items-center gap-2 rounded-wobble border-2 border-ink bg-peach px-3 py-2 font-semibold">
                <Icon name="lock" size={18} className="text-peach-ink" />{disabledReason}
              </p>
            ) : (
              <>
                <div className="flex gap-1" role="group" aria-label="Quick emoji">
                  {EMOJI.map((e) => (
                    <button key={e} type="button" onClick={() => setText((t) => (t + e).slice(0, MAX_CHARS))}
                      className="grid size-12 place-items-center rounded-full text-2xl active:scale-90" aria-label={`Add ${e}`}>{e}</button>
                  ))}
                </div>
                <div className="flex items-stretch gap-2">
                  <label className="sr-only" htmlFor={`${panelId}-in`}>Message</label>
                  <input id={`${panelId}-in`} value={text} maxLength={MAX_CHARS} onChange={(e) => setText(e.target.value)}
                    placeholder="Say something…" autoComplete="off" enterKeyHint="send"
                    className="min-h-12 w-full min-w-0 flex-1 rounded-wobble-2 border-[2.5px] border-ink bg-paper px-3 text-base shadow-ink-sm" />
                  <button type="submit" disabled={!text.trim() || cool || sending} aria-label="Send"
                    className="grid min-h-12 min-w-12 place-items-center rounded-wobble border-[2.5px] border-ink bg-lime px-3 font-extrabold shadow-ink-sm active:translate-x-px active:translate-y-px active:shadow-none disabled:bg-grey disabled:text-grey-ink disabled:shadow-none">
                    <Icon name="arrowRight" size={22} stroke={2.6} />
                  </button>
                </div>
                <p className="flex justify-between px-1 font-mono text-xs text-muted" aria-live="off">
                  <span>{cool ? "One message every 2 s" : ""}</span>
                  <span>{text.length}/{MAX_CHARS}</span>
                </p>
              </>
            )}
            {(err || note) && (
              <p role="alert" className="flex items-start gap-1.5 font-semibold text-pink-ink">
                <Icon name="warning" size={18} className="mt-0.5" />{err ?? note}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
