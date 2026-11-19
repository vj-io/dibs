"""Production check B: the judge buyer path and public pages in WebKit (iPhone 13 profile) and Chromium (Pixel 5 profile).

Run:  ~/.claude/brag-scaled-venv/bin/python tests/prod/engine_pass.py [webkit|chromium|both]
Starts one demo room per engine (well under 4 per minute). Screenshots and results.json go to .shots/prod/<engine>/.
"""
import json, re, sys, time
from playwright.sync_api import sync_playwright, expect, Page
from common import BASE, ROOT

expect.set_options(timeout=30000)
PAGES = ["/", "/how-it-works", "/impact", "/seller"]


def run(p, engine: str, device: str):
    shots = ROOT / ".shots" / "prod" / engine
    shots.mkdir(parents=True, exist_ok=True)
    R = {"engine": engine, "device": device, "steps": [], "errors": [], "overflow": [], "timings": {}}
    b = getattr(p, engine).launch()
    ctx = b.new_context(**p.devices[device])
    pg = ctx.new_page()
    pg.set_default_timeout(30000)
    pg.on("console", lambda m: m.type == "error" and R["errors"].append(f"{pg.url}: {m.text}"))
    pg.on("requestfailed", lambda r: "ERR_ABORTED" not in str(r.failure) and R["errors"].append(f"requestfailed {r.method} {r.url.split('?')[0]}: {r.failure}"))
    pg.on("pageerror", lambda e: R["errors"].append(f"{pg.url}: pageerror {e}"))
    pg.on("response", lambda r: r.status >= 400 and "favicon" not in r.url and R["errors"].append(f"HTTP {r.status} {r.url.split('?')[0]}"))

    # raw websocket frames from Nexconn: proof that a card reached this browser over the socket, not through polling
    frames = []
    def _frame(payload):
        frames.append(payload if isinstance(payload, bytes) else str(payload).encode("utf-8", "ignore"))
    pg.on("websocket", lambda ws: ws.on("framereceived", _frame))

    def step(name, ok, detail=""):
        R["steps"].append({"step": name, "ok": ok, "detail": detail})
        print(f"[{engine}] " + ("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)

    def shot(name, full=True):
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(shots / f"{name}.png"), full_page=full)
        sw = pg.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
        if sw[0] > sw[1] + 1:
            R["overflow"].append(f"{name}: scrollWidth {sw[0]} > {sw[1]}")
        return sw

    try:
        for path in PAGES:
            n = len(R["errors"])
            pg.goto(BASE + path, wait_until="networkidle")
            sw = shot("page" + path.replace("/", "-") if path != "/" else "page-home")
            step(f"{path} renders, no console errors, no sideways scroll", len(R["errors"]) == n and sw[0] <= sw[1] + 1,
                 f"width {sw[1]}, scrollWidth {sw[0]}, title {pg.title()!r}")

        pg.goto(BASE + "/try")
        t0 = time.monotonic()
        pg.get_by_role("button", name="Be a buyer").click()
        pg.wait_for_url("**/s/**", timeout=60000)
        expect(pg.get_by_text("Demo room · 40 🤖 demo buyers · nothing here is real money")).to_be_visible()
        chips = pg.get_by_role("group", name="Pick an option").locator("button")
        expect(chips.first).to_be_visible(timeout=60000)
        pg.wait_for_timeout(1200)
        sold_out = chips.filter(has_text="sold out")
        if sold_out.count():
            sold_out.first.click()
        elif chips.count() > 1:
            chips.first.click()
        dibs = pg.locator("button", has_text="Dibs!")
        expect(dibs).to_be_enabled()
        t_click = time.monotonic()
        dibs.click()
        expect(pg.get_by_text("on the waitlist").or_(pg.get_by_text("You got it!")).first).to_be_visible(timeout=10000)
        wait_copy = pg.locator("#dibs-status").inner_text().strip()
        outright = "You got it!" in wait_copy
        step("piece 1: tap Dibs -> waitlist copy", not outright, wait_copy[:120])
        shot("try-01-after-tap", full=False)
        expect(pg.locator("#dibs-status").get_by_text("You got it!" if outright else "It's yours! The buyer ahead didn't pay.").first).to_be_visible(timeout=120000)
        R["timings"]["click_to_its_yours_s"] = round(time.monotonic() - t_click, 1)
        step("promoted: 'It's yours!'", True, f"{R['timings']['click_to_its_yours_s']} s from the Dibs click")
        shot("try-02-its-yours", full=False)
        pg.wait_for_url("**/o/*", timeout=30000)
        step("order room opens", True, f"{time.monotonic() - t_click:.1f} s from the click")
        t = time.monotonic()
        pg.get_by_role("button", name="I've paid").click()
        expect(pg.get_by_text("Paid · confirmed by")).to_be_visible()
        R["timings"]["ive_paid_to_paid_s"] = round(time.monotonic() - t, 1)
        step("I've paid -> Paid · confirmed by", True, f"{R['timings']['ive_paid_to_paid_s']} s")
        import re as _re
        got = sorted({m.decode() for f in frames if b"ord_" in f for m in _re.findall(rb"DB:[A-Za-z]+", f)})
        step("order-room cards arrive over the Nexconn socket (bot is not a member of the room)", any(t in got for t in ("DB:Order", "DB:Pay")), f"card types seen in order-room frames: {got}")
        shot("try-03-paid", full=False)
        pg.wait_for_url("**/s/**", timeout=30000)
        step("back to the room", True)
        expect(pg.get_by_role("heading", name=re.compile(r"^#2 "))).to_be_visible(timeout=90000)
        chips = pg.get_by_role("group", name="Pick an option").locator("button")
        if chips.count() > 1:
            chips.first.click()
        expect(dibs).to_be_enabled()
        t = time.monotonic()
        dibs.click()
        expect(pg.get_by_text("on the waitlist").or_(pg.get_by_text("You got it!")).first).to_be_visible(timeout=10000)
        txt = pg.locator("#dibs-status").inner_text().strip()
        step("piece 2: quick tap wins", "You got it!" in txt, f"{txt[:80]!r} {time.monotonic() - t:.2f} s after the click")
        R["timings"]["try_total_s"] = round(time.monotonic() - t0, 1)
        shot("try-04-piece-2", full=False)
    except Exception as e:
        step("ABORTED", False, f"{type(e).__name__}: {str(e)[:400]}")
        pg.screenshot(path=str(shots / "zz-failure.png"))
    finally:
        ctx.close()
        b.close()
    (shots / "results.json").write_text(json.dumps(R, indent=1, ensure_ascii=False))
    print(f"[{engine}] errors: {len(R['errors'])}", *R["errors"][:15], sep="\n  ")
    print(f"[{engine}] overflow: {R['overflow']}  timings: {R['timings']}")
    return all(s["ok"] for s in R["steps"]) and not R["errors"] and not R["overflow"]


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    ok = True
    with sync_playwright() as p:
        if which in ("webkit", "both"):
            ok &= run(p, "webkit", "iPhone 13")
        if which in ("chromium", "both"):
            ok &= run(p, "chromium", "Pixel 5")
    sys.exit(0 if ok else 1)
