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
SHOTS = ROOT / ".shots" / "buyer"
W, H = 360, 740
PHONE = dict(viewport={"width": W, "height": H}, is_mobile=True, has_touch=True, device_scale_factor=1,
             user_agent="Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")
results: dict = {"timings": {}, "shots": [], "checks": []}
errors: list[str] = []


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
    page.on("console", lambda m: m.type == "error" and errors.append(f"[{who}] console: {m.text}"))
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
    await expect(page.get_by_role("heading", name=title)).to_be_visible(timeout=15000)


async def dibs_button(page: Page):
    return page.locator("button", has_text="Dibs!").first


async def join(page: Page, name: str, phone: str):
    await page.get_by_role("button", name="Join the room").click()
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
        await expect(a.get_by_text("Waiting room")).to_be_visible()
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
        for attempt in range(3):  # a just-created room can refuse the first send until its channel exists on the bus
            await a.get_by_role("button", name="Send").click()
            try:
                await expect(mine).to_be_visible(timeout=4000)
                break
            except AssertionError:
                results["checks"].append({"name": "chat send retried", "ok": True, "detail": await a.get_by_role("alert").all_inner_texts()})
                await a.wait_for_timeout(2500)
        await expect(mine).to_be_visible()
        await expect(b.get_by_text("Hi! Is the M still there? 😍")).to_be_visible(timeout=8000)
        check("chat message reaches the other buyer", True)
        await shot(b, "03-waiting-room-joined-chat")

        # piece 1 live, both race for the single unit
        await s.post(f"/api/drops/{drop_id}/live")
        await s.post(f"/api/drops/{drop_id}/next")
        for pg in (a, b):
            await item_live(pg, "Jhumka earrings")
            await expect(pg.locator("button", has_text="Dibs!")).to_be_enabled(timeout=10000)
        await shot(a, "04-live-piece")
        await asyncio.gather((await dibs_button(a)).click(), (await dibs_button(b)).click())
        won_a = a.locator("#dibs-result").get_by_text("You got it! Pay within")
        won_b = b.locator("#dibs-result").get_by_text("You got it! Pay within")
        for _ in range(50):
            if await won_a.is_visible() or await won_b.is_visible():
                break
            await asyncio.sleep(0.1)
        winner, loser = (a, b) if await won_a.is_visible() else (b, a)
        await expect(loser.locator("#dibs-result").get_by_text("You're #1 on the waitlist. We'll tell you the moment it's yours.")).to_be_visible(timeout=5000)
        check("race: one winner, one waitlisted", True, "winner=" + ("A" if winner is a else "B"))
        await winner.get_by_role("button", name="Stay here").click()  # stay for the room view; the order chat would open by itself
        for pg in (a, b):
            await expect(pg.get_by_role("list", name="Sold and back in play").locator("li").first).to_contain_text("Sold to", timeout=5000)
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
        await shot(winner, "07-order-held-phone")
        lap = await browser.new_context(storage_state=await (ca if winner is a else cb).storage_state(), viewport={"width": 1280, "height": 900})
        lp = watch(await lap.new_page(), "laptop")
        await lp.goto(f"{BASE}/o/{order_id}")
        await expect(lp.get_by_role("img", name="UPI QR code: pay ₹1,450 to Meera Jewels")).to_be_visible()
        await shot(lp, "08-order-held-laptop-qr")
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
        await expect(sp.get_by_role("button", name="Mark shipped")).to_be_visible()
        await staff_ctx.close()
        await expect(winner.get_by_text("Paid · confirmed by")).to_be_visible(timeout=12000)
        check("buyer sees Paid after staff confirms", True)
        await shot(winner, "11-order-paid")

        # piece 2: B wins S, A waitlisted; B releases; A is promoted
        await s.post(f"/api/drops/{drop_id}/next")
        await winner.goto(url)
        for pg in (a, b):
            await item_live(pg, "Stone ring")
            await pg.get_by_role("group", name="Pick an option").get_by_role("button", name=re.compile(r"^S\s")).click()
            await expect(pg.locator("button", has_text="Dibs!")).to_be_enabled(timeout=10000)
        await (await dibs_button(b)).click()
        await expect(b.locator("#dibs-result").get_by_text("You got it! Pay within")).to_be_visible()
        await (await dibs_button(a)).click()
        await expect(a.locator("#dibs-result").get_by_text("You're #1 on the waitlist.")).to_be_visible()
        await b.get_by_role("button", name="Stay here").first.click()  # stay in the room instead of the auto-open
        await expect(b.get_by_text("My status")).to_be_visible()
        await shot(b, "12-my-status-hold")
        await b.get_by_role("button", name="Release").first.click()
        await b.get_by_role("dialog").get_by_role("button", name="Release it").click()
        await expect(a.locator("#main").get_by_text("It's yours! The buyer ahead didn't pay.").first).to_be_visible(timeout=10000)
        check("waitlisted buyer promoted after release", True)
        await shot(a, "13-promoted")
        await a.wait_for_url("**/o/*", timeout=10000)

        # piece 3: offline -> Reconnecting… + Dibs disabled -> back online recovers
        await s.post(f"/api/drops/{drop_id}/next")
        await item_live(b, "Silver anklet")
        await expect(b.locator("button", has_text="Dibs!")).to_be_enabled(timeout=10000)
        await cb.set_offline(True)
        await expect(b.get_by_text("Reconnecting…").first).to_be_visible(timeout=5000)
        await expect(b.locator("button", has_text="Dibs!")).to_be_disabled()
        await shot(b, "14-reconnecting")
        await cb.set_offline(False)
        await expect(b.locator("button", has_text="Dibs!")).to_be_enabled(timeout=15000)
        await expect(b.get_by_role("status").filter(has_text="Reconnecting…")).to_have_count(0)
        await (await dibs_button(b)).click()
        await expect(b.locator("#dibs-result").get_by_text("You got it! Pay within")).to_be_visible()
        check("offline: Reconnecting… and Dibs disabled; online again: claim works", True)

        # end of drop
        await b.get_by_role("button", name="Stay here").first.click()
        await s.post(f"/api/drops/{drop_id}/end")
        await expect(b.get_by_text("That's a wrap")).to_be_visible(timeout=10000)
        await shot(b, "15-drop-ended")

        # /me and not-found pages
        await a.goto(f"{BASE}/me")
        await expect(a.get_by_text("Held for you")).to_be_visible()
        await shot(a, "16-me")
        await a.goto(f"{BASE}/s/{slug}/d/ZZZZZZ")
        await expect(a.get_by_text("This sale room doesn't exist")).to_be_visible()
        await shot(a, "17-room-not-found")
        await a.goto(f"{BASE}/o/{uuid.uuid4()}")
        await expect(a.get_by_text("We can't find this order")).to_be_visible()
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
    await pg.get_by_role("button", name="Be a buyer").click()
    await pg.wait_for_url("**/s/**", timeout=20000)
    await expect(pg.get_by_text("Demo room · 40 🤖 demo buyers · nothing here is real money")).to_be_visible()
    await shot(pg, "21-judge-room")
    dibs = pg.locator("button", has_text="Dibs!")
    await expect(dibs).to_be_enabled(timeout=30000)
    if await pg.get_by_role("group", name="Pick an option").locator("button").count() > 1:
        await pg.get_by_role("group", name="Pick an option").locator("button").first.click()
    await dibs.click()
    await expect(pg.get_by_text("on the waitlist").or_(pg.get_by_text("You got it!")).first).to_be_visible(timeout=5000)
    await shot(pg, "22-judge-after-tap")
    await expect(pg.locator("#main").get_by_text("It's yours!").first).to_be_visible(timeout=120000)
    secs = round(time.monotonic() - t0, 1)
    results["timings"]["judge_seconds_to_its_yours"] = secs
    check("judge path reaches It's yours!", True, f"{secs} s")
    await shot(pg, "23-judge-its-yours")
    await pg.wait_for_url("**/o/*", timeout=15000)
    await expect(pg.get_by_text("Demo: tap I've paid").first).to_be_visible()
    await shot(pg, "24-judge-order")
    await pg.get_by_role("button", name="I've paid").click()
    await expect(pg.get_by_text("Paid · confirmed by")).to_be_visible(timeout=20000)
    results["timings"]["judge_seconds_to_paid"] = round(time.monotonic() - t0, 1)
    await shot(pg, "25-judge-paid")
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
    print(json.dumps(results["timings"]))


if __name__ == "__main__":
    asyncio.run(main())
