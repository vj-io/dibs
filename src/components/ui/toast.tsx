"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx, TINT_BG, TINT_INK, type Tint } from "./cx";
import { Icon, type IconName } from "./icons";

export type ToastTone = "info" | "good" | "warn" | "urgent";
type Toast = { id: number; text: string; tone: ToastTone };
type ToastFn = (text: string, opts?: { tone?: ToastTone; ms?: number }) => void;

const TONE: Record<ToastTone, { tint: Tint; icon: IconName }> = {
  info: { tint: "sky", icon: "bell" },
  good: { tint: "lime", icon: "check" },
  warn: { tint: "peach", icon: "warning" },
  urgent: { tint: "pink", icon: "clock" },
};

const Ctx = createContext<ToastFn | null>(null);

/** `const toast = useToast(); toast("Copied", { tone: "good" })`. Needs <ToastProvider> (in the root layout). */
export function useToast(): ToastFn {
  const fn = useContext(Ctx);
  if (!fn) throw new Error("useToast needs <ToastProvider>");
  return fn;
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastFn>((text, opts) => {
    const id = ++seq;
    setItems((xs) => [...xs.slice(-2), { id, text, tone: opts?.tone ?? "info" }]);
    setTimeout(() => dismiss(id), opts?.ms ?? 4000);
  }, [dismiss]);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div aria-live="polite" role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className={cx("pop-in pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-wobble border-[2.5px] border-ink px-3 py-2 shadow-ink", TINT_BG[TONE[t.tone].tint])}>
            <Icon name={TONE[t.tone].icon} size={20} stroke={2.6} className={TINT_INK[TONE[t.tone].tint]} />
            <p className="min-w-0 flex-1 font-semibold">{t.text}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="grid size-12 shrink-0 place-items-center -my-2 -mr-2 rounded-full" aria-label="Dismiss">
              <Icon name="cross" size={18} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
