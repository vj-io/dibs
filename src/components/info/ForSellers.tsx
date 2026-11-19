import { Card } from "@/components/ui";

// "Who pays / how it grows". Same wording as docs/WRITEUP.md section 6. No numbers: the price is not set.
export function ForSellers({ id = "sellers" }: { id?: string }) {
  return (
    <Card flat tint="yellow" className="p-5 sm:p-6">
      <h2 id={id} className="text-2xl sm:text-3xl">For sellers: who pays</h2>
      <ul className="mt-3 grid gap-2 text-lg">
        <li>The seller pays. Buyers are free.</li>
        <li>Free for small drops, then a flat monthly fee per shop. The price is not set and untested.</li>
        <li>No cut of sales: Dibs never touches the money.</li>
        <li>Growth loop: every drop link and the shop club bring in the next buyers.</li>
        <li>First planned seller: a jewellery seller who already sells on WhatsApp. A plan, not a result: no real drop has run yet.</li>
      </ul>
    </Card>
  );
}
