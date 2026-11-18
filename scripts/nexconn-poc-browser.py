"""Nexconn proof of concept, browser side: two headless Chromium contexts on /poc, server actions through
scripts/nexconn-poc.ts. Run (dev server on 3102 first):
  ~/.claude/brag-scaled-venv/bin/python scripts/nexconn-poc-browser.py
Prints one line per check plus raw evidence as JSON at the end."""
import json, os, statistics, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "http://localhost:3102/poc"
APP_KEY = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env.local")) if l.startswith("NEXCONN_APP_KEY="))
TAG = hex(int(time.time()))[2:]
A, B = "dibspoc_b_a", "dibspoc_b_b"
ROOM, GRP, CLUB = f"dibspoc_r{TAG}", f"dibspoc_g{TAG}", f"dibspoc_c{TAG}"
evidence = {}


def node(*args):
    p = subprocess.run(["node", "--env-file=.env.local", "scripts/nexconn-poc.ts", *args], cwd=ROOT, capture_output=True, text=True)
    out = p.stdout.strip().splitlines()
    return json.loads(out[-1]) if out else {"error": "no output", "stderr": p.stderr[-300:]}


def report(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail}", flush=True)


def log(page, since=0):
    return page.evaluate(f"window.poc.log.slice({since})")


def wait_for(page, pred, timeout=8.0, since=0):
    end = time.time() + timeout
    while time.time() < end:
        hits = [e for e in log(page, since) if pred(e)]
        if hits:
            return hits
        time.sleep(0.1)
    return []


def mark(page):
    return page.evaluate("window.poc.log.length")


def text_of(e):
    c = e.get("content") or {}
    return c.get("text") if isinstance(c, dict) else None


def run_live():
    """--live: src/lib/client/live.ts on /poc/live (real /api/config; the token route is answered by Playwright
    with a fresh server-issued token, because the session/DB tables are not part of this package)."""
    names = {A: "Poc Asha", B: "Poc Bala"}

    def llog(p, since=0):
        return p.evaluate(f"window.liveLog.slice({since})")

    def lwait(p, pred, since=0, timeout=8.0):
        end = time.time() + timeout
        while time.time() < end:
            hits = [e for e in llog(p, since) if pred(e)]
            if hits:
                return hits
            time.sleep(0.1)
        return []

    is_card = lambda t: (lambda e: e["ev"] in ("room", "group") and e["m"]["kind"] == "card" and e["m"]["card"]["t"] == t)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        pages, ctxs = {}, {}
        for uid in (A, B):
            ctx = browser.new_context()
            ctx.route("**/api/nexconn/token", lambda route, _req, uid=uid: route.fulfill(
                json={"userId": uid, "name": names[uid], "token": node("token", uid, names[uid])["token"]}))
            p = ctx.new_page()
            p.goto(URL + "/live")
            p.wait_for_function("window.live || window.liveErr", timeout=60000)
            pages[uid], ctxs[uid] = p, ctx
        pa, pb = pages[A], pages[B]
        report("L connect A", bool(lwait(pa, lambda e: e["ev"] == "status" and e["s"] == "connected")), "")
        report("L connect B", bool(lwait(pb, lambda e: e["ev"] == "status" and e["s"] == "connected")), "")
        node("room-create", ROOM)
        for p in (pa, pb):
            p.evaluate("id => window.live.l.joinRoom(id, (m) => window.live.push({ ev: 'room', m }))", ROOM)
        node("room-send", ROOM, "custom", "high")
        report("L room custom card -> A, B (kind card)", bool(lwait(pa, is_card("DB:Sold"))) and bool(lwait(pb, is_card("DB:Sold"))))
        ma = len(llog(pa))
        node("room-send", ROOM, "envelope", "high")
        report("L room envelope card -> A (kind card)", bool(lwait(pa, is_card("DB:Sold"), ma)))
        ma = len(llog(pa))
        pb.evaluate("id => window.live.l.sendText({ type: 'room', id }, '[[DB:Sold]]{\"v\":99}')", ROOM)
        g = lwait(pa, lambda e: e["ev"] == "room" and e["m"]["from"] == B, ma)
        report("L buyer-pasted card stays text on A", bool(g) and g[0]["m"]["kind"] == "text", json.dumps(g[:1])[:200])
        mb = len(llog(pb))
        pa.evaluate("id => window.live.l.sendText({ type: 'room', id }, 'hello room')", ROOM)
        g = lwait(pb, lambda e: e["ev"] == "room" and e["m"].get("text") == "hello room", mb)
        report("L room text A -> B with display name", bool(g) and g[0]["m"].get("fromName") == "Poc Asha", json.dumps(g[:1])[:200])
        node("mute", ROOM, B, "5")
        time.sleep(0.5)
        err = pb.evaluate("id => window.live.l.sendText({ type: 'room', id }, 'muted').then(() => 'sent', (e) => e.code)", ROOM)
        report("L muted send rejects with LiveError code", err == "23408", err)
        node("unmute", ROOM, B)

        node("group-create", GRP, A, B)
        for p in (pa, pb):
            p.evaluate("id => window.live.l.watchGroup(id, (m) => window.live.push({ ev: 'group', m }))", GRP)
        node("group-send", GRP, "custom")
        report("L group card -> A, B", bool(lwait(pa, is_card("DB:Sold"))) and bool(lwait(pb, lambda e: e["ev"] == "group" and e["m"]["kind"] == "card")))
        sent = pa.evaluate("id => window.live.l.sendText({ type: 'group', id }, 'group hello')", GRP)
        lwait(pb, lambda e: e["ev"] == "group" and e["m"].get("text") == "group hello")
        ma = len(llog(pa))
        pb.evaluate("([g, id]) => window.live.l.markRead(g, [id])", [GRP, sent["id"]])
        g = lwait(pa, lambda e: e["ev"] == "receipts", ma)
        report("L markRead -> onReceipts", bool(g), json.dumps(g[:1])[:160])
        h = pb.evaluate("id => window.live.l.history(id)", GRP)
        report("L group history oldest first", len(h) >= 2 and h[0]["kind"] == "card" and h[-1].get("text") == "group hello", f"n={len(h)}")

        for via in ("direct", "system"):
            ma = len(llog(pa))
            node("user-send", A, via, "alert")
            g = lwait(pa, lambda e: e["ev"] == "alert", ma)
            report(f"L onAlert via {via}", bool(g), json.dumps(g[:1])[:160])

        ma = len(llog(pa))
        ctxs[A].set_offline(True)
        time.sleep(2)
        node("room-send", ROOM, "custom", "high")
        time.sleep(38)
        ctxs[A].set_offline(False)
        g = lwait(pa, is_card("DB:Sold"), ma, timeout=40)
        evs = llog(pa, ma)
        ids = [e["m"]["id"] for e in llog(pa) if e["ev"] == "room"]
        report("L 40 s offline: card sent while offline arrives after reconnect", bool(g),
               f"statuses={[e['s'] for e in evs if e['ev'] == 'status']} dupes={len(ids) - len(set(ids))}")
        browser.close()
    print("cleanup", node("room-destroy", ROOM), node("group-dismiss", GRP))


if "--live" in sys.argv:
    run_live()
    sys.exit()

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctxA, ctxB = browser.new_context(), browser.new_context()
    pa, pb = ctxA.new_page(), ctxB.new_page()
    for p, reg in ((pa, 1), (pb, 0)):
        p.goto(f"{URL}?reg={reg}")
        p.wait_for_function("window.poc && window.poc.ready", timeout=60000)

    # 1. tokens + connect
    ta, tb = node("token", A, "Poc Asha"), node("token", B, "Poc Bala")
    ra = pa.evaluate("([k,t]) => window.poc.init(k,t,true)", [APP_KEY, ta["token"]])
    rb = pb.evaluate("([k,t]) => window.poc.init(k,t,false)", [APP_KEY, tb["token"]])
    report("1 connect A (registered DB:*)", ra["ok"], f"code={ra['code']} {ra['ms']}ms")
    report("1 connect B (nothing registered)", rb["ok"], f"code={rb['code']} {rb['ms']}ms")

    # 2. open channel, both enter, chat both ways
    node("room-create", ROOM)
    ea = pa.evaluate("id => window.poc.enter(id, 10)", ROOM)
    eb = pb.evaluate("id => window.poc.enter(id, 10)", ROOM)
    evidence["enterA"], evidence["enterB"] = ea, eb
    report("2 enter A", ea["ok"], f"code={ea['code']} {ea['ms']}ms participantCount={(ea['data'] or {}).get('participantCount')}")
    report("2 enter B", eb["ok"], f"code={eb['code']} {eb['ms']}ms participantCount={(eb['data'] or {}).get('participantCount')}")
    m = mark(pb)
    t0 = time.time()
    sa = pa.evaluate("id => window.poc.sendRoom(id, 'hi from A')", ROOM)
    got = wait_for(pb, lambda e: e["ev"] == "msg" and text_of(e) == "hi from A", since=m)
    report("2 A text -> B", bool(got), f"send code={sa['code']} rtt~{int((time.time()-t0)*1000)}ms")
    if got: evidence["roomTextOnB"] = got[0]
    m = mark(pa)
    pb.evaluate("id => window.poc.sendRoom(id, 'hi from B')", ROOM)
    got = wait_for(pa, lambda e: e["ev"] == "msg" and text_of(e) == "hi from B", since=m)
    report("2 B text -> A", bool(got), f"channelType={got[0]['channelType'] if got else None} flat={got[0]['flat'] if got else None}")

    # 11. participant count
    time.sleep(1)
    evidence["participantEventsA"] = [e for e in log(pa) if e["ev"] == "participants"]
    rc = node("room-count", ROOM)
    report("11 participant count (server get)", rc.get("count") == 2, json.dumps(rc))
    report("11 onParticipantChanged on A", bool(evidence["participantEventsA"]), json.dumps(evidence["participantEventsA"][-1:])[:200])

    # 3. custom DB:Sold from dibs_bot, high priority
    ma, mb = mark(pa), mark(pb)
    r = node("room-send", ROOM, "custom", "high")
    ga = wait_for(pa, lambda e: e["ev"] == "msg" and e["sender"] == "dibs_bot" and e["messageType"] == "DB:Sold", since=ma)
    gb = wait_for(pb, lambda e: e["ev"] == "msg" and e["sender"] == "dibs_bot", since=mb)
    evidence["customOnA"], evidence["customOnB_unregistered"] = ga[:1], gb[:1]
    report("3 DB:Sold custom -> A (registered)", bool(ga), json.dumps(ga[0])[:260] if ga else json.dumps(r))
    report("3 DB:Sold custom -> B (not registered)", bool(gb), json.dumps(gb[0])[:260] if gb else "nothing arrived")
    ma = mark(pa)
    node("room-send", ROOM, "unregistered", "high")
    gu = wait_for(pa, lambda e: e["ev"] == "msg" and e["sender"] == "dibs_bot", since=ma)
    report("3 DB:Unreg (unregistered type) -> A", bool(gu), json.dumps(gu[0])[:260] if gu else "nothing arrived")
    ma = mark(pa)
    node("room-send", ROOM, "envelope", "high")
    ge = wait_for(pa, lambda e: e["ev"] == "msg" and e["sender"] == "dibs_bot", since=ma)
    report("3 envelope text -> A", bool(ge), json.dumps(ge[0])[:200] if ge else "")

    # 3. latency, 20 custom cards and 20 envelope cards
    for kind in ("custom", "envelope"):
        ma = mark(pa)
        node("room-latency", ROOM, "20", "400", kind)
        time.sleep(2)
        lat = []
        for e in log(pa, ma):
            if e["ev"] != "msg" or e["sender"] != "dibs_bot": continue
            c = e["content"]
            if kind == "envelope" and isinstance(c, dict) and "text" in c:
                c = json.loads(c["text"].split("]]", 1)[1])
            if isinstance(c, dict) and "sentAt" in c:
                lat.append(e["at"] - c["sentAt"])
        evidence[f"latency_{kind}"] = lat
        ok = len(lat) == 20
        report(f"3 latency {kind} (send start -> browser receive)", ok,
               f"n={len(lat)} median={statistics.median(lat) if lat else None}ms min={min(lat) if lat else None} max={max(lat) if lat else None}")

    rh = pa.evaluate("id => window.poc.roomHistory(id)", ROOM)
    report("3 open channel history query", rh["ok"], f"code={rh['code']} n={len(rh['messages'] or [])}")

    # 4. metadata
    ma = mark(pa)
    node("meta-set", ROOM, "db_state", json.dumps({"v": 2, "status": "live"}))
    gm = wait_for(pa, lambda e: e["ev"] == "meta", since=ma)
    report("4 metadata change event on A", bool(gm), json.dumps(gm[0])[:220] if gm else "none")
    md = pa.evaluate("id => window.poc.meta(id)", ROOM)
    report("4 getMetadata on A", md["ok"], f"code={md['code']} {json.dumps(md['data'])[:160]}")
    pb.evaluate("id => window.poc.exit(id)", ROOM)
    mb = mark(pb)
    eb2 = pb.evaluate("id => window.poc.enter(id, 5)", ROOM)
    time.sleep(1.5)
    md2 = pb.evaluate("id => window.poc.meta(id)", ROOM)
    evidence["reenterB_events"] = [e["ev"] for e in log(pb, mb)]
    report("4 metadata read on (re)enter B", md2["ok"] and "db_state" in (md2["data"] or {}), f"events={evidence['reenterB_events']}")

    # 7. mute / ban
    node("mute", ROOM, B, "5")
    time.sleep(0.5)
    s = pb.evaluate("id => window.poc.sendRoom(id, 'muted?')", ROOM)
    report("7 muted B send fails", not s["ok"], f"code={s['code']}")
    node("unmute", ROOM, B)
    time.sleep(0.5)
    s = pb.evaluate("id => window.poc.sendRoom(id, 'unmuted')", ROOM)
    report("7 unmuted B send works", s["ok"], f"code={s['code']}")
    mb = mark(pb)
    node("ban", ROOM, B, "5")
    time.sleep(1.5)
    s = pb.evaluate("id => window.poc.sendRoom(id, 'banned?')", ROOM)
    evidence["banEventsB"] = log(pb, mb)
    report("7 banned B send fails", not s["ok"], f"code={s['code']} events={[e['ev'] for e in evidence['banEventsB']]}")
    rj = pb.evaluate("id => window.poc.enter(id, 0)", ROOM)
    report("7 banned B re-enter refused", not rj["ok"], f"code={rj['code']}")
    node("unban", ROOM, B)
    time.sleep(0.5)
    rj = pb.evaluate("id => window.poc.enter(id, 0)", ROOM)
    report("7 unbanned B re-enter", rj["ok"], f"code={rj['code']}")

    # 8. server recall in open channel
    r = node("room-send", ROOM, "text", "normal")
    time.sleep(1)
    ma = mark(pa)
    d = node("delete", "room", ROOM, r["messageId"], "dibs_bot")
    gd = wait_for(pa, lambda e: e["ev"] == "deleted" or (e["ev"] == "msg" and e["messageType"] not in ("RC:TxtMsg", "DB:Sold")), since=ma)
    report("8 server recall -> onMessageDeleted on A", any(e["ev"] == "deleted" for e in gd), json.dumps(gd[:1])[:240] if gd else f"nothing ({d})")
    # client-sent message recalled by the server (scam-shield case)
    sb = pb.evaluate("id => window.poc.sendRoom(id, 'call me 9876543210')", ROOM)
    time.sleep(1)
    ma = mark(pa)
    d = node("delete", "room", ROOM, sb["messageId"], B)
    gd = wait_for(pa, lambda e: e["ev"] in ("deleted", "msg"), since=ma)
    report("8 server recall of B's text -> A", any(e["ev"] == "deleted" for e in gd), json.dumps(gd[:1])[:240] if gd else f"nothing ({d})")

    # 9. online status
    report("9 online status A (connected)", node("online", A).get("online") is True, json.dumps(node("online", A)))

    # 5. group: A + B (+ dibs_bot), server card, receipts, history
    node("group-create", GRP, A, B)
    ma, mb = mark(pa), mark(pb)
    node("group-send", GRP, "custom")
    ga = wait_for(pa, lambda e: e["ev"] == "msg" and e["channelId"] == GRP, since=ma)
    report("5 group card -> A", bool(ga), json.dumps(ga[0])[:240] if ga else "")
    sa = pa.evaluate("id => window.poc.sendGroup(id, 'group hi with receipt')", GRP)
    gb = wait_for(pb, lambda e: e["ev"] == "msg" and e["channelId"] == GRP and text_of(e) == "group hi with receipt", since=mb)
    ma = mark(pa)
    rr = pb.evaluate("([g, ids]) => window.poc.markRead(g, ids)", [GRP, [sa["messageId"]]])
    gr = wait_for(pa, lambda e: e["ev"] == "receipt", since=ma)
    ri = pa.evaluate("([g, ids]) => window.poc.receipts(g, ids)", [GRP, [sa["messageId"]]])
    report("5 read receipt B -> A", rr["ok"] and bool(gr), f"respond code={rr['code']} event={json.dumps(gr[:1])[:160]} info={json.dumps(ri)[:160]}")
    hb = pb.evaluate("id => window.poc.history('group', id)", GRP)
    report("5 group history on B", hb["ok"] and len(hb["messages"] or []) >= 2, f"code={hb['code']} n={len(hb['messages'] or [])} types={[x['messageType'] for x in (hb['messages'] or [])]}")

    # 6. personal alerts
    for via in ("direct", "system"):
        ma = mark(pa)
        r = node("user-send", A, via, "custom")
        g = wait_for(pa, lambda e: e["ev"] == "msg" and e["sender"] == "dibs_bot" and e["channelType"] in (1, 6), since=ma)
        evidence[f"personal_{via}"] = g[:1]
        report(f"6 personal {via} -> A", bool(g), json.dumps(g[0])[:240] if g else json.dumps(r))

    # 10. community
    c1 = node("raw", "/v4/community-channel/create", json.dumps({"userId": A, "channelId": CLUB, "name": "Dibs POC club"}))
    node("raw", "/v4/community-channel/subchannel/create", json.dumps({"channelId": CLUB, "subchannelId": "drops", "channelVisibility": 0}))
    node("raw", "/v4/community-channel/join", json.dumps({"userId": B, "channelId": CLUB}))
    time.sleep(1)
    subs = pa.evaluate("id => window.poc.subChannels(id)", CLUB)
    report("10 community getSubChannels on A", subs["ok"], f"code={subs['code']} {json.dumps(subs['subs'])[:200]}")
    mb = mark(pb)
    sc = pa.evaluate("id => window.poc.sendCommunity(id, 'drops', 'club hi')", CLUB)
    g = wait_for(pb, lambda e: e["ev"] == "msg" and e["channelType"] == 10, since=mb)
    report("10 community A -> B (subchannel drops)", sc["ok"] and bool(g), f"send code={sc['code']} recv={json.dumps(g[:1])[:200]}")

    # 12. network drop + reconnect (A offline 10 s, then 40 s; bot sends while offline)
    for secs in (10, 40):
        ma = mark(pa)
        ctxA.set_offline(True)
        time.sleep(2)
        node("room-send", ROOM, "text", "normal")  # text 'hello from dibs_bot' while offline
        sent_while_off = node("room-send", ROOM, "custom", "high")
        time.sleep(secs - 2)
        ctxA.set_offline(False)
        st = wait_for(pa, lambda e: e["ev"] == "status" and e["status"] == 0, timeout=30, since=ma)
        time.sleep(3)
        after = node("room-send", ROOM, "custom", "high")
        time.sleep(2)
        evs = log(pa, ma)
        missed = [e for e in evs if e["ev"] == "msg" and e["sender"] == "dibs_bot" and e["at"] > (st[0]["at"] if st else 0)]
        got_after = any(e["ev"] == "msg" and (e.get("content") or {}).get("sentAt", 0) >= after["sentAt"] - 2000 for e in missed)
        evidence[f"offline{secs}"] = [{k: e.get(k) for k in ("ev", "status", "code", "messageType", "channelId", "at")} for e in evs]
        report(f"12 offline {secs}s: reconnected", bool(st), f"statuses={[ (e['status'], e.get('code')) for e in evs if e['ev']=='status']}")
        report(f"12 offline {secs}s: missed messages delivered after reconnect", len(missed) >= 2, f"n={len(missed)}")
        report(f"12 offline {secs}s: still in room (new card arrives w/o re-enter)", got_after, f"events={[e['ev'] for e in evs]}")

    # 9 again: A offline after closing
    ctxA.close()
    time.sleep(3)
    report("9 online status A after close", node("online", A).get("online") is False, json.dumps(node("online", A)))
    browser.close()

for cmd in (("room-destroy", ROOM), ("group-dismiss", GRP)):
    print("cleanup", cmd, node(*cmd))
print("EVIDENCE " + json.dumps(evidence, default=str))
