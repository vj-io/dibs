// Shared by the sandbox tests. They run against the same database as production and the e2e suite, so they must
// not assume a free slot or a fast network.
import { fn } from "../../src/lib/server/db.ts";
import { DemoBusy, startTry, type TryRole, type TryStart } from "../../src/lib/server/sandbox.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** startTry, waiting (as the /try page does) while every demo slot is in use by someone else. */
export async function startTryRetry(role: TryRole, name?: string, maxWaitMs = 170_000): Promise<TryStart> {
  const end = Date.now() + maxWaitMs;
  for (;;) {
    try { return await startTry(role, name); } catch (e) {
      if (!(e instanceof DemoBusy) || Date.now() > end) throw e;
      await sleep(Math.min(e.retryInSeconds * 1000, 5000));
    }
  }
}

/**
 * Median round trip of one engine call from here (about 250 ms from a laptop to Mumbai, a few ms on Vercel).
 * Timing bounds in the tests are "the script's own delay + a few round trips", so they hold on any network.
 */
export async function measureRtt(): Promise<number> {
  const t: number[] = [];
  for (let i = 0; i < 5; i++) { const t0 = Date.now(); await fn("rate_add", "sandbox-test-rtt", 60); t.push(Date.now() - t0); }
  return t.sort((a, b) => a - b)[2];
}
