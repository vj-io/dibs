"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { BottomSheet, Button, Field, Input } from "@/components/ui";

/** First visit: name + 10-digit phone, no OTP. Calls onJoined with the public name. */
export function JoinSheet({ open, onClose, shopSlug, shopName, onJoined }: {
  open: boolean; onClose: () => void; shopSlug: string; shopName: string; onJoined: (displayName: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ name?: string; phone?: string; form?: string }>({});

  async function join() {
    const digits = phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
    const e: typeof err = {};
    if (!name.trim()) e.name = "Tell the seller your name.";
    if (!/^[6-9]\d{9}$/.test(digits)) e.phone = "Enter a 10-digit Indian mobile number.";
    setErr(e);
    if (e.name || e.phone) return;
    setBusy(true);
    try {
      const r = await api("POST /api/buyer/join", { name: name.trim(), phone: digits, shopSlug });
      onJoined(r.displayName);
    } catch (x) {
      const a = x instanceof ApiError ? x : null;
      if (a?.code === "invalid_phone") setErr({ phone: a.message });
      else setErr({ form: a?.message ?? "Couldn't join. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={<>Join the sale at {shopName}</>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); void join(); }}>
        <Field label="Your name" error={err.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} placeholder="Priya Sharma" autoFocus />
        </Field>
        <Field label="Phone number" hint="10 digits" error={err.phone}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel-national" maxLength={16} placeholder="98765 43210" />
        </Field>
        <p className="text-[0.95rem] leading-snug text-muted">We use your number only so the seller can reach you about your order.</p>
        {err.form && <p role="alert" className="font-semibold text-pink-ink">{err.form}</p>}
        <Button type="submit" size="lg" busy={busy} busyLabel="Joining…" icon="arrowRight">Join</Button>
      </form>
    </BottomSheet>
  );
}
