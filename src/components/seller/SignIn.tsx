"use client";
// Seller sign-in: email -> one-time code (6-8 digits) or magic link -> POST /api/seller/session -> drops, or the shop form.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AppHeader, Button, Field, Icon, Input, LinkButton, Sheet } from "@/components/ui";
import { api } from "@/lib/client/api";
import { supabaseBrowser } from "@/lib/client/supabase-browser";
import { errMsg } from "./kit";
import { ShopForm } from "./ShopForm";

type Step = { s: "email" } | { s: "code"; email: string } | { s: "shop"; email: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE = "rate";

export function SignIn({ pendingEmail }: { pendingEmail: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(pendingEmail ? { s: "shop", email: pendingEmail } : { s: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const finish = async (accessToken: string) => {
    const r = await api("POST /api/seller/session", { accessToken });
    if (r.needsShop) setStep({ s: "shop", email: r.email });
    else { router.replace("/seller/drops"); router.refresh(); }
  };

  // Magic-link template: the email link lands here with #access_token=… in the hash.
  useEffect(() => {
    if (!location.hash.includes("access_token") && !location.hash.includes("error_description")) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname);
    const token = hash.get("access_token");
    const bad = hash.get("error_description");
    void Promise.resolve().then(async () => {
      if (bad || !token) { setErr(`${bad ?? "That link didn't work"}. Ask for a new code.`); return; }
      setLinkBusy(true);
      try { await finish(token); } catch (e) { setErr(errMsg(e)); } finally { setLinkBusy(false); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const em = email.trim().toLowerCase();
    if (!EMAIL.test(em)) { setErr("Enter your email address, like meera@gmail.com."); return; }
    setBusy(true); setErr(null);
    try {
      const { error } = await supabaseBrowser().auth.signInWithOtp({
        email: em, options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/seller` },
      });
      if (error) {
        const rate = error.status === 429 || /rate limit|security purposes|too many/i.test(error.message);
        setErr(rate ? RATE : error.message || "We couldn't send the code. Try again.");
        return;
      }
      setCode("");
      setStep({ s: "code", email: em });
    } catch { setErr("You're offline. Check your connection and try again."); } finally { setBusy(false); }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (step.s !== "code") return;
    const token = code.replace(/\D/g, "");
    if (token.length < 6 || token.length > 8) { setErr("The code is 6 to 8 digits. Check the email we sent."); return; }
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabaseBrowser().auth.verifyOtp({ email: step.email, token, type: "email" });
      if (error || !data.session) { setErr(error?.status === 429 ? RATE : "That code didn't work. It may have expired. Ask for a new one."); return; }
      await finish(data.session.access_token);
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  const errorBox = err && (
    <div role="alert" className="flex items-start gap-2 rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2">
      <Icon name="warning" className="mt-0.5 text-pink-ink" />
      {err === RATE ? (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Too many sign-in emails were sent in the last hour, so we can&apos;t send another one right now.</p>
          <p>Try again in a while, or look around with the demo shop.</p>
          <LinkButton href="/try" variant="ghost" size="sm" icon="robot" className="self-start">Try the seller demo instead</LinkButton>
        </div>
      ) : <p className="font-semibold">{err}</p>}
    </div>
  );

  return (
    <>
      <AppHeader title="For sellers" />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pb-16 pt-8">
        {step.s === "shop" ? (
          <>
            <div>
              <h1 className="text-4xl">Set up your shop</h1>
              <p className="mt-2 text-muted">Signed in as <b className="text-ink">{step.email}</b>. Two minutes, then you can add pieces and schedule a drop.</p>
            </div>
            <Sheet title="Your shop">
              <ShopForm onCreated={() => { router.replace("/seller/products"); router.refresh(); }} />
            </Sheet>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-4xl">Run your drop on Dibs</h1>
              <p className="mt-2 text-lg text-muted">First tap wins, everyone sees it, and every winner gets an order chat with your team.</p>
            </div>
            <Sheet title={step.s === "email" ? "Sign in with your email" : "Check your email"}>
              {linkBusy ? (
                <p className="flex items-center gap-2 font-semibold"><Icon name="clock" className="motion-safe:animate-spin" />Signing you in…</p>
              ) : step.s === "email" ? (
                <form onSubmit={send} noValidate className="flex flex-col gap-4">
                  <Field label="Email" hint="We'll email you a one-time code. No password.">
                    <Input type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="meera@gmail.com" autoFocus />
                  </Field>
                  {errorBox}
                  <Button type="submit" size="lg" icon="arrowRight" busy={busy} busyLabel="Sending…">Send my code</Button>
                </form>
              ) : (
                <form onSubmit={verify} noValidate className="flex flex-col gap-4">
                  <p>We sent a code to <b>{step.email}</b>. If the email has a sign-in link instead, tap it on this device.</p>
                  <Field label="One-time code" hint="6 to 8 digits.">
                    <Input name="code" autoComplete="one-time-code" inputMode="numeric" maxLength={8} value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="font-mono text-2xl tracking-[0.3em]" autoFocus />
                  </Field>
                  {errorBox}
                  <Button type="submit" size="lg" icon="check" busy={busy} busyLabel="Checking…">Sign in</Button>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => send()} disabled={busy}>Send a new code</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setErr(null); setStep({ s: "email" }); }}>Use another email</Button>
                  </div>
                </form>
              )}
            </Sheet>
            <p className="text-center text-muted">Just looking? <Link href="/try" className="font-semibold text-ink underline decoration-2">Try the seller demo</Link>. No sign-up.</p>
          </>
        )}
      </main>
    </>
  );
}
