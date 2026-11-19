"""Buyer screens end to end, at 360x740 on a phone profile, against the shared dev server (mock realtime, test login).

Run:  ~/.claude/brag-scaled-venv/bin/python tests/e2e/buyer_flow.py            (BASE=http://localhost:3100 by default)
      ... buyer_flow.py judge     only the /try judge path

Scenarios: two buyers race for one unit; winner pays, staff confirms; release -> promotion; room chat; offline -> Reconnecting
-> back; not-found pages; /me; judge path /try -> "It's yours!". Screenshots go to .shots/buyer/. Every page is checked for
console errors and horizontal overflow (against the configured 360 px, not innerWidth, which mobile emulation widens).
The test shop is a normal (non-sandbox) shop, deleted with its buyers at the end (finally block).
"""
import asyncio
import json
import os
import random
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

from playwright.async_api import Page, async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get("BASE", "http://localhost:3100")
SHOTS = ROOT / ".shots" / "buyer3"
W, H = 360, 640
# Room cards normally land in about a second. On the shared dev DB another drainer (the deployed app's cron) can claim a
# mock-mode outbox row first, so the card never reaches the local bus and the room catches up through its 30 s HTTP poll.
CARD_WAIT = 40_000
expect.set_options(timeout=15_000)  # the shared dev server is slow under other builders' load; mutations took > 5 s at times
PHONE = dict(viewport={"width": W, "height": H}, is_mobile=True, has_touch=True, device_scale_factor=1,
             user_agent="Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")
results: dict = {"timings": {}, "shots": [], "checks": []}
errors: list[str] = []
expected_404: list[str] = []
env_errors: list[str] = []


def admin(js: str) -> None:
    """Runs a snippet with `sql` (postgres, session URL from .env.local) for setup/cleanup only."""
    script = ("import postgres from 'postgres'; const sql = postgres(process.env.DATABASE_URL_SESSION, { ssl: 'require', max: 1, onnotice() {} });"
              f"try {{ {js} }} finally {{ await sql.end({{ timeout: 5 }}); }}")
    subprocess.run(["node", "--env-file=.env.local", "--input-type=module", "-e", script], cwd=ROOT, check=True)


def check(name: str, ok: bool, detail: str = "") -> None:
    results["checks"].append({"name": name, "ok": ok, "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)
    if not ok:
        raise AssertionError(f"{name}: {detail}")


def watch(page: Page, who: str) -> Page:
    def on_console(m):
        url = (m.location or {}).get("url", "")
        if m.type != "error" or any(x in url for x in expected_404):  # the deliberate not-found visits
            return
        if "ERR_INTERNET_DISCONNECTED" in m.text:  # only during the deliberate set_offline step (the browser's own SSE retry)
            return
        if "/api/mock/send?history=" in url and "403" in m.text:
            # the order group was never created on the local mock bus: its SYS:EnsureGroup outbox row was claimed by
            # another drainer on the shared DB (see CARD_WAIT). Reported separately, not hidden.
            env_errors.append(f"[{who}] {m.text} ({url})")
            return
        errors.append(f"[{who}] console: {m.text} ({url})")
    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append(f"[{who}] pageerror: {e}"))
    return page


async def shot(page: Page, name: str, full: bool = True) -> None:
    path = SHOTS / f"{name}.png"
    await page.wait_for_timeout(500)  # let pop-in animations land
    await page.screenshot(path=str(path), full_page=full)
    results["shots"].append(path.name)
    # no horizontal overflow: compare with the configured width (mobile emulation widens innerWidth to fit overflow)
    vw = page.viewport_size["width"]
    over = await page.evaluate("""(vw) => {
      const d = document.documentElement, w = Math.max(d.scrollWidth, document.body.scrollWidth);
      const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && !e.closest('ol.overflow-x-auto, .snap-row, dialog:not([open])'); })
        .slice(0, 3).map(e => e.tagName + '.' + String(e.className).slice(0, 60));
      return { over: w - vw, client: d.clientWidth, wide };
    }""", vw)
    check(f"no horizontal overflow: {name}", over["over"] <= 0 and over["client"] == vw, json.dumps(over))


# ---------------------------------------------------------------- seller over HTTP
class Seller:
    def __init__(self, req):
        self.r = req

    async def post(self, path: str, data=None):
        res = await self.r.post(path, data=data if data is not None else {})
        body = await res.json()
        assert res.ok, f"{path} -> {res.status} {body}"
        return body


async def make_seller(p):
    req = await p.request.new_context(base_url=BASE)
    s = Seller(req)
    tag = uuid.uuid4().hex[:8]
    await s.post("/api/seller/session", {"testEmail": f"t-{tag}@dibs.test"})
    shop = await s.post("/api/shops", {"name": "Meera Jewels", "slug": f"t-{tag}", "upiId": "meera@upi", "payeeName": "Meera Jewels",
                                       "holdMinutes": 10, "supportWhatsapp": "9876543210", "faq": ["Ships in 3 days"], "ownerName": "Asha Rao"})
    return s, shop["shopId"], f"t-{tag}"


async def product(s: Seller, title: str, photo: str, variants):
    r = await s.post("/api/products", {"title": title, "pricePaise": 145000, "note": "925 silver, adjustable", "photos": [photo],
                                        "variants": variants})
    return r["product"]["id"]


async def item_live(page: Page, title: str):
    try:
        await expect(page.get_by_role("heading", name=title)).to_be_visible(timeout=CARD_WAIT)
    except AssertionError:
        print("DEBUG state:", await page.evaluate("location.pathname"), await page.evaluate(
            "async () => { const m = location.pathname.split('/'); const r = await fetch(`/api/drops/by-code/${m[2]}/${m[4]}`); const j = await r.json(); return JSON.stringify({v: j.state.version, status: j.state.status, live: j.state.live && j.state.live.title}); }"))
        print("DEBUG cards:", await page.evaluate("JSON.stringify(window.__dibs && window.__dibs.cards)"))
        raise


def ready(page: Page, timeout: int = 10000):
    """Dibs! can claim: it is never `disabled` (it stays focusable); `aria-disabled` says when it can't."""
    return expect(page.locator("button", has_text="Dibs!")).not_to_have_attribute("aria-disabled", "true", timeout=timeout)


async def tab_to(page: Page, js_test: str, limit: int = 60) -> None:
    """Keyboard only: press Tab until the focused element passes js_test (a JS expression over `el`)."""
    for _ in range(limit):
        await page.keyboard.press("Tab")
        if await page.evaluate(f"(() => {{ const el = document.activeElement; return !!el && ({js_test}); }})()"):
            return
    raise AssertionError(f"Tab never reached: {js_test}")


async def in_view(page: Page, loc, name: str) -> None:
    box = await loc.bounding_box()
    vh = page.viewport_size["height"]
    check(f"in view without scrolling: {name}", box is not None and box["y"] >= 0 and box["y"] + box["height"] <= vh + 1, json.dumps(box))


async def dibs_button(page: Page):
    return page.locator("button", has_text="Dibs!").first


async def join(page: Page, name: str, phone: str):
    try:
        await page.get_by_role("button", name="Join the room").click()
    except Exception:
        await page.screenshot(path=str(SHOTS / "debug-join.png"))
        print("DEBUG join page:", page.url, (await page.inner_text("body"))[:300].replace("\n", " | "))
        raise
    dlg = page.get_by_role("dialog")
    await dlg.get_by_label("Your name").fill(name)
    await dlg.get_by_label("Phone number").fill(phone)
    return dlg


# ---------------------------------------------------------------- the main buyer scenarios
async def buyer_scenarios(p, browser):
    s, shop_id, slug = await make_seller(p)
    phones = [f"9{random.randint(10**8, 10**9 - 1)}" for _ in range(2)]
    try:
        p1 = await product(s, "Jhumka earrings", "/demo/jhumka-earrings.svg", [{"key": "one", "label": "One size", "qty": 1}])
        p2 = await product(s, "Stone ring", "/demo/stone-ring.svg", [{"key": "s", "label": "S", "qty": 1}, {"key": "m", "label": "M", "qty": 2}])
        p3 = await product(s, "Silver anklet", "/demo/silver-anklet.svg", [{"key": "one", "label": "One size", "qty": 3}])
        starts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 180))
        d = await s.post("/api/drops", {"title": "Diwali Edit", "startsAt": starts, "productIds": [p1, p2, p3]})
        drop_id, code = d["dropId"], d["code"]
        url = f"{BASE}/s/{slug}/d/{code}"

        ca = await browser.new_context(**PHONE)
        cb = await browser.new_context(**PHONE)
        a = watch(await ca.new_page(), "A")
        b = watch(await cb.new_page(), "B")

        # waiting room + join
        await a.goto(url)
        await expect(a.get_by_text("Waiting room")).to_be_visible(timeout=CARD_WAIT)
        await expect(a.locator("button", has_text="Dibs!")).to_have_count(0)  # no piece yet
        await shot(a, "01-waiting-room-anonymous")
        dlg = await join(a, "Priya Sharma", "12345")
        await dlg.get_by_role("button", name="Join").click()
        await expect(dlg.get_by_text("Enter a 10-digit Indian mobile number.")).to_be_visible()
        await shot(a, "02-join-sheet-invalid-phone", full=False)
        await dlg.get_by_label("Phone number").fill(phones[0])
        await dlg.get_by_role("button", name="Join").click()
        await expect(a.get_by_text("You're in, Priya S.!")).to_be_visible()
        await b.goto(url)
        dlg = await join(b, "Rohan Singh", phones[1])
        await dlg.get_by_role("button", name="Join").click()
        await expect(b.get_by_text("You're in, Rohan S.!")).to_be_visible()

        # chat: A says hi, B sees it
        await a.get_by_role("textbox", name="Message").fill("Hi! Is the M still there? 😍")
        mine = a.get_by_role("list", name="Messages").get_by_text("Hi! Is the M still there? 😍")
        for attempt in range(12):  # a just-created room can refuse the first send until its channel exists on the bus
            await a.get_by_role("button", name="Send").click()
            try:
                await expect(mine).to_be_visible(timeout=2500)
                break
            except AssertionError:
                results["checks"].append({"name": "chat send retried", "ok": True, "detail": await a.get_by_role("alert").all_inner_texts()})
                await a.wait_for_timeout(1500)
        if not await mine.is_visible() and await a.get_by_text("The room's chat isn't open yet").count():
            # SYS:EnsureRoom shows "sent" in the outbox but the local mock bus never got the room: another drainer on the
            # shared DB claimed the row. Not an app defect; reported, and the chat check is skipped for this run.
            env_errors.append("room chat check skipped: mock room never created locally (outbox row drained elsewhere)")
            print("ENV room chat check skipped (outbox row drained by another server)")
        else:
            await expect(mine).to_be_visible()
            await expect(b.get_by_text("Hi! Is the M still there? 😍")).to_be_visible(timeout=8000)
            check("chat message reaches the other buyer", True)
        await shot(b, "03-waiting-room-joined-chat")

        # piece 1 live, both race for the single unit
        await s.post(f"/api/drops/{drop_id}/live")
        await s.post(f"/api/drops/{drop_id}/next")
        for pg in (a, b):
            await item_live(pg, "Jhumka earrings")
            await ready(pg)
        # the sticky bar keeps Dibs! on screen wherever the buyer has scrolled (A is down at the chat input)
        box = await a.locator("button", has_text="Dibs!").bounding_box()
        check("Dibs! visible while scrolled down to the chat", box is not None and 0 <= box["y"] and box["y"] + box["height"] <= H, json.dumps(box))
        for pg in (a, b):
            await pg.evaluate("scrollTo(0, 0)")
        await shot(a, "04-live-piece-360x640", full=False)
        for pg in (a, b):
            bar = await pg.get_by_test_id("action-bar").bounding_box()
            title = await pg.get_by_role("heading", name="Jhumka earrings").bounding_box()
            check("title and price clear of the action bar at 360x640", bool(bar and title) and title["y"] + title["height"] <= bar["y"], json.dumps({"title": title, "bar": bar}))
        for pg in (a, b):  # from the top, everything needed to claim is on screen without scrolling at 360x640
            for loc in (pg.get_by_role("heading", name="Jhumka earrings"), pg.locator("button", has_text="Dibs!"), pg.locator("#dibs-status")):
                box = await loc.bounding_box()
                check("above the fold at 360x640", box is not None and box["y"] >= 0 and box["y"] + box["height"] <= H, json.dumps(box))
        for name, vp in (("390x844", {"width": 390, "height": 844}), ("1440x900", {"width": 1440, "height": 900})):
            extra = await browser.new_context(storage_state=await ca.storage_state(), viewport=vp, is_mobile=vp["width"] < 800, has_touch=vp["width"] < 800)
            ep = watch(await extra.new_page(), name)
            await ep.goto(url)
            await item_live(ep, "Jhumka earrings")
            await ready(ep)
            await shot(ep, f"04-live-piece-{name}", full=False)
            await in_view(ep, ep.locator("button", has_text="Dibs!"), f"Dibs! at {name}")
            await extra.close()
        await asyncio.gather((await dibs_button(a)).click(), (await dibs_button(b)).click())
        won_a = a.locator("#dibs-status").get_by_text("You got it! Pay within")
        won_b = b.locator("#dibs-status").get_by_text("You got it! Pay within")
        for _ in range(200):  # a claim took up to 8 s on the shared server
            if await won_a.is_visible() or await won_b.is_visible():
                break
            await asyncio.sleep(0.1)
        winner, loser = (a, b) if await won_a.is_visible() else (b, a)
        await expect(loser.locator("#dibs-status").get_by_text("You're #1 on the waitlist. We'll tell you the moment it's yours.")).to_be_visible(timeout=20000)
        check("race: one winner, one waitlisted", True, "winner=" + ("A" if winner is a else "B"))
        focus = await loser.evaluate("document.activeElement && document.activeElement.textContent")
        check("focus stays on Dibs! after a tap", "Dibs!" in (focus or ""), repr(focus))
        await winner.get_by_role("button", name="Stay here").click()  # stay for the room view; the order chat would open by itself
        for pg in (a, b):
            await expect(pg.get_by_role("list", name="Sold and back in play").locator("li").first).to_contain_text("Sold to", timeout=CARD_WAIT)
        check("both see the Sold to ticker line", True)
        taps = [await pg.evaluate("window.__dibs") for pg in (a, b)]
        results["timings"]["tap_to_result_ms"] = [t["lastTapMs"] for t in taps]
        await asyncio.gather(shot(winner, "05-won"), shot(loser, "06-waitlisted"))

        # winner's order chat opens by itself; pay; staff confirms
        await winner.get_by_role("link", name="Open order chat to pay").click()
        await winner.wait_for_url("**/o/*", timeout=10000)
        order_id = winner.url.rsplit("/", 1)[1]
        await expect(winner.get_by_text("Pay ₹1,450 to Meera Jewels (meera@upi). Pay only here, never to a number in chat.")).to_be_visible()
        await expect(winner.get_by_role("link", name="Pay ₹1,450 with UPI")).to_be_visible()  # phone: UPI app button
        await winner.evaluate("scrollTo(0, 0)")
        await in_view(winner, winner.get_by_role("button", name="I've paid"), "I've paid at 360x640")
        await shot(winner, "07-order-held-360x640", full=False)
        lap = await browser.new_context(storage_state=await (ca if winner is a else cb).storage_state(), viewport={"width": 1440, "height": 900})
        lp = watch(await lap.new_page(), "laptop")
        await lp.goto(f"{BASE}/o/{order_id}")
        await expect(lp.get_by_role("img", name="UPI QR code: pay ₹1,450 to Meera Jewels")).to_be_visible()
        await in_view(lp, lp.get_by_role("button", name="I've paid"), "I've paid at 1440x900")
        await shot(lp, "08-order-held-1440x900", full=False)
        await lap.close()
        await winner.get_by_label("UTR number (optional)").fill("123456789012")
        await winner.get_by_role("button", name="I've paid").click()
        await expect(winner.get_by_text("Payment sent. Your timer is paused")).to_be_visible()
        await expect(winner.get_by_text("Timer paused")).to_be_visible()
        await shot(winner, "09-order-payment-claimed")
        # staff view of the same order (seller cookie)
        staff_ctx = await browser.new_context(storage_state=await s.r.storage_state(), **PHONE)
        sp = watch(await staff_ctx.new_page(), "staff")
        await sp.goto(f"{BASE}/o/{order_id}?as=staff")
        await expect(sp.get_by_role("button", name="Payment received")).to_be_visible()
        await expect(sp.get_by_text(f"+91 {phones[0] if winner is a else phones[1]}")).to_be_visible()
        await shot(sp, "10-order-staff-view")
        await sp.get_by_role("button", name="Payment received").click()
        await sp.get_by_role("dialog").get_by_role("button", name="Yes, mark paid").click()
        await expect(sp.get_by_role("button", name="Mark shipped")).to_be_visible(timeout=CARD_WAIT)
        await staff_ctx.close()
        await expect(winner.get_by_text("Paid · confirmed by")).to_be_visible(timeout=CARD_WAIT)
        check("buyer sees Paid after staff confirms", True)
        await shot(winner, "11-order-paid")

        # piece 2: B wins S, A waitlisted; B releases; A is promoted
        await s.post(f"/api/drops/{drop_id}/next")
        await winner.goto(url)
        for pg in (a, b):
            await item_live(pg, "Stone ring")
            await pg.get_by_role("group", name="Pick an option").get_by_role("button", name=re.compile(r"^S\s")).click()
            await ready(pg)
        await (await dibs_button(b)).click()
        await expect(b.locator("#dibs-status").get_by_text("You got it! Pay within")).to_be_visible()
        await (await dibs_button(a)).click()
        await expect(a.locator("#dibs-status").get_by_text("You're #1 on the waitlist.")).to_be_visible()
        # nothing else is live, so B's order room opens by itself; B releases the hold from there
        await b.wait_for_url("**/o/*?from=won", timeout=CARD_WAIT)
        await expect(b.get_by_text("You got it!").first).to_be_visible(timeout=CARD_WAIT)
        await shot(b, "12-order-after-win", full=False)
        await b.get_by_role("button", name="Release hold").click()
        await b.get_by_role("dialog").get_by_role("button", name="Release it").click()
        await expect(a.locator("#main").get_by_text("It's yours! The buyer ahead didn't pay.").first).to_be_visible(timeout=CARD_WAIT)
        check("waitlisted buyer promoted after release", True)
        await shot(a, "13-promoted", full=False)
        try:  # opens by itself when nothing else is live and my status knows the hold; otherwise the status line links to it
            await a.wait_for_url("**/o/*?from=promoted", timeout=8000)
        except Exception:
            await a.locator("#dibs-status").get_by_role("link", name="Open order").click()
            await a.wait_for_url("**/o/*?from=promoted", timeout=CARD_WAIT)
        await expect(a.get_by_text("It's yours! The buyer ahead didn't pay.").first).to_be_visible()
        await shot(a, "13b-order-after-promotion", full=False)

        # piece 3: offline -> Reconnecting… + Dibs disabled -> back online recovers
        await s.post(f"/api/drops/{drop_id}/next")
        await b.goto(url)
        await item_live(b, "Silver anklet")
        await ready(b)
        await cb.set_offline(True)
        await expect(b.get_by_text("Reconnecting…").first).to_be_visible(timeout=5000)
        await expect(b.locator("button", has_text="Dibs!")).to_have_attribute("aria-disabled", "true")
        await shot(b, "14-reconnecting")
        await cb.set_offline(False)
        await ready(b, 15000)
        await expect(b.get_by_role("status").filter(has_text="Reconnecting…")).to_have_count(0)
        await (await dibs_button(b)).click()
        await expect(b.locator("#dibs-status").get_by_text("You got it! Pay within")).to_be_visible()
        check("offline: Reconnecting… and Dibs disabled; online again: claim works", True)

        # end of drop
        await b.get_by_role("button", name="Stay here").first.click()
        await s.post(f"/api/drops/{drop_id}/end")
        await expect(b.get_by_text("That's a wrap")).to_be_visible(timeout=CARD_WAIT)
        await shot(b, "15-drop-ended")

        # /me and not-found pages
        await a.goto(f"{BASE}/me")
        await expect(a.get_by_role("heading", name="Held for you")).to_be_visible()
        await shot(a, "16-me")
        missing_order = str(uuid.uuid4())
        expected_404.extend(["/ZZZZZZ", missing_order])
        await a.goto(f"{BASE}/s/{slug}/d/ZZZZZZ")
        # the server answers with the site's 404 page; if its 3 s lookup is slow, the room's own not-found screen
        await expect(a.get_by_text("This sale room doesn't exist").or_(a.get_by_text("Someone already called dibs on this page.")).first).to_be_visible()
        check("missing room page has an h1", await a.locator("h1").count() >= 1)
        await shot(a, "17-room-not-found")
        await a.goto(f"{BASE}/o/{missing_order}")
        await expect(a.get_by_role("heading", name="We can't find this order")).to_have_count(1)
        await expect(a.get_by_text("We can't find this order").last).to_be_visible()
        await shot(a, "18-order-not-found")
        anon = watch(await (await browser.new_context(**PHONE)).new_page(), "anon")
        await anon.goto(f"{BASE}/me")
        await expect(anon.get_by_text("Nothing here yet")).to_be_visible()
        await shot(anon, "19-me-empty")
        await ca.close(); await cb.close()
    finally:
        admin(f"""await sql`delete from shops where id = ${{{json.dumps(shop_id)}}}`;
                  await sql`delete from buyers where phone in ${{sql({json.dumps(phones)})}} and not is_bot`;""")
        await s.r.dispose()


# ---------------------------------------------------------------- judge path
async def judge(browser):
    ctx = await browser.new_context(**PHONE)
    pg = watch(await ctx.new_page(), "judge")
    await pg.goto(f"{BASE}/try")
    await shot(pg, "20-try")
    t0 = time.monotonic()
    # the whole judge path below is keyboard only: Tab to a control, Enter to use it
    await tab_to(pg, "el.textContent.includes('Be a buyer')")
    await pg.keyboard.press("Enter")
    await pg.wait_for_url("**/s/**", timeout=20000)
    await expect(pg.get_by_text("Demo room · 40 🤖 demo buyers · nothing here is real money")).to_be_visible()
    await shot(pg, "21-judge-room")
    dibs = pg.locator("button", has_text="Dibs!")
    chips = pg.get_by_role("group", name="Pick an option").locator("button")
    await expect(chips.first).to_be_visible(timeout=CARD_WAIT + 20000)
    await pg.wait_for_timeout(1200)  # let the bots' first taps land, like a person reading the card
    if await chips.count() > 1:  # a judge usually lands on a sold-out size: the waitlist path
        want = "sold out" if await chips.filter(has_text="sold out").count() else ""
        await tab_to(pg, f"el.closest('[aria-label=\"Pick an option\"]') && el.textContent.includes('{want}')")
        await pg.keyboard.press("Enter")
    await ready(pg)
    results["timings"]["judge_seconds_to_piece_1"] = round(time.monotonic() - t0, 1)
    await tab_to(pg, "el.textContent.includes('Dibs!')")
    await pg.keyboard.press("Enter")
    await expect(pg.get_by_text("on the waitlist").or_(pg.get_by_text("You got it!")).first).to_be_visible(timeout=20000)
    await shot(pg, "22-judge-after-tap")
    outright = await pg.locator("#dibs-status").get_by_text("You got it!").count() > 0
    results["timings"]["judge_path"] = "won outright" if outright else "waitlisted, then promoted"
    await expect(pg.locator("#dibs-status").get_by_text("You got it!" if outright else "It's yours! The buyer ahead didn't pay.").first).to_be_visible(timeout=120000)
    secs = round(time.monotonic() - t0, 1)
    results["timings"]["judge_seconds_to_its_yours"] = secs
    check("judge path reaches It's yours!", True, f"{secs} s")
    await shot(pg, "23-judge-its-yours")
    try:  # auto-opens only when no other piece is live and my status knows the hold
        await pg.wait_for_url("**/o/*", timeout=8000)
    except Exception:
        results["timings"]["judge_order_opened_by"] = "link (auto-open held back)"
        await pg.locator("#main").get_by_role("link", name=re.compile("Open order")).first.click()
        await pg.wait_for_url("**/o/*", timeout=CARD_WAIT)
    await expect(pg.get_by_text("Demo: tap I've paid").first).to_be_visible(timeout=CARD_WAIT)
    await shot(pg, "24-judge-order")
    await pg.evaluate("scrollTo(0, 0)")
    await in_view(pg, pg.get_by_role("button", name="I've paid"), "judge I've paid at 360x640")
    await tab_to(pg, "el.textContent.includes(\"I've paid\")")
    await pg.keyboard.press("Enter")
    await expect(pg.get_by_text("Paid · confirmed by")).to_be_visible(timeout=20000)
    results["timings"]["judge_seconds_to_paid"] = round(time.monotonic() - t0, 1)
    await expect(pg.get_by_role("link", name="Back to the room for piece 2")).to_be_visible()
    await shot(pg, "25-judge-paid", full=False)
    await pg.wait_for_url("**/s/**", timeout=10000)  # auto-return after 4 s
    check("paid sandbox order returns to the room by itself", True)
    await expect(pg.get_by_role("heading", name=re.compile(r"^#2 "))).to_be_visible(timeout=60000)
    results["timings"]["judge_seconds_to_piece_2"] = round(time.monotonic() - t0, 1)
    await pg.evaluate("scrollTo(0, 0)")
    await shot(pg, "26-judge-piece-2", full=False)
    bar = await pg.get_by_test_id("action-bar").bounding_box()
    title = await pg.get_by_role("heading", name=re.compile(r"^#2 ")).bounding_box()
    check("judge room at 360x640: piece title clear of the action bar, bar on screen",
          bool(bar and title) and title["y"] >= 0 and title["y"] + title["height"] <= bar["y"] and bar["y"] + bar["height"] <= H + 1,
          json.dumps({"title": title, "bar": bar}))
    await ctx.close()


async def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else "all"
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            if only in ("all", "buyer"):
                await buyer_scenarios(p, browser)
            if only in ("all", "judge"):
                await judge(browser)
        finally:
            await browser.close()
    check("console errors = 0", not errors, "; ".join(errors[:8]))
    if env_errors:
        print(f"ENV (shared-DB outbox, not app errors): {len(env_errors)} console 403s on mock group history; first: {env_errors[0]}")
    print(json.dumps(results["timings"]))


if __name__ == "__main__":
    asyncio.run(main())
