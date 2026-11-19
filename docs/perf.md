# Claim burst performance

Goal: a burst of taps answers fast, with no weaker guarantees (no piece sold twice; waitlist order = commit order).
All numbers below were measured on 2026-11-19 against the shared Supabase database (Postgres 17, `ap-south-1`, small
instance: `max_connections` 60, PostgREST pool 10) from one laptop about 40 ms away from it, unless the line says otherwise.
Scripts: `scripts/perf-engine.ts` (engine, PostgREST, drain), `scripts/perf-stage.ts` (tests a migration in a scratch
schema without replacing the live functions), `scripts/load-sim.ts` (end to end through the deployed API).

## 1. Before: where the time goes

### (a) Inside Postgres, per call

`perf-engine.ts db`: 300 sequential `claim_dibs` on one session, one variant with 2 units, waitlist cap 200;
`EXPLAIN ANALYZE` execution time (network and commit excluded). Two runs:

| Outcome | n | median ms | sum ms (run 1 / run 2) |
|---|---|---|---|
| won | 2 | 10.2 / 16.4 | 63 / 129 |
| waitlisted | 200 | 2.3 / 2.3 | 780 / 527 |
| waitlist_full | 98 | 0.7 / 0.7 | 67 / 96 |

Writes for those 300 taps: 216 outbox rows, 204 audit rows, 204 `drops.version` bumps. A waitlisted tap writes 4 rows
(claim, `DB:Stock` outbox row, audit row, drop version).

`perf-engine.ts plans`: `EXPLAIN (ANALYZE, BUFFERS)` of each statement on the path, at the state a burst leaves
(3 runs each; the first run in a session pays for planning the SQL-language helpers):

| Statement | ms (run 1 / 2 / 3) | Access path |
|---|---|---|
| item → drop | 0.036 / 0.026 / 0.031 | drop_items_pkey |
| drop lock (`for no key update`) | 0.047 / 0.044 / 0.046 | drops_pkey |
| variant | 0.072 / 0.049 / 0.051 | drop_items_pkey, product_variants (product_id, key) |
| stock lock | 0.044 / 0.046 / 0.053 | item_stock_pkey |
| buyer | 0.045 / 0.033 / 0.032 | buyers_pkey |
| bans | 0.045 / 0.038 / 0.038 | seq scan on a table of a few rows (PK (shop_id, buyer_id, kind) exists; planner prefers the scan) |
| existing claim of this buyer on the item | 0.042 / 0.043 / 0.032 | claims_one_active |
| buyer's holds in the drop | 0.043 / 0.038 / 0.038 | claims_buyer |
| waitlist count | 0.145 / 0.142 / 0.145 | claims_queue (index only) |
| `_hold_secs` / `_is_try` | 2.691 / 0.492 / 0.440 | |
| insert claim | 0.774 / 0.281 / 0.261 | |
| `_bump` | 0.203 / 0.277 / 0.312 | |
| `_stock_card` | 0.779 / 0.733 / 0.730 | |
| `_room_stock` (card + outbox insert) | 2.643 / 0.979 / 2.336 | |
| `_audit` | 0.267 / 0.266 / 0.331 | |
| `drop_state` | 24.35 / 1.67 / 1.70 | |
| `sweep_drop` (nothing due, lock-free path) | 9.40 / 0.55 / 0.52 | |
| `my_status` | 26.49 / 1.75 / 2.41 | |

Every lookup on the hot path already uses an index; no index is missing. The cost is in the helpers that build and
write the stock card, and in SQL-language helpers being planned on every call.

### (b) Lock queueing

Every writer of a drop takes the drop row first, so taps on one drop run one at a time. Through PostgREST (below), 300
taps took 2.2 s wall with the first answer at 0.49 s: about 5.8 ms of serial time per tap, against 2.5 to 3 ms of work
inside Postgres. The rest (about 3 ms per tap) is the commit (WAL flush, `synchronous_commit = on`) and PostgREST's
transaction round trips, all while the lock is held. Floor for 300 taps on one drop ≈ 300 × 5.8 ms ≈ 1.7 s.

### (c) PostgREST

`perf-engine.ts rest` (all from the laptop, fetch with keep-alive):

| Burst | Result |
|---|---|
| 1 trivial RPC (`_mmss`), sequential | median 73 ms (round trip to the pooler 40 ms) |
| 300 trivial RPCs at once | median 2.06 s, max 2.29 s (second run: median 4.1 s); at most 1–2 PostgREST backends busy |
| 300 `api_claim` at once | wall 2.2 s; won 0.49 s, waitlisted median 1.20 s, waitlist_full median 1.97 s; 10 backends busy, 9 of them waiting on the drop lock |
| 300 `api_claim` + 100 `drop_state` at once | claims median 2.19 s; state median 2.00 s, max 3.0 s |

Two findings. From one machine, 300 new TLS connections alone cost as much as the whole claim burst, so latencies
measured from a laptop cannot isolate the server: the claim response now carries `serverMs` (below). And PostgREST's
pool is 10 connections; during a burst 9 of them sit waiting for the drop lock, so every other request (viewers' state,
`/me`, judge mode) waits in the same queue as the claims: state requests were as slow as claims.

### (d) Vercel

Two production bursts on 2026-11-19 at 06:33 and 06:36 UTC (`load-sim.ts`, 300 taps in 0.5 s + 100 viewers) failed:
152 and 281 of 300 taps hit the 30 s client timeout (results appended to `docs/load-sim-results.md`; the invariants
that matter held: 2 held of 2 units, no double sell). Server logs for those requests show `rpc api_claim` aborted by its
20 s timeout, PostgREST `HTTP 503`, and `canceling statement due to statement timeout` (the `authenticator` role has
`statement_timeout = 8s`, `lock_timeout = 8s`). The same 300-tap burst sent straight to PostgREST from the laptop
minutes earlier finished in 2.2 s, so the collapse is on the path Vercel adds. What the database showed at the time:

- 6 pooler (Supavisor) server connections stuck `active / ClientRead` for 59–74 s inside
  `insert into health_events ...`: the fire-and-forget row `nexconn.ts` writes for every Nexconn call, sent by an
  instance that was frozen mid-statement. The session pool is 15 connections (`EMAXCONNSESSION ... pool_size: 15`).
- Background load on the same small instance: `pg_stat_statements` since 2026-11-18 16:56 UTC shows 17,300 bot
  schedule polls, 7,127 webhook nonce checks, 13,713 drain lease queries and 71 PostgREST schema-cache reloads
  (`pg_timezone_names` up to 7.8 s). `count(*)` over a 1,000,000-row `generate_series` took 266–349 ms; at 07:08 UTC,
  while the DB tests ran, the same query took 7,859 ms once and single `claim_dibs` calls ran for over a minute with
  no lock wait: the instance's CPU, not the engine, was the limit at that moment. A larger compute size for the
  database is the one change that would move every number in this file; it is the lead's call (cost).
- `rpc()` (`src/lib/server/db.ts`) retries a request that timed out after 20 s. The first request may still be in
  PostgREST's queue, so each retry adds to the queue it is waiting in.

Per-request server durations: `vercel logs` returns at most 50 lines per query and the MCP log tool 100, so a 300-tap
distribution could not be collected from logs. The route now returns `serverMs` (arrival to response, measured in the
route) and `load-sim.ts` reports its distribution and the client-minus-server difference per tap.

### (e) Work after the response

Each won or waitlisted tap schedules `afterWrite` → `drainOutbox`. `perf-engine.ts drain`: 300 concurrent drains
(one process, pool of 3, fake sender) over the 210 rows one burst leaves: 298 of the 300 drains sent nothing, and the
one that held the room channel made 416 sender calls (210 cards + 206 metadata writes), one after another. In
production each is a Nexconn HTTP call plus a `health_events` insert, so the last stock card of a burst reached the
room after hundreds of sequential calls, and every `DB:Stock` card makes each connected buyer refetch `/me`
(`SaleRoom.tsx`, 300 ms debounce), which again queues at PostgREST behind the claims.

## 2. Changes, biggest measured win first

| Change | Where | Measured effect |
|---|---|---|
| Consecutive `DB:Stock` cards for the same item collapse to the newest in each leased run (the older ones are settled as sent) | `outbox.ts` | same 210-row burst: sender calls 416 → 32 (cards 210 → 18, metadata 206 → 14); in the DB test, 62 stock rows → 7 cards. Fewer cards also means fewer `/me` refetches and fewer `health_events` inserts |
| One drain per instance at a time; a call that arrives while one runs asks it to go round once more (trailing run), within the 1.5 s budget | `after.ts` | removes the 298-of-300 empty drains (each one a pooler query); not measured live because `afterWrite` drains every channel of the shared database with the real sender |
| Hot helpers (`_room`, `_out`, `_bump`, `_audit`, `_variants`, `_stock_card`, `_room_stock`, `_is_try`) rewritten in plpgsql, same bodies (plans kept per session) | `0008_perf.sql` | waitlisted tap 2.3 → 1.7 ms median, waitlist_full 0.7 → 0.4 ms; in-DB serial time for 300 taps 752 → 565 ms |
| Lock-free `waitlist_full`: one snapshot decides "item live, no unit, waitlist at cap, buyer could claim"; anything else takes the locked path | `0008_perf.sql` (`claim_dibs`) | the 98 waitlist_full taps of a 300-tap burst no longer take a turn on the drop lock: ≈ 98 × 5.8 ms ≈ 0.57 s off the serial chain (estimate from (b)) |
| State route: one RPC (`api_state`, sweep + `drop_state`) instead of two; viewers asking at the same moment on one instance share it; the drain after a sweep runs after the response instead of before it | `state/route.ts` | 2 → 1 PostgREST request per viewer, and 1 per instance per moment instead of 1 per viewer |
| `/me`: one RPC (`api_me`, new) instead of two; drain after the response | `me/route.ts`, `0008_perf.sql` | 2 → 1 PostgREST request per refetch |
| Claim response gains `serverMs`; `load-sim.ts --scenario realistic` (400 buyers, 120 taps over 3 s, 3 variants × 2 units, waitlist cap 20) and a server-time row | `claims/route.ts`, `load-sim.ts` | measurement only |

### After the migration (applied with `npm run db:apply` at 2026-11-19 07:31:43–07:31:48 UTC)

- In Postgres, same sequential benchmark on the live functions: waitlisted median 1.9 ms, waitlist_full 0.4 ms
  (before: 2.3 and 0.7).
- Laptop → PostgREST, 300 `api_claim` at once (07:33 UTC): inconclusive. One run took 33.8 s with 6 HTTP 500
  (statement timeouts) while the same instance needed up to 2.2 s for a single won claim and 571 ms for the
  `generate_series` probe; the mixed run right after it gave claims median 2.82 s, state median 2.83 s. The database's
  CPU varied by more than any change here, so the before/after comparison through PostgREST has to be made on
  production with `serverMs` (section 5), ideally on a larger compute size or a quiet database.

## 3. Correctness

- `npm run test:db` against the staged migration (`perf-stage.ts up`, then the suite with `?search_path=perf8,public`
  on both URLs): 30 of 31 pass. The one failure, `a win writes order ... codec shapes`, expects a `upi://` link on a
  sandbox order; migration `0009_demo.sql` (another work package, already applied to the shared database) replaces it
  with "Dibs demo: no real payment". It fails the same way against the live functions without 0008.
- New `tests/db/perf.test.ts`: a freed waitlist place is taken by the next tap and a waiting buyer hears `already`, not
  `waitlist_full`; 8 rounds of a release racing 8 taps fill at most the one freed place, waitlist positions stay in
  commit order; 4 viewers polling `api_state` through a 150-tap burst on 2 variants never see `left` outside 0..2 or
  `waiting` above the cap; after a burst and a hand-on, the last room card, the room metadata and the public state all
  equal the database's stock, every `DB:Sold` and `DB:Back` card still goes out, cards leave in version order.
- The 300-concurrent test still gives 2 won, 20 waitlisted in commit order, 278 waitlist_full.
- After `_hold_secs` was taken out of 0008 (0009 owns it), `perf.test.ts` + `concurrency.test.ts` ran again on the
  staged copy: assertions all passed; two tests first failed with the pooler's `ECHECKOUTTIMEOUT` (no free server
  connection, `max_connections` 60) and passed when re-run through the session pooler.
- `npm test` (unit): 66 of 66. `npm run typecheck`: clean.

## 4. Not done, and why

- **Narrower lock** (claims lock the stock row, drop changes lock drop then stock): every claim bumps
  `drops.version`, which updates the drop row, so claims still serialise there. Dropping the bump would break the
  cards: a stock card is built inside the transaction, and two variants' cards committing out of version order would
  make clients keep the stale one. Kept the drop lock.
- **`synchronous_commit = off` for taps**: would cut the commit share of the 5.8 ms, but a crash could lose a claim
  the buyer was already told is theirs. Not acceptable.
- **Engine-side upsert of one pending stock row per item**: the in-DB cost is the card build either way (0.73 ms), and
  the drain collapse already removes the sends; not worth a riskier engine change.
- **Lighter audit path**: 0.27 ms per tap and it is the ledger; kept.
- **Indexes**: every hot statement already uses one (table above).
- **CDN caching of `/state`**: the route sweeps; single-flight gives most of the benefit without serving cached 404s
  or skipping sweeps.
- **Outside this package** (files owned by others; recommended, not changed): `rpc()` in `db.ts` should not retry
  after its own timeout (the request may still run and the retry joins the same queue); `nexconn.ts` writes one
  `health_events` row per Nexconn call as a floating promise, which is what left pooler connections stuck; batching it
  or sending it inside `after()` would stop that.

## 5. Verify on production (after the deploy)

```bash
# the burst the earlier runs used, plus the realistic shape; both append to docs/load-sim-results.md
node --env-file=.env.local scripts/load-sim.ts --base https://tapdibs.vercel.app
node --env-file=.env.local scripts/load-sim.ts --base https://tapdibs.vercel.app --scenario realistic
# the new row "claim server time (serverMs ...)" and the "Client minus server time" line split network from server
# engine-only numbers, any time (throwaway sandbox drops, deleted afterwards)
node --env-file=.env.local scripts/perf-engine.ts db
node --env-file=.env.local scripts/perf-engine.ts drain     # includes the PostgREST bursts
```
