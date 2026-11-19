"""Shop club screens, end to end, against the shared dev server (REALTIME_MODE=mock, DIBS_TEST_LOGIN=1), phone size.
Run:  ~/.claude/brag-scaled-venv/bin/python tests/e2e/club_flow.py [base]
Seller (API) makes a shop, a piece and a scheduled drop -> anonymous visitor reads the club (Drops, Reviews, Chat locked)
-> buyer joins from the page -> chats (a phone number is refused on screen) -> seller posts on /seller/club and the
buyer's Drops tab updates live (no reload) -> paid order -> buyer writes a review in the UI -> seller hides it with a
reason and removes the member. Screenshots: .shots/club/. Fails on console errors, 5xx or sideways scroll.
The shop and buyers are deleted at the end."""
import json, random, subprocess, sys, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
SHOTS = ROOT / ".shots" / "club"
SHOTS.mkdir(parents=True, exist_ok=True)
W, H = 360, 740
errors, overflow, proved, shop_ids, buyer_ids = [], [], [], [], []


def ok(msg):
    proved.append(msg)
    print("  ok:", msg, flush=True)


def shot(page, name):
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
    sw = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    if sw[0] > sw[1] + 1:
        overflow.append(f"{name}: scrollWidth {sw[0]} > {sw[1]}")


def post(ctx, path, body=None, status=200):
    r = ctx.request.post(BASE + path, data=json.dumps(body or {}), headers={"Content-Type": "application/json"}, timeout=90000)
    assert r.status == status, f"{path} -> {r.status} {r.text()[:300]}"
    return r.json()


def watch(page):
    # the refused chat line answers 422 on purpose; Chromium logs every 4xx resource as a console error
    page.on("console", lambda m: m.type == "error" and "status of 422" not in m.text and errors.append(f"{page.url}: {m.text}"))
    page.on("response", lambda r: r.status >= 500 and errors.append(f"HTTP {r.status} {r.request.method} {r.url}"))
    page.on("pageerror", lambda e: errors.append(f"{page.url}: pageerror {e}"))
    page.set_default_timeout(60000)


def cleanup():
    js = """
      import postgres from "postgres";
      const sql = postgres(process.env.DATABASE_URL_SESSION, { ssl: "require", max: 1 });
      const [shops, buyers] = JSON.parse(process.argv[1]);
      if (shops.length) { await sql`delete from outbox where channel_id in (select nexconn_club_id from shops where id in ${sql(shops)})`;
                          await sql`delete from shops where id in ${sql(shops)}`; }
      if (buyers.length) await sql`delete from buyers where id in ${sql(buyers)}`;
      await sql.end();"""
    subprocess.run(["node", "--env-file=.env.local", "--input-type=module", "-e", js, json.dumps([shop_ids, buyer_ids])], cwd=ROOT, check=True)


def flow(pw):
    browser = pw.chromium.launch()
    expect.set_options(timeout=60000)
    # seller: shop, piece, drop an hour out (API; the seller screens have their own e2e)
    sctx = browser.new_context(viewport={"width": W, "height": H})
    post(sctx, "/api/seller/session", {"testEmail": f"club-{uuid.uuid4().hex[:8]}@dibs.test"})
    slug = f"club-{uuid.uuid4().hex[:6]}"
    shop = post(sctx, "/api/shops", {"name": "Meera Jewels", "slug": slug, "upiId": "meera@okaxis", "payeeName": "Meera", "holdMinutes": 10})
    shop_ids.append(shop["shopId"])
    prod = post(sctx, "/api/products", {"title": "Silver jhumka", "pricePaise": 145000, "photos": ["/demo/jhumka.jpg"], "variants": [{"key": "one", "label": "One size", "qty": 2}]})
    import datetime
    starts = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).isoformat()
    drop = post(sctx, "/api/drops", {"title": "Diwali jhumkas", "startsAt": starts, "productIds": [prod["product"]["id"]]})

    # anonymous visitor: read-only club
    actx = browser.new_context(viewport={"width": W, "height": H})
    ap = actx.new_page(); watch(ap)
    ap.goto(f"{BASE}/s/{slug}/club")
    expect(ap.get_by_role("heading", name="Meera Jewels")).to_be_visible()
    expect(ap.get_by_test_id("club-members")).to_have_text("0 members")
    expect(ap.get_by_test_id("club-next-drop")).to_contain_text("Diwali jhumkas")
    shot(ap, "01-anon-drops")
    ap.get_by_role("tab", name="Chat").click()
    expect(ap.get_by_text("Chat is for members")).to_be_visible()
    shot(ap, "02-anon-chat-locked")
    ok("anonymous: drops readable, chat locked")

    # buyer: joins the sale (name + phone sheet) and the club from the page
    bctx = browser.new_context(viewport={"width": W, "height": H})
    bp = bctx.new_page(); watch(bp)
    bp.goto(f"{BASE}/s/{slug}/club")
    bp.get_by_role("button", name="Join the club").first.click()
    bp.get_by_label("Your name").fill("Priya Sharma")
    bp.get_by_label("Phone number").fill(f"9{random.randint(100000000, 999999999)}")
    bp.get_by_role("button", name="Join", exact=True).click()
    expect(bp.get_by_text("Joined")).to_be_visible()
    expect(bp.get_by_test_id("club-members")).to_have_text("1 member")
    me = bctx.request.get(BASE + "/api/buyer/me").json()["buyer"]
    buyer_ids.append(me["id"])
    # the auto post for the scheduled drop
    expect(bp.get_by_role("list", name="Announcements")).to_contain_text("New drop: Diwali jhumkas")
    shot(bp, "03-joined-drops")
    ok("buyer joined from the club page (sale join sheet, then club)")

    bp.get_by_role("tab", name="Chat").click()
    box = bp.get_by_role("textbox", name="Message")
    box.fill("Will the jhumkas come in gold too?")
    bp.get_by_role("button", name="Send").click()
    expect(bp.get_by_role("list", name="Messages")).to_contain_text("Will the jhumkas come in gold too?")
    bp.wait_for_timeout(2200)
    box.fill("call me 9876543210")
    bp.get_by_role("button", name="Send").click()
    expect(bp.get_by_role("alert").filter(has_text="can't be shared in the club")).to_be_visible()
    expect(bp.get_by_role("list", name="Messages")).not_to_contain_text("9876543210")
    shot(bp, "04-chat-blocked")
    ok("chat: sent; a phone number refused on screen and never posted")

    # seller posts to #drops in the UI; the buyer's Drops tab updates without a reload
    bp.get_by_role("tab", name="Drops").click()
    sp = sctx.new_page(); watch(sp)
    sp.goto(f"{BASE}/seller/club")
    expect(sp.get_by_test_id("club-members")).to_have_text("1 member")
    expect(sp.get_by_role("list", name="Messages")).to_contain_text("come in gold")
    sp.get_by_label("Announcement", exact=True).fill("Gold versions are coming next week!")
    sp.get_by_role("button", name="Post", exact=True).click()
    expect(sp.get_by_role("list", name="Recent announcements")).to_contain_text("Gold versions")
    shot(sp, "05-seller-club")
    expect(bp.get_by_role("list", name="Announcements")).to_contain_text("Gold versions are coming next week!", timeout=10000)
    shot(bp, "06-buyer-live-announcement")
    ok("seller announcement reached the buyer's open page live (mock bus SSE, no reload)")

    # paid order -> review in the UI
    post(sctx, f"/api/drops/{drop['dropId']}/live")
    st = bctx.request.get(f"{BASE}/api/drops/{drop['dropId']}/state").json()
    post(sctx, f"/api/drops/{drop['dropId']}/next")
    claim = post(bctx, "/api/claims", {"itemId": st["items"][0]["itemId"], "variantKey": "one"})
    assert claim["result"] == "won", claim
    post(bctx, f"/api/orders/{claim['orderId']}/paid-claim", {"utr": "123456789012"})
    post(sctx, f"/api/orders/{claim['orderId']}/confirm", {"received": True})
    bp.reload()
    expect(bp.get_by_test_id("club-next-drop")).to_contain_text("LIVE")
    shot(bp, "07-drop-live")
    bp.get_by_role("tab", name="Reviews").click()
    bp.get_by_role("button", name="Write a review").click()
    bp.get_by_role("button", name="4 stars").click()
    bp.get_by_label("What was it like? (optional)").fill("Lovely finish, arrived in 3 days.")
    shot(bp, "08-review-form")
    bp.get_by_role("button", name="Post review").click()
    expect(bp.get_by_role("list", name="Reviews")).to_contain_text("Lovely finish")
    expect(bp.get_by_role("img", name="4 of 5 stars")).to_be_visible()
    expect(bp.get_by_role("button", name="Write a review")).to_have_count(0)
    shot(bp, "09-review-posted")
    ok("review written in the UI for the paid order; button gone afterwards")

    # seller hides it with a reason, then removes the member
    sp.reload()
    sp.get_by_role("button", name="Hide review").click()
    sp.get_by_label("Why hide it?").fill("Test review")
    sp.get_by_role("button", name="Hide", exact=True).click()
    expect(sp.get_by_text("Hidden: Test review")).to_be_visible()
    sp.get_by_role("button", name="Remove Priya S.").click()
    sp.get_by_role("button", name="Confirm remove").click()
    expect(sp.get_by_test_id("club-members")).to_have_text("0 members")
    shot(sp, "10-seller-hidden-removed")
    bp.reload()
    expect(bp.get_by_role("button", name="Join the club").first).to_be_visible()
    bp.get_by_role("tab", name="Reviews").click()
    expect(bp.get_by_text("No reviews yet")).to_be_visible()
    shot(bp, "11-buyer-after-moderation")
    ok("hidden review gone for buyers; removed member sees Join again")
    browser.close()


with sync_playwright() as pw:
    try:
        flow(pw)
    finally:
        cleanup()
print(json.dumps({"proved": len(proved), "errors": errors[:10], "overflow": overflow}, indent=1))
sys.exit(1 if errors or overflow else 0)
