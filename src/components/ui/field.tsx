"use client";
import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

type FieldCtx = { id: string; describedBy?: string; invalid: boolean };
const Ctx = createContext<FieldCtx | null>(null);

/** Label + hint + error around one control. The control picks up id, aria-describedby and aria-invalid. */
export function Field({ label, hint, error, children, className }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode | null; children: ReactNode; className?: string;
}) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <Ctx.Provider value={{ id, describedBy, invalid: !!error }}>
      <div className={cx("flex flex-col gap-1", className)}>
        <label htmlFor={id} className="font-hand text-xl leading-tight">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-[0.95rem] leading-snug text-muted">{hint}</p>}
        {children}
        {error && (
          <p id={`${id}-err`} role="alert" className="flex items-start gap-1.5 text-[0.95rem] font-semibold leading-snug text-pink-ink">
            <Icon name="warning" size={18} stroke={2.6} className="mt-px" />{error}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

const control = (invalid: boolean) => cx(
  "w-full min-h-12 rounded-wobble-2 border-[2.5px] bg-card px-3.5 py-2.5 text-base text-ink shadow-ink-sm",
  "placeholder:text-muted focus-visible:outline-offset-2",
  invalid ? "border-pink-ink" : "border-ink",
);

function useField(id?: string) {
  const f = useContext(Ctx);
  return { id: id ?? f?.id, "aria-describedby": f?.describedBy, "aria-invalid": f?.invalid || undefined, invalid: !!f?.invalid };
}

export function Input({ className, id, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  const { invalid, ...a } = useField(id);
  return <input {...a} {...p} className={cx(control(invalid), className)} />;
}

export function Textarea({ className, id, rows = 3, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { invalid, ...a } = useField(id);
  return <textarea {...a} rows={rows} {...p} className={cx(control(invalid), "resize-y", className)} />;
}

export function Select({ className, id, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  const { invalid, ...a } = useField(id);
  return (
    <div className="relative">
      <select {...a} {...p} className={cx(control(invalid), "appearance-none pr-11", className)}>{children}</select>
      <Icon name="chevronDown" size={20} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
    </div>
  );
}
