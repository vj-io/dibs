"use client";
// Set or change the password of the signed-in account (e.g. after signing in with an emailed code).
import { useState, type FormEvent } from "react";
import { Button, Sheet, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { errMsg } from "./kit";
import { PasswordField } from "./SignIn";

export function SetPassword() {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const error = pw.length < 8 ? "Use at least 8 characters." : undefined;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (error) return;
    setBusy(true); setErr(null);
    try { await api("POST /api/seller/password", { password: pw }); toast("Password saved. Use it next time you sign in.", { tone: "good" }); setPw(""); setShown(false); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Your password">
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        <p className="text-[0.95rem] text-muted">Set a password so you can sign in without waiting for an email code.</p>
        <PasswordField value={pw} onChange={setPw} onBlur={() => setShown(true)} error={shown ? error : undefined} isNew label="New password" />
        {err && <p role="alert" className="font-semibold text-pink-ink">{err}</p>}
        <Button type="submit" icon="lock" busy={busy} busyLabel="Saving…" className="self-start">Save password</Button>
      </form>
    </Sheet>
  );
}
