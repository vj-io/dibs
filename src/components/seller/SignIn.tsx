"use client";
// Seller sign-in. Main path: email + password (two tabs, Create account / Sign in), which sends no email at all.
// Second path: "Email me a code instead" (one-time code or magic link, Supabase mailer) -> POST /api/seller/session.
// Invite links (/seller?invite=…) get their own form. No shop yet -> the shop form -> /seller/start.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AppHeader, Button, cx, Field, Icon, Input, LinkButton, Sheet } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { supabaseBrowser } from "@/lib/client/supabase-browser";
import type { SellerMe } from "@/lib/types";
import { errMsg } from "./kit";
import { ShopForm } from "./ShopForm";

type Mode = "create" | "signin" | "code";
type Done = { needsShop: false; me: SellerMe } | { needsShop: true; email: string };
export type InviteView = { token: string; email: string; name: string; shopName: string } | { error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE = "rate";
const DEMO = "/try?role=seller";

const emailErr = (e: string) => (!e.trim() ? "Enter your email address." : EMAIL.test(e.trim()) ? undefined : "That doesn't look like an email. It looks like meera@gmail.com.");
const pwErr = (p: string) => (!p ? "Enter a password." : p.length < 8 ? "Use at least 8 characters." : p.length > 72 ? "Use at most 72 characters." : undefined);

export function SignIn({ pendingEmail, invite }: { pendingEmail: string | null; invite: InviteView | null }) {
  const router = useRouter();
  const [shopFor, setShopFor] = useState<{ email: string; name: string } | null>(pendingEmail ? { email: pendingEmail, name: "" } : null);
  const [mode, setMode] = useState<Mode>("create");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; exists?: boolean } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const done = (r: Done, who = name) => {
    if (r.needsShop) setShopFor({ email: r.email, name: who.trim() });
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
      if (bad || !token) { setMode("code"); setErr({ text: `${bad ?? "That link didn't work"}. Ask for a new code.` }); return; }
      setLinkBusy(true);
      try { done(await api("POST /api/seller/session", { accessToken: token })); } catch (e) { setErr({ text: errMsg(e) }); } finally { setLinkBusy(false); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const errors = {
    name: mode === "create" && !name.trim() ? "Your name, so your team knows who you are." : name.trim().length > 40 ? "Up to 40 characters." : undefined,
    email: emailErr(email),
    password: mode === "create" ? pwErr(password) : !password ? "Enter your password." : undefined,
  };
  const show = (k: keyof typeof errors) => (shown.has("*") || shown.has(k) ? errors[k] : undefined);
  const blur = (k: string) => () => setShown((s) => new Set(s).add(k));
  const switchTo = (m: Mode) => { setMode(m); setErr(null); setShown(new Set()); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShown(new Set(["*"]));
    if (errors.email || errors.password || (mode === "create" && errors.name)) return;
    setBusy(true); setErr(null);
    try {
      const em = email.trim().toLowerCase();
      done(mode === "create"
        ? await api("POST /api/seller/signup", { email: em, password, name: name.trim() })
        : await api("POST /api/seller/login", { email: em, password }));
    } catch (x) {
      setErr({ text: errMsg(x), exists: x instanceof ApiError && x.code === "account_exists" });
    } finally { setBusy(false); }
  };

  if (shopFor) {
    return (
      <Frame>
        <div>
          <h1 className="text-4xl">Set up your shop</h1>
          <p className="mt-2 text-muted">Signed in as <b className="text-ink">{shopFor.email}</b>. Two minutes, then a short checklist gets your first drop ready.</p>
        </div>
        <Sheet title="Your shop">
          <ShopForm ownerName={shopFor.name} onCreated={() => { router.replace("/seller/start"); router.refresh(); }} />
        </Sheet>
      </Frame>
    );
  }

  if (invite) return <Frame><InviteForm invite={invite} onDone={done} /></Frame>;

  const errorBox = err && <ErrorBox text={err.text} action={err.exists ? <Button size="sm" variant="ghost" icon="arrowRight" onClick={() => switchTo("signin")}>Sign in instead</Button> : undefined} />;

  return (
    <Frame>
      <div>
        <h1 className="text-4xl">Run your drop on Dibs</h1>
        <p className="mt-2 text-lg text-muted">First tap wins, everyone sees it, and every winner gets an order chat with your team.</p>
      </div>
      <Sheet>
        {linkBusy ? (
          <p className="flex items-center gap-2 font-semibold"><Icon name="clock" className="motion-safe:animate-spin" />Signing you in…</p>
        ) : mode === "code" ? (
          <CodeSignIn initialEmail={email} initialErr={err?.text ?? null} onDone={done} onBack={() => switchTo("signin")} />
        ) : (
          <>
            <Tabs mode={mode} onChange={switchTo} />
            <form id="pw-panel" role="tabpanel" aria-labelledby={`tab-${mode}`} onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4">
              {mode === "create" && (
                <Field label="Your name" error={show("name")}>
                  <Input name="name" autoComplete="name" value={name} maxLength={40} onBlur={blur("name")} onChange={(e) => setName(e.target.value)} placeholder="Meera" />
                </Field>
              )}
              <Field label="Email" error={show("email")}>
                <Input type="email" name="email" autoComplete={mode === "create" ? "email" : "username"} inputMode="email" autoCapitalize="none" spellCheck={false}
                  value={email} onBlur={blur("email")} onChange={(e) => setEmail(e.target.value)} placeholder="meera@gmail.com" />
              </Field>
              <PasswordField value={password} onChange={setPassword} onBlur={blur("password")} error={show("password")}
                isNew={mode === "create"} hint={mode === "create" ? "At least 8 characters. We never email you, so nothing waits on an inbox." : undefined} />
              {errorBox}
              <Button type="submit" size="lg" icon="arrowRight" busy={busy} busyLabel={mode === "create" ? "Creating…" : "Signing in…"}>
                {mode === "create" ? "Create my account" : "Sign in"}
              </Button>
              {mode === "signin" && (
                <div className="flex flex-col gap-1 rounded-wobble border-2 border-dashed border-ink/40 p-3">
                  <p className="font-semibold">Forgot your password, or never set one?</p>
                  <p className="text-[0.95rem] text-muted">We can email you a one-time code instead. After you&apos;re in, set a new password on the Shop page.</p>
                  <Button size="sm" variant="ghost" icon="arrowRight" className="mt-1 self-start" onClick={() => switchTo("code")}>Email me a code instead</Button>
                </div>
              )}
            </form>
          </>
        )}
      </Sheet>
      <p className="text-center text-muted">Just looking? <Link href={DEMO} className="font-semibold text-ink underline decoration-2">Try the seller demo instead</Link>. No sign-up.</p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader title="For sellers" />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pb-16 pt-8">{children}</main>
    </>
  );
}

function ErrorBox({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2">
      <Icon name="warning" className="mt-0.5 shrink-0 text-pink-ink" />
      {text === RATE ? (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Too many sign-in emails were sent in the last hour, so we can&apos;t send another one right now.</p>
          <p>Sign in with your password instead, try again in a while, or look around with the demo shop.</p>
          <LinkButton href={DEMO} variant="ghost" size="sm" icon="robot" className="self-start">Try the seller demo instead</LinkButton>
        </div>
      ) : <div className="flex flex-col gap-2"><p className="font-semibold">{text}</p>{action && <div>{action}</div>}</div>}
    </div>
  );
}

function Tabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabs: [Mode, string][] = [["create", "Create account"], ["signin", "Sign in"]];
  const key = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = mode === "create" ? "signin" : "create";
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Account" className="grid grid-cols-2 gap-1 rounded-wobble-2 border-[2.5px] border-ink bg-paper p-1" onKeyDown={key}>
      {tabs.map(([m, label]) => (
        <button key={m} id={`tab-${m}`} ref={(el) => { refs.current[m] = el; }} type="button" role="tab" aria-selected={mode === m} aria-controls="pw-panel"
          tabIndex={mode === m ? 0 : -1} onClick={() => onChange(m)}
          className={cx("min-h-12 rounded-wobble-2 px-2 text-base font-extrabold sm:text-lg", mode === m ? "border-2 border-ink bg-lime shadow-ink-sm" : "text-muted hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function PasswordField({ value, onChange, onBlur, error, hint, isNew, label = "Password" }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string; hint?: string; isNew: boolean; label?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error}>
      <div className="relative">
        <Input type={visible ? "text" : "password"} name="password" autoComplete={isNew ? "new-password" : "current-password"} autoCapitalize="none" spellCheck={false}
          value={value} maxLength={72} onBlur={onBlur} onChange={(e) => onChange(e.target.value)} className="pr-24" />
        <button type="button" onClick={() => setVisible(!visible)} aria-pressed={visible} aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-1 top-1/2 flex min-h-11 -translate-y-1/2 items-center gap-1 rounded-wobble-2 px-2.5 font-semibold underline decoration-2 underline-offset-4">
          <Icon name="eye" size={18} />{visible ? "Hide" : "Show"}
        </button>
      </div>
    </Field>
  );
}

function InviteForm({ invite, onDone }: { invite: InviteView; onDone: (r: Done) => void }) {
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if ("error" in invite) {
    return (
      <>
        <h1 className="text-4xl">Invite link</h1>
        <ErrorBox text={invite.error} />
        <LinkButton href="/seller" variant="ghost" icon="arrowRight" className="self-start">Go to seller sign-in</LinkButton>
      </>
    );
  }
  const error = pwErr(password);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (error) return;
    setBusy(true); setErr(null);
    try { onDone(await api("POST /api/seller/invite", { token: invite.token, password })); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <>
      <div>
        <h1 className="text-4xl">Join {invite.shopName}</h1>
        <p className="mt-2 text-lg text-muted">{invite.shopName} invited <b className="text-ink">{invite.name}</b> to its team on Dibs: you&apos;ll see orders, confirm payments and chat with buyers.</p>
      </div>
      <Sheet title="Your team account">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-hand text-xl leading-tight">Email</p>
            <p className="break-all rounded-wobble-2 border-2 border-ink/30 bg-paper px-3.5 py-2.5 font-semibold" data-testid="invite-email">{invite.email}</p>
            <p className="text-[0.95rem] text-muted">This link only works for this email.</p>
          </div>
          <PasswordField value={password} onChange={setPassword} onBlur={() => setShown(true)} error={shown ? error : undefined} isNew
            label="Choose a password" hint="At least 8 characters. If this email already has a Dibs account, enter that password instead." />
          {err && <ErrorBox text={err} />}
          <Button type="submit" size="lg" icon="check" busy={busy} busyLabel="Joining…">Join the team</Button>
        </form>
      </Sheet>
    </>
  );
}

/** The email-code path (Supabase mailer): send a code, type it, or tap the magic link in the email. */
function CodeSignIn({ initialEmail, initialErr, onDone, onBack }: { initialEmail: string; initialErr: string | null; onDone: (r: Done) => void; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(initialErr);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const em = (sentTo ?? email).trim().toLowerCase();
    const bad = emailErr(em);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr(null);
    try {
      const { error } = await supabaseBrowser().auth.signInWithOtp({ email: em, options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/seller` } });
      if (error) {
        const rate = error.status === 429 || /rate limit|security purposes|too many/i.test(error.message);
        setErr(rate ? RATE : error.message || "We couldn't send the code. Try again.");
        return;
      }
      setCode("");
      setSentTo(em);
    } catch { setErr("You're offline. Check your connection and try again."); } finally { setBusy(false); }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    const token = code.replace(/\D/g, "");
    if (token.length < 6 || token.length > 8) { setErr("The code is 6 to 8 digits. Check the email we sent."); return; }
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabaseBrowser().auth.verifyOtp({ email: sentTo, token, type: "email" });
      if (error || !data.session) { setErr(error?.status === 429 ? RATE : "That code didn't work. It may have expired. Ask for a new one."); return; }
      onDone(await api("POST /api/seller/session", { accessToken: data.session.access_token }));
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-hand text-2xl font-normal">{sentTo ? "Check your email" : "Email me a code"}</h2>
      {!sentTo ? (
        <form onSubmit={send} noValidate className="flex flex-col gap-4">
          <Field label="Email" hint="We'll email you a one-time code. Emails can take a minute, and only a few can be sent each hour.">
            <Input type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="meera@gmail.com" autoFocus />
          </Field>
          {err && <ErrorBox text={err} />}
          <Button type="submit" size="lg" icon="arrowRight" busy={busy} busyLabel="Sending…">Send my code</Button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate className="flex flex-col gap-4">
          <p>We sent a code to <b>{sentTo}</b>. If the email has a sign-in link instead, tap it on this device.</p>
          <Field label="One-time code" hint="6 to 8 digits.">
            <Input name="code" autoComplete="one-time-code" inputMode="numeric" maxLength={8} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="font-mono text-2xl tracking-[0.3em]" autoFocus />
          </Field>
          {err && <ErrorBox text={err} />}
          <Button type="submit" size="lg" icon="check" busy={busy} busyLabel="Checking…">Sign in</Button>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => send()} disabled={busy}>Send a new code</Button>
            <Button size="sm" variant="ghost" onClick={() => { setErr(null); setSentTo(null); }}>Use another email</Button>
          </div>
        </form>
      )}
      <Button size="sm" variant="ghost" icon="chevronLeft" className="self-start" onClick={onBack}>Back to password sign-in</Button>
    </div>
  );
}
