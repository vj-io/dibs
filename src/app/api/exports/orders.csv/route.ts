// One drop's orders as CSV, for staff of that drop's shop. Cells that a spreadsheet would run as a formula
// (starting = + - @, tab or CR) get a leading quote. Phones are empty for demo (sandbox) drops. Times in IST.
import { z } from "zod";
import { sql } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import { staffForDrop } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

const HEAD = ["Order no", "Piece", "Variant", "Amount (₹)", "Buyer", "Phone", "State", "UTR", "Paid at", "Shipped at", "Tracking note", "Assigned to"];

/** One CSV cell: formula-safe, quoted when needed. */
function cell(v: string | number | null): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ist = (d: Date | null) => d && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  .format(d).replace(",", "");

export const GET = route("GET /api/exports/orders.csv", async (req: Request) => {
  const dropId = z.uuid().parse(new URL(req.url).searchParams.get("dropId"));
  await staffForDrop(dropId);
  const rows = await sql<{ order_no: number; title: string; label: string; amount: string; buyer: string; phone: string | null; state: string;
    utr: string | null; paid_at: Date | null; shipped_at: Date | null; tracking_note: string | null; staff: string | null; code: string }[]>`
    select o.order_no, p.title, pv.label, o.amount_paise as amount, b.display_name as buyer,
           case when d.is_sandbox then null else b.phone end as phone, o.state, o.utr, o.paid_at, o.shipped_at, o.tracking_note,
           st.display_name as staff, d.code
      from orders o join claims c on c.id = o.claim_id join drop_items i on i.id = c.drop_item_id
      join products p on p.id = i.product_id join product_variants pv on pv.id = c.variant_id
      join buyers b on b.id = o.buyer_id join drops d on d.id = o.drop_id left join staff st on st.id = o.assigned_staff_id
     where o.drop_id = ${dropId} order by o.order_no`;
  const [d] = await sql<{ code: string }[]>`select code from drops where id = ${dropId}`;
  const lines = [HEAD, ...rows.map((r) => [r.order_no, r.title, r.label, (Number(r.amount) / 100).toFixed(2), r.buyer, r.phone, r.state,
    r.utr, ist(r.paid_at), ist(r.shipped_at), r.tracking_note, r.staff])].map((l) => l.map(cell).join(","));
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dibs-orders-${d.code}.csv"`, "Cache-Control": "no-store" },
  });
});
