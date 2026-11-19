"""Production check A: real seller sign-in (code path and link path) and a full real drop, then clean up everything.

Run:  ~/.claude/brag-scaled-venv/bin/python tests/prod/seller_real.py
No email is ever sent: codes and links come from the Supabase Admin API (generate_link), and the UI's "Send my code"
request to /auth/v1/otp is fulfilled locally with 200 {} by page.route. The verify call goes to the real Supabase.
Screenshots and results.json go to .shots/prod/seller/. Everything created is deleted in `finally` and the deletion is verified.
"""
import json, re, struct, sys, time, traceback, urllib.request, uuid, zlib
from playwright.sync_api import sync_playwright, expect, Page
from common import BASE, ROOT, SB, KEY, admin, magic_link, sql

TS = time.strftime("%m%d%H%M%S")
SHOTS = ROOT / ".shots" / "prod" / "seller"
SHOTS.mkdir(parents=True, exist_ok=True)
PRICE = 1450
UPI_MSG = "pay me direct at priya.verify@okaxis"
BLOCKED = "Phone numbers and UPI IDs can't be shared in the sale room. Use your order chat."

R = {"ts": TS, "steps": [], "errors": [], "overflow": [], "created": {"auth_users": [], "shops": [], "buyers": [], "photos": []}}
T0 = time.monotonic()
expect.set_options(timeout=30000)


def step(name, ok, detail="", t=None):
    R["steps"].append({"step": name, "ok": ok, "detail": detail, "s": round(t if t is not None else time.monotonic() - T0, 1)})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


def watch(page: Page, who: str):
    page.on("console", lambda m: m.type == "error" and R["errors"].append(f"[{who}] {page.url}: {m.text}"))
    page.on("pageerror", lambda e: R["errors"].append(f"[{who}] {page.url}: pageerror {e}"))
    page.on("response", lambda r: r.status >= 400 and "favicon" not in r.url and R["errors"].append(f"[{who}] HTTP {r.status} {r.request.method} {r.url.split('?')[0]}"))
    page.set_default_timeout(30000)
    return page


def shot(page: Page, name: str):
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
    sw = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    if sw[0] > sw[1] + 1:
        R["overflow"].append(f"{name}: scrollWidth {sw[0]} > {sw[1]}")


def png(w=64, h=64):
    raw = b"".join(b"\x00" + b"\xc8\xff\x00" * w for _ in range(h))
    ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")


def api(page: Page, method, path, body=None):
    return page.evaluate("""async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: b ? {'Content-Type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined });
        return { status: r.status, body: await r.json().catch(() => null) }; }""", [method, path, body])


def flow(p):
    browser = p.chromium.launch()
    email = f"zz-verify-{TS}@dibs-verify.test"
    # ---- A2b link path (fresh context): admin link with redirect_to /seller, as the app's signInWithOtp asks for
    s, j = admin("POST", "/admin/generate_link", {"type": "magiclink", "email": email, "redirect_to": BASE + "/seller"})
    assert s == 200, (s, j)
    R["created"]["auth_users"].append(j["id"])
    assert len(j["email_otp"]) == 8, "OTP length"
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    pg = watch(ctx.new_page(), "link")
    landed = []
    pg.on("framenavigated", lambda f: f == pg.main_frame and landed.append(f.url.split("#")[0] + ("#access_token=…" if "access_token" in f.url else "")))
    t = time.monotonic()
    pg.goto(j["action_link"], wait_until="commit")
    expect(pg.get_by_role("heading", name="Set up your shop")).to_be_visible()
    step("A2b link path: action_link -> /seller#access_token -> 'Set up your shop'", any(u.startswith(BASE + "/seller#access_token") for u in landed),
         f"{time.monotonic() - t:.1f} s; navigations: {landed}")
    shot(pg, "a2b-link-shop-form")
    ctx.close()

    # ---- A2a code path (fresh context): send intercepted, real verify
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    seller = watch(ctx.new_page(), "seller")
    sent, verify = [], []
    seller.route("**/auth/v1/otp**", lambda r: (sent.append(r.request.url.split("?")[0]), r.fulfill(status=200, content_type="application/json", body="{}")))
    seller.on("response", lambda r: "/auth/v1/verify" in r.url and verify.append(r.status))
    seller.goto(BASE + "/seller")
    # the screen opens on password accounts now; the emailed-code path sits under Sign in
    seller.get_by_role("tab", name="Sign in").click()
    seller.get_by_role("button", name="Email me a code instead").click()
    seller.get_by_label("Email").fill(email)
    seller.get_by_role("button", name="Send my code").click()
    expect(seller.get_by_label("One-time code")).to_be_visible()
    shot(seller, "a2a-code-step")
    otp = magic_link(email)["email_otp"]  # a fresh code for the same (existing) user; nothing is emailed
    t = time.monotonic()
    seller.get_by_label("One-time code").fill(otp)
    seller.get_by_role("button", name="Sign in").click()
    expect(seller.get_by_role("heading", name="Set up your shop")).to_be_visible()
    step("A2a code path: send intercepted (no email), 8-digit code verified by real Supabase -> 'Set up your shop'",
         len(sent) == 1 and verify == [200], f"otp requests intercepted={len(sent)}, verify statuses={verify}, {time.monotonic() - t:.1f} s")
    seller.unroute("**/auth/v1/otp**")

    # ---- A3 shop through the UI
    slug = f"zz-verify-{TS}"
    seller.get_by_label("Shop name").fill(f"Verify Shop {TS}")
    seller.get_by_label("Shop link").fill(slug)
    seller.get_by_label("Your name").fill("Verify Owner")
    seller.get_by_label("UPI ID").fill("verify@upi")
    seller.get_by_label("Payee name").fill("Verify")
    shot(seller, "a3-01-shop-form")
    seller.get_by_role("button", name="Create my shop").click()
    seller.wait_for_url(re.compile(r"/seller/(products|start|drops)"))  # a new shop may land on the start wizard
    me = api(seller, "GET", "/api/seller/me")["body"]["me"]
    R["created"]["shops"].append(me["shop"]["id"])
    if "/seller/products" not in seller.url: seller.goto(BASE + "/seller/products")
    step("A3 shop created through the UI", me["shop"]["slug"] == slug, f"slug {me['shop']['slug']}")

    seller.get_by_role("button", name="Add your first piece").click()
    dlg = seller.get_by_role("dialog")
    dlg.locator("input[type=file]").set_input_files(files=[{"name": "verify.png", "mimeType": "image/png", "buffer": png()}])
    try:
        expect(dlg.get_by_role("img", name="Photo 1")).to_be_visible()
        step("A3 photo upload (signed URL to Storage)", True)
    except AssertionError as e:
        step("A3 photo upload (signed URL to Storage)", False, str(e)[:200])
    dlg.get_by_label("Title").fill("Verify jhumka")
    dlg.get_by_label("Price (₹)").fill(str(PRICE))
    dlg.get_by_label("Name of option 1").fill("S")
    dlg.get_by_role("button", name="Add a size").click()
    dlg.get_by_label("Name of option 2").fill("M")
    dlg.get_by_role("button", name="Add piece").click()
    expect(seller.get_by_test_id("product-list")).to_contain_text("2 in stock · S, M")
    step("A3 product with two variants saved through the UI", True)
    shot(seller, "a3-02-products")

    seller.get_by_role("link", name="Drops").click()
    seller.get_by_role("button", name="Make your first drop").click()
    seller.get_by_label("Drop title").fill(f"Verify drop {TS}")
    seller.get_by_label("Verify jhumka").check()
    seller.get_by_role("button", name="Create drop").click()
    expect(seller.get_by_text("Your drop is ready to share")).to_be_visible()
    share = seller.get_by_test_id("share-url").first.inner_text().strip()
    step("A3 drop created; share link shown", f"/s/{slug}/d/" in share, share)
    shot(seller, "a3-03-drop-created")
    seller.get_by_role("link", name="Open the live console").click()
    seller.wait_for_url("**/seller/drops/*")
    drop_id = seller.url.rsplit("/", 1)[1]
    seller.get_by_role("button", name="Go live").click()
    expect(seller.get_by_role("button", name="Drop next")).to_be_visible()
    seller.get_by_role("button", name="Drop next").click()
    expect(seller.get_by_test_id("current-piece")).to_contain_text("Verify jhumka")
    step("A3 Go live + Drop next", True)
    shot(seller, "a3-04-console-live")

    # ---- buyer at 390x844
    bctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    buyer = watch(bctx.new_page(), "buyer")
    url = share if share.startswith("http") else "https://" + share.lstrip("/")
    buyer.goto(url)
    buyer.get_by_role("button", name="Join the room").first.click()
    d = buyer.get_by_role("dialog")
    d.get_by_label("Your name").fill("Verify Buyer")
    d.get_by_label("Phone number").fill(f"9{uuid.uuid4().int % 10**9:09d}")
    d.get_by_role("button", name="Join").click()
    expect(buyer.get_by_text("You're in, Verify B.!")).to_be_visible()
    R["created"]["buyers"] += [r["id"] for r in sql("select id from buyers where name = 'Verify Buyer' and created_at > now() - interval '30 minutes'")]
    chips = buyer.get_by_role("group", name="Pick an option").locator("button")
    if chips.count() > 1:
        chips.first.click()
    dibs = buyer.locator("button", has_text="Dibs!")
    expect(dibs).to_be_enabled()
    t = time.monotonic()
    dibs.click()
    expect(buyer.get_by_text("You got it!").first).to_be_visible()
    step("A3 buyer taps Dibs -> 'You got it!'", True, f"{time.monotonic() - t:.2f} s after the click")
    shot(buyer, "a3-05-buyer-won")
    t = time.monotonic()
    expect(seller.get_by_test_id("ledger").locator('[data-state="held"]')).to_have_count(1)
    step("A3 seller ledger shows the hold", True, f"{time.monotonic() - t:.1f} s after 'You got it!'")
    if "/o/" not in buyer.url:
        link = buyer.get_by_role("link", name=re.compile("Open order chat"))
        try:
            buyer.wait_for_url("**/o/*", timeout=8000)
        except Exception:
            link.first.click()
    buyer.wait_for_url("**/o/*")
    order_url = buyer.url
    buyer.get_by_role("button", name="I've paid").click()
    expect(buyer.get_by_text("Payment sent. Your timer is paused")).to_be_visible()
    step("A3 order room: I've paid", True)
    shot(buyer, "a3-06-buyer-paid-claim")

    seller.get_by_role("link", name="Desk").click()
    grp = seller.get_by_test_id("group-payment_claimed")
    expect(grp).to_contain_text("Verify B.")
    step("A3 desk lists the order under 'Says paid'", True)
    grp.get_by_test_id("desk-order").first.click()
    seller.get_by_role("button", name="Payment received").click()
    seller.get_by_role("button", name="Yes, mark paid").click()
    t = time.monotonic()
    expect(buyer.get_by_text("Paid · confirmed by")).to_be_visible()
    step("A3 mark received -> buyer sees 'Paid · confirmed by'", True, f"{time.monotonic() - t:.1f} s")
    seller.get_by_role("button", name="Mark shipped").first.click()
    seller.locator("button[type=submit]", has_text="Mark shipped").click()
    expect(seller.get_by_test_id("group-shipped")).to_contain_text("Verify B.")
    t = time.monotonic()
    expect(buyer.get_by_text("On its way to you.")).to_be_visible()
    step("A3 mark shipped -> buyer sees 'Shipped'", True, f"{time.monotonic() - t:.1f} s")
    shot(buyer, "a3-07-buyer-shipped")
    shot(seller, "a3-08-desk")

    # scam shield through the real webhook: buyer posts a UPI id in the room chat
    seller.goto(f"{BASE}/seller/drops/{drop_id}")
    buyer.goto(url)
    box = buyer.get_by_role("textbox", name="Message")
    expect(box).to_be_enabled()
    box.fill(UPI_MSG)
    buyer.get_by_role("button", name="Send").click()
    t = time.monotonic()
    msgs = buyer.get_by_role("list", name="Messages")
    seen_by_sender = False
    try:
        expect(msgs.get_by_text(UPI_MSG)).to_be_visible(timeout=5000)
        seen_by_sender = True
    except AssertionError:
        pass
    expect(buyer.get_by_text(BLOCKED).first).to_be_visible(timeout=30000)
    notice_s = time.monotonic() - t
    expect(msgs.get_by_text(UPI_MSG)).to_have_count(0, timeout=30000)
    gone_s = time.monotonic() - t
    seller_chat = seller.get_by_test_id("room-chat")
    expect(seller_chat.get_by_text(UPI_MSG)).to_have_count(0, timeout=15000)
    rows = sql("select rule, action from moderation_events m join drops d on d.id = m.drop_id where d.id = $1", drop_id)
    step("A3 scam shield (real Nexconn webhook): UPI message removed + notice shown", bool(rows),
         f"shown to sender first: {seen_by_sender}; notice {notice_s:.1f} s, gone from sender {gone_s:.1f} s after send; moderation rows {rows}")
    shot(buyer, "a3-09-buyer-blocked")
    shot(seller, "a3-10-console-after-block")

    # dashboard + health
    seller.goto(f"{BASE}/seller/dashboard?drop={drop_id}")
    expect(seller.get_by_test_id("dash-paid")).to_have_text("1")
    expect(seller.get_by_test_id("dash-value")).to_have_text("₹1,450")
    dash = {k: seller.get_by_test_id(f"dash-{k}").inner_text() for k in ("taps", "holds", "paid", "value", "saves", "median", "viewers") if seller.get_by_test_id(f"dash-{k}").count()}  # the viewers tile is hidden when not measured
    step("A3 dashboard numbers for the drop", True, json.dumps(dash, ensure_ascii=False))
    shot(seller, "a3-11-dashboard")
    seller.goto(f"{BASE}/health")
    h = api(seller, "GET", "/api/health")["body"]
    seller.wait_for_timeout(6000)
    status = seller.locator("h1", has_text="Status:").inner_text()
    page_ok = "OK" in status
    step("A3 /health signed in: OK and 0 failed outbox rows", page_ok and h["outbox"]["failed"] == 0,
         f"mode={h['mode']} outbox={ {k: h['outbox'][k] for k in ('pending', 'failed')} } page: {status!r}; ai={h['ai']}")
    shot(seller, "a3-12-health")

    # ---- A4 staff invite
    email2 = f"zz-verify-staff-{TS}@dibs-verify.test"
    seller.goto(f"{BASE}/seller/shop")
    seller.get_by_label("Their name").fill("Verify Staff")
    seller.get_by_label("Their email").fill(email2)
    seller.get_by_role("button", name="Invite").click()
    expect(seller.get_by_test_id("team")).to_contain_text("Verify Staff")
    shot(seller, "a4-01-invited")
    s2, j2 = admin("POST", "/admin/generate_link", {"type": "magiclink", "email": email2, "redirect_to": BASE + "/seller"})
    assert s2 == 200, (s2, j2)
    R["created"]["auth_users"].append(j2["id"])
    sctx = browser.new_context(viewport={"width": 1280, "height": 800})
    staff = watch(sctx.new_page(), "staff")
    staff.goto(j2["action_link"], wait_until="commit")
    staff.wait_for_url("**/seller/drops**")
    sme = api(staff, "GET", "/api/seller/me")["body"]["me"]
    staff.goto(f"{BASE}/seller/shop")
    expect(staff.get_by_test_id("team")).to_contain_text("Verify Staff")
    ro = staff.get_by_text("Only the owner can invite or remove team members.").count() > 0
    inputs_disabled = staff.locator("form[aria-label='Shop settings'] fieldset[disabled]").count() == 1
    shot(staff, "a4-02-staff-settings")
    staff.get_by_role("link", name="Desk").click()
    expect(staff.get_by_test_id("group-shipped")).to_contain_text("Verify B.")
    shot(staff, "a4-03-staff-desk")
    step("A4 invited staff signs in via link -> lands in the shop as staff, settings read-only, desk opens",
         sme["role"] == "staff" and sme["shop"]["id"] == me["shop"]["id"] and ro and inputs_disabled,
         f"role={sme['role']}; owner-only note shown={ro}; settings fieldset disabled={inputs_disabled}")

    # end the drop
    seller.goto(f"{BASE}/seller/drops/{drop_id}")
    seller.get_by_role("button", name="End drop").click()
    seller.get_by_role("dialog").get_by_role("button", name="End drop").click()
    expect(seller.get_by_test_id("ended-summary")).to_be_visible()
    step("A3 End drop", True)
    shot(seller, "a3-13-ended")
    R["order_url"] = order_url
    for c in (bctx, sctx, ctx):
        c.close()
    browser.close()


def cleanup():
    c = R["created"]
    left = []
    try:
        if c["shops"]:
            photos = sql("select distinct unnest(photos) as u from products where shop_id = any($1::uuid[])", c["shops"])
            paths = [re.sub(r"^.*/object/public/product-photos/", "", x["u"]) for x in photos]
            if paths:
                req = urllib.request.Request(f"{SB}/storage/v1/object/product-photos", method="DELETE", data=json.dumps({"prefixes": paths}).encode(),
                                             headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
                with urllib.request.urlopen(req) as r:
                    c["photos"] = [x.get("name") for x in json.loads(r.read())]
            sql("delete from shops where id = any($1::uuid[])", c["shops"])
        if c["buyers"]:
            sql("delete from buyers where id = any($1::uuid[])", c["buyers"])
        for u in dict.fromkeys(c["auth_users"]):
            s, _ = admin("DELETE", f"/admin/users/{u}")
            if s not in (200, 404):
                left.append(f"auth user {u}: HTTP {s}")
    except Exception as e:
        left.append(f"cleanup error: {e}")
    # verify
    if c["shops"] and sql("select id from shops where id = any($1::uuid[])", c["shops"]):
        left.append("shop rows remain")
    if c["buyers"] and sql("select id from buyers where id = any($1::uuid[])", c["buyers"]):
        left.append("buyer rows remain")
    if sql("select id from staff where email like '%@dibs-verify.test'"):
        left.append("staff rows remain")
    for u in dict.fromkeys(c["auth_users"]):
        if admin("GET", f"/admin/users/{u}")[0] != 404:
            left.append(f"auth user {u} still exists")
    R["cleanup_left"] = left
    print("cleanup:", "complete" if not left else left, json.dumps({k: len(v) for k, v in c.items()}))


def main():
    try:
        with sync_playwright() as p:
            flow(p)
    except Exception as e:
        R["steps"].append({"step": "ABORTED", "ok": False, "detail": f"{type(e).__name__}: {str(e)[:500]}"})
        traceback.print_exc()
    finally:
        cleanup()
        errs = [e for e in R["errors"] if "/auth/v1/otp" not in e]
        print(f"console/HTTP errors: {len(errs)}", *errs[:20], sep="\n  ")
        print(f"overflow: {R['overflow']}")
        (SHOTS / "results.json").write_text(json.dumps(R, indent=1, ensure_ascii=False))
    sys.exit(0 if all(s["ok"] for s in R["steps"]) and not R["cleanup_left"] else 1)


if __name__ == "__main__":
    main()
