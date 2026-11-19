"""Shop club against live Nexconn, browser side: src/lib/client/live.ts (watchClub) on /poc/live in headless Chromium.
Server actions through scripts/club-poc.ts (Server API). Works with the mock-mode dev server: Playwright answers
/api/config (nexconn mode, the public app key) and /api/nexconn/token (a server-issued token), so the page runs the
real Nexconn Web SDK. Run:  ~/.claude/brag-scaled-venv/bin/python tests/e2e/club_live.py [base_url]
Ids start with dibspoc_; the community is dismissed at the end."""
import json, os, statistics, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
APP_KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env.local")) if l.startswith("NEXCONN_APP_KEY="))
CLUB = f"dibspoc_club_{hex(int(time.time()))[2:]}"
A, B, C = "dibspoc_ca", "dibspoc_cb", "dibspoc_cc"  # A, C members; B never joins
NAMES = {A: "Poc Asha", B: "Poc Bala", C: "Poc Chetan"}
results = []


def node(*args):
    p = subprocess.run(["node", "--env-file=.env.local", "scripts/club-poc.ts", *args], cwd=ROOT, capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.startswith("{")]
    return json.loads(out[-1]) if out else {"error": "no output", "stderr": p.stderr[-300:]}


def report(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail}", flush=True)


def llog(p, since=0):
    return p.evaluate(f"window.liveLog.slice({since})")


def lwait(p, pred, since=0, timeout=8.0):
    end = time.time() + timeout
    while time.time() < end:
        hits = [e for e in llog(p, since) if pred(e)]
        if hits:
            return hits
        time.sleep(0.05)
    return []


def main():
    t0 = time.time()
    r = node("ensure", CLUB)
    report("create community + 3 subchannels", r.get("ok") is True, json.dumps(r))
    for u in (A, C):
        r = node("join", CLUB, u)
        report(f"join {u}", r.get("ok") is True, json.dumps(r))
    cfg = {"mode": "nexconn", "appKey": APP_KEY, "area": "SG", "textEnvelope": False,
           "features": {"premessage": False, "community": True, "systemChannel": True, "calls": False}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        pages = {}
        for uid in (A, B):
            ctx = browser.new_context()
            ctx.route("**/api/config", lambda route, _req: route.fulfill(json=cfg))
            ctx.route("**/api/nexconn/token", lambda route, _req, uid=uid: route.fulfill(
                json={"userId": uid, "name": NAMES[uid], "token": node("token", uid, NAMES[uid])["token"]}))
            p = ctx.new_page()
            p.goto(BASE + "/poc/live")
            p.wait_for_function("window.live || window.liveErr", timeout=90000)
            for sub in ("drops", "chat", "reviews"):
                p.evaluate("k => window.live.l.watchClub(k, (m) => window.live.push({ ev: 'club', m }))", f"{CLUB}.{sub}")
            pages[uid] = p
        pa, pb = pages[A], pages[B]
        report("connect A (member)", bool(lwait(pa, lambda e: e["ev"] == "status" and e["s"] == "connected", timeout=20)))
        report("connect B (not a member)", bool(lwait(pb, lambda e: e["ev"] == "status" and e["s"] == "connected", timeout=20)))

        # bot announcement to #drops, n=10, latency server send -> browser receive
        lat = []
        for i in range(10):
            mark = len(llog(pa))
            s = node("send", CLUB, "drops", "dibs_bot", f"drop soon #{i}")
            g = lwait(pa, lambda e, i=i: e["ev"] == "club" and e["m"].get("text") == f"drop soon #{i}", mark)
            if g:
                lat.append(g[0]["recvAt"] - s["sentAt"])
        report("bot -> #drops reaches member A via watchClub (10/10)", len(lat) == 10,
               f"median {statistics.median(lat) if lat else '-'} ms, min {min(lat) if lat else '-'}, max {max(lat) if lat else '-'}")
        g = [e for e in llog(pa) if e["ev"] == "club"]
        report("channel key = <club>.drops, sender dibs_bot, kind text", bool(g) and g[0]["m"]["channel"] == f"{CLUB}.drops"
               and g[0]["m"]["from"] == "dibs_bot" and g[0]["m"]["kind"] == "text", json.dumps(g[:1])[:240])

        # member C's chat line (sent by our server as C) -> A, with a name from GET /api/names (unknown id here -> none)
        mark = len(llog(pa))
        s = node("send", CLUB, "chat", C, "hi from Chetan")
        g = lwait(pa, lambda e: e["ev"] == "club" and e["m"].get("text") == "hi from Chetan", mark)
        report("member C -> #chat reaches A", bool(g) and g[0]["m"]["channel"] == f"{CLUB}.chat" and g[0]["m"]["from"] == C,
               f"{g[0]['recvAt'] - s['sentAt']} ms" if g else "")

        mark = len(llog(pa))
        node("send", CLUB, "reviews", "dibs_bot", "★★★★☆ Poc A.: lovely")
        report("bot -> #reviews reaches A", bool(lwait(pa, lambda e: e["ev"] == "club" and e["m"]["channel"] == f"{CLUB}.reviews", mark)))

        time.sleep(1.5)
        report("non-member B received nothing", not [e for e in llog(pb) if e["ev"] == "club"])

        r = node("recall", CLUB, "chat", C, s["messageId"])
        report("recall C's chat line (/v4/message/delete, channelType 10 + subchannelId)", r.get("ok") is True, json.dumps(r))

        r = node("leave", CLUB, A)
        report("leave A", r.get("ok") is True)
        time.sleep(1)
        mark = len(llog(pa))
        node("send", CLUB, "drops", "dibs_bot", "after leave")
        time.sleep(3)
        report("A no longer receives after leaving", not [e for e in llog(pa, mark) if e["ev"] == "club"])
        browser.close()
    r = node("cleanup", CLUB)
    report("dismiss community", r.get("ok") is True)
    print(json.dumps({"club": CLUB, "passed": sum(results), "total": len(results), "seconds": round(time.time() - t0)}))
    sys.exit(0 if all(results) else 1)


main()
