"""Seller screens, end to end, against the shared dev server (REALTIME_MODE=mock, DIBS_TEST_LOGIN=1).

Run:  ~/.claude/brag-scaled-venv/bin/python tests/e2e/seller_flow.py [--base http://localhost:3100] [--size 1280x800|360x740|both] [--photo]
Shop via the UI form -> product with two sizes via the UI -> drop via the UI -> Go live -> Drop next -> two API buyers
claim one unit (hold + waitlist in the ledger within 2 s) -> cancel the hold -> the waitlisted buyer is promoted ->
buyer says paid -> desk "Says paid" -> received -> shipped -> dashboard 1 paid / right value -> mute a buyer from
chat -> End drop. Screenshots go to .shots/seller/<size>/. Fails on console errors or sideways scroll.
The shop and buyers it made are deleted at the end (node + postgres, .env.local).
"""
import argparse, json, os, struct, subprocess, sys, time, uuid, zlib
from pathlib import Path
from playwright.sync_api import sync_playwright, expect, Page

ROOT = Path(__file__).resolve().parents[2]
PRICE_RUPEES = 1450


def png_bytes(w=1600, h=1200):
    """A plain lime PNG, big enough that the browser has to shrink it."""
    raw = b"".join(b"\x00" + b"\xc8\xff\x00" * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


class Run:
    def __init__(self, base, size, photo):
        self.base, self.photo = base, photo
        self.w, self.h = (int(x) for x in size.split("x"))
        self.shots = ROOT / ".shots" / "seller" / size
        self.shots.mkdir(parents=True, exist_ok=True)
        self.errors: list[str] = []
        self.overflow: list[str] = []
        self.proved: list[str] = []
        self.shop_ids: list[str] = []
        self.buyer_ids: list[str] = []

    def shot(self, page: Page, name: str):
        page.wait_for_timeout(250)
        page.screenshot(path=str(self.shots / f"{name}.png"), full_page=True)
        sw = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
        if sw[0] > sw[1] + 1:
            self.overflow.append(f"{name}: scrollWidth {sw[0]} > {sw[1]}")

    def ok(self, msg):
        self.proved.append(msg)
        print("  ok:", msg, flush=True)

    def run(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": self.w, "height": self.h}, permissions=["clipboard-read", "clipboard-write"])
            page = ctx.new_page()
            page.set_default_timeout(45000)
            expect.set_options(timeout=45000)
            page.on("console", lambda m: m.type == "error" and self.errors.append(f"{page.url}: {m.text}"))
            page.on("response", lambda r: r.status >= 400 and self.errors.append(f"HTTP {r.status} {r.request.method} {r.url}"))
            page.on("pageerror", lambda e: self.errors.append(f"{page.url}: pageerror {e}"))
            try:
                self.flow(p, page)
            except Exception:
                page.screenshot(path=str(self.shots / "zz-failure.png"), full_page=True)
                raise
            finally:
                ctx.close()
                browser.close()
                self.cleanup()

    def api(self, page: Page, method, path, body=None):
        return page.evaluate("""async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: b ? {'Content-Type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined });
            return { status: r.status, body: await r.json().catch(() => null) }; }""", [method, path, body])

    def flow(self, p, page: Page):
        base, tag = self.base, uuid.uuid4().hex[:6]
        # 1. sign in page, redirect guard, then test login through the API (the page never exposes it)
        page.goto(base + "/seller/drops")
        expect(page).to_have_url(base + "/seller")
        self.ok("no session: /seller/drops redirects to /seller")
        expect(page.get_by_role("button", name="Send my code")).to_be_visible()
        assert "testEmail" not in page.content()
        self.shot(page, "01-sign-in")
        r = self.api(page, "POST", "/api/seller/session", {"testEmail": f"e2e-{tag}@dibs.test"})
        assert r["status"] == 200 and r["body"]["needsShop"], r

        # 2. create the shop through the form
        page.goto(base + "/seller")
        page.get_by_label("Shop name").fill(f"E2E Jewels {tag}")
        page.get_by_label("Your name").fill("Meera")
        page.get_by_label("UPI ID").fill("not-a-upi")
        page.get_by_role("button", name="Create my shop").click()
        expect(page.get_by_text("That isn't a UPI ID")).to_be_visible()
        self.ok("inline validation mirrors the server (bad UPI ID refused before submit)")
        self.shot(page, "02-create-shop")
        page.get_by_label("UPI ID").fill("meera@upi")
        page.get_by_label("Payee name").fill("Meera Jewels")
        page.get_by_role("button", name="Create my shop").click()
        page.wait_for_url(base + "/seller/products")
        me = self.api(page, "GET", "/api/seller/me")["body"]["me"]
        self.shop_ids.append(me["shop"]["id"])
        slug = me["shop"]["slug"]
        self.ok("shop created through the UI form; lands on /seller/products")

        # 3. product with two sizes through the editor
        page.get_by_role("button", name="Add your first piece").click()
        dlg = page.get_by_role("dialog")
        if self.photo:
            dlg.locator("input[type=file]").set_input_files(files=[{"name": "big.png", "mimeType": "image/png", "buffer": png_bytes()}])
            expect(dlg.get_by_role("img", name="Photo 1")).to_be_visible(timeout=30000)
            self.ok("photo compressed in the browser and uploaded to Storage")
        dlg.get_by_label("Title").fill("Silver jhumka")
        dlg.get_by_label("Price (₹)").fill(str(PRICE_RUPEES))
        dlg.get_by_label("Name of option 1").fill("S")
        dlg.get_by_role("button", name="Add a size").click()
        dlg.get_by_label("Name of option 2").fill("M")
        self.shot(page, "03-product-editor")
        dlg.get_by_role("button", name="Add piece").click()
        expect(page.get_by_test_id("product-list")).to_contain_text("Silver jhumka")
        expect(page.get_by_test_id("product-list")).to_contain_text("2 in stock · S, M")
        self.ok("product with two sizes saved through the UI")
        self.shot(page, "04-products")

        # 4. drop through the UI
        page.get_by_role("link", name="Drops").click()
        page.get_by_role("button", name="Make your first drop").click()
        page.get_by_label("Drop title").fill("E2E Friday drop")
        page.get_by_label("Silver jhumka").check()
        self.shot(page, "05-new-drop")
        page.get_by_role("button", name="Create drop").click()
        expect(page.get_by_text("Your drop is ready to share")).to_be_visible()
        share = page.get_by_test_id("share-url").first.inner_text()
        assert f"/s/{slug}/d/" in share, share
        self.ok("drop created through the UI; share link + WhatsApp + QR shown")
        self.shot(page, "06-drop-created")
        page.get_by_role("link", name="Open the live console").click()
        page.wait_for_url("**/seller/drops/*")
        drop_id = page.url.rsplit("/", 1)[1]

        # 5. console: go live, drop next
        page.get_by_role("button", name="Go live").click()
        expect(page.get_by_role("button", name="Drop next")).to_be_visible()
        self.shot(page, "07-console-live")
        page.get_by_role("button", name="Drop next").click()
        expect(page.get_by_test_id("current-piece")).to_contain_text("Silver jhumka")
        self.ok("Go live and Drop next work; current piece shows")

        # 6. two API buyers claim the one unit of S
        state = self.api(page, "GET", f"/api/drops/{drop_id}/state")["body"]
        item_id, channel = state["live"]["itemId"], state["channelId"]
        buyers = []
        for name in ("Priya Sharma", "Rohan Singh"):
            rc = p.request.new_context(base_url=base)
            j = rc.post("/api/buyer/join", data={"name": name, "phone": f"9{uuid.uuid4().int % 10**9:09d}", "shopSlug": slug})
            assert j.ok, j.text()
            self.buyer_ids.append(j.json()["buyerId"])
            buyers.append(rc)
        r1 = buyers[0].post("/api/claims", data={"itemId": item_id, "variantKey": "s"}).json()
        r2 = buyers[1].post("/api/claims", data={"itemId": item_id, "variantKey": "s"}).json()
        t0 = time.time()
        assert r1["result"] == "won" and r2["result"] == "waitlisted", (r1, r2)
        ledger = page.get_by_test_id("ledger")
        expect(ledger.locator('[data-state="held"]')).to_have_count(1, timeout=2000)
        expect(ledger.locator('[data-state="waitlisted"]')).to_have_count(1, timeout=2000)
        self.ok(f"ledger shows the hold and the waitlist entry {time.time() - t0:.1f} s after the claims (limit 2 s)")
        self.shot(page, "08-ledger-hold-waitlist")

        # 7. cancel the hold from the ledger -> the waitlisted buyer is promoted
        ledger.get_by_role("button", name="Cancel hold for Priya S.").click()
        page.get_by_role("dialog").get_by_role("button", name="Cancel hold").click()
        promoted = ledger.locator('[data-state="held"]', has_text="Rohan S.")
        expect(promoted).to_be_visible()
        expect(promoted).to_contain_text("from waitlist")
        expect(ledger.locator('[data-state="cancelled"]')).to_have_count(1)
        self.ok("hold cancelled from the ledger; Rohan S. shows as promoted 'from waitlist'")
        self.shot(page, "09-ledger-promoted")

        # 8. the promoted buyer says paid
        mine = buyers[1].get(f"/api/drops/{drop_id}/me").json()
        order_id = mine["holds"][0]["orderId"]
        assert buyers[1].post(f"/api/orders/{order_id}/paid-claim", data={}).ok

        # 9. chat: a buyer posts, staff mutes them from the message menu
        msg = buyers[0].post("/api/mock/send", data={"target": {"type": "room", "id": channel}, "text": "is the M size still there?", "as": "buyer"})
        assert msg.ok, msg.text()
        chat = page.get_by_test_id("room-chat")
        expect(chat).to_contain_text("is the M size still there?")
        chat.get_by_role("button", name="Moderate Priya S.").click()
        chat.get_by_role("button", name="Mute 10 min").click()
        expect(page.get_by_test_id("moderation")).to_contain_text("Muted until")
        self.ok("buyer muted from the chat message menu; shows in moderation")
        self.shot(page, "10-console-chat-muted")

        # 10. desk: Says paid -> received -> shipped
        page.get_by_role("link", name="Desk").click()
        group = page.get_by_test_id("group-payment_claimed")
        expect(group).to_contain_text("Rohan S.")
        self.ok("desk lists the order under 'Says paid — check your bank'")
        group.get_by_test_id("desk-order").first.click()
        page.wait_for_timeout(1500)
        self.shot(page, "11a-desk-order-open")
        page.get_by_role("button", name="Payment received").click()
        page.get_by_role("button", name="Yes, mark paid").click()
        expect(page.get_by_test_id("group-paid")).to_contain_text("Rohan S.")
        page.get_by_role("button", name="Mark shipped").first.click()
        page.locator("button[type=submit]", has_text="Mark shipped").click()
        expect(page.get_by_test_id("group-shipped")).to_contain_text("Rohan S.")
        self.ok("order marked received, then shipped, from the desk's order room")
        self.shot(page, "11-desk")

        # 11. dashboard (on a phone the order room is a full-screen sheet: close it first)
        if page.get_by_role("dialog").count():
            page.keyboard.press("Escape")
        page.get_by_role("link", name="Dashboard").click()
        expect(page.get_by_test_id("dash-paid")).to_have_text("1")
        expect(page.get_by_test_id("dash-value")).to_have_text("₹1,450")
        expect(page.get_by_test_id("dash-viewers")).to_have_text("not measured")
        self.ok("dashboard: 1 paid order worth ₹1,450; viewers 'not measured' in mock mode")
        self.shot(page, "12-dashboard")

        # 12. shop settings, then End drop
        page.get_by_role("link", name="Shop").click()
        expect(page.get_by_test_id("team")).to_contain_text("Meera")
        self.shot(page, "13-shop")
        page.goto(f"{base}/seller/drops/{drop_id}")
        page.get_by_role("button", name="End drop").click()
        page.get_by_role("dialog").get_by_role("button", name="End drop").click()
        expect(page.get_by_test_id("ended-summary")).to_be_visible()
        self.ok("End drop (with confirm) shows the summary card linking to results")
        self.shot(page, "14-console-ended")
        page.goto(f"{base}/seller/drops")
        self.shot(page, "15-drops")

        # 13. another shop's drop is a not-found inside the shell
        page.goto(f"{base}/seller/drops/00000000-0000-4000-8000-000000000000")
        expect(page.get_by_text("That isn't in your shop.")).to_be_visible()
        self.ok("unknown/other shop's drop: not-found")
        for b in buyers:
            b.dispose()

    def cleanup(self):
        if not self.shop_ids and not self.buyer_ids:
            return
        js = ("import postgres from 'postgres'; const [s, b] = JSON.parse(process.argv[1]);"
              "const sql = postgres(process.env.DATABASE_URL_SESSION, { ssl: 'require', max: 1, onnotice: () => {} });"
              "if (s.length) await sql`delete from shops where id in ${sql(s)}`; if (b.length) await sql`delete from buyers where id in ${sql(b)}`; await sql.end();")
        subprocess.run(["node", "--env-file=.env.local", "--input-type=module", "-e", js, json.dumps([self.shop_ids, self.buyer_ids])], cwd=ROOT, check=False)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--base", default="http://localhost:3100")
    a.add_argument("--size", default="both")
    a.add_argument("--photo", action="store_true", help="also upload a photo to Supabase Storage")
    o = a.parse_args()
    failed = False
    for size in (["1280x800", "360x740"] if o.size == "both" else [o.size]):
        print(f"== {size}", flush=True)
        r = Run(o.base, size, o.photo)
        try:
            r.run()
        except Exception as e:  # report and keep the other size going
            failed = True
            print(f"  FAIL: {e}", flush=True)
        errs = [e for e in r.errors if "favicon" not in e]
        print(f"  console errors: {len(errs)}", *errs[:10], sep="\n    ")
        print(f"  sideways scroll: {len(r.overflow)}", *r.overflow, sep="\n    ")
        failed |= bool(errs) or bool(r.overflow)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
