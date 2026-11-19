"""Shared helpers for the production checks: env from .env.local (never printed), Supabase Admin API, read/delete SQL via node."""
import json, subprocess, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://tapdibs.vercel.app"
ENV = dict(l.split("=", 1) for l in (ROOT / ".env.local").read_text().splitlines() if "=" in l and not l.startswith("#"))
SB = ENV["NEXT_PUBLIC_SUPABASE_URL"].strip().strip('"')
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"].strip().strip('"')


def admin(method: str, path: str, body=None):
    """Supabase Auth Admin API. Returns (status, json). Sends no email for generate_link."""
    req = urllib.request.Request(SB + "/auth/v1" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read()
            return r.status, json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def magic_link(email: str) -> dict:
    s, j = admin("POST", "/admin/generate_link", {"type": "magiclink", "email": email})
    assert s == 200, (s, j)
    p = j.get("properties", j)  # shape: {id, email, ..., action_link, email_otp, ...} (flat in current GoTrue)
    return {"user_id": j.get("id") or j.get("user", {}).get("id"), "action_link": p["action_link"], "email_otp": p["email_otp"]}


def sql(query: str, *params):
    """Run one parameterised query ($1, $2…) through the project's postgres client; returns rows as dicts."""
    js = ("import postgres from 'postgres'; const [q, p] = JSON.parse(process.argv[1]);"
          "const sql = postgres(process.env.DATABASE_URL_SESSION, { ssl: 'require', max: 1, onnotice: () => {} });"
          "try { console.log(JSON.stringify(await sql.unsafe(q, p))); } finally { await sql.end(); }")
    out = subprocess.run(["node", "--env-file=.env.local", "--input-type=module", "-e", js, json.dumps([query, list(params)])],
                         cwd=ROOT, capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr.strip()[-600:])
    return json.loads(out.stdout)
