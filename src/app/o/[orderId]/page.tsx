import type { Metadata } from "next";
import { OrderRoom } from "@/components/order/OrderRoom";

export const metadata: Metadata = { title: "Your order" };

/** `?as=staff` opens the same room as the shop's team sees it (the API still checks the staff cookie). */
export default async function Page({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ as?: string; from?: string }> }) {
  const [{ orderId }, { as, from }] = await Promise.all([params, searchParams]);
  return <OrderRoom orderId={orderId} viewer={as === "staff" ? "staff" : "buyer"}
    arrived={from === "won" || from === "promoted" ? from : undefined} />;
}
