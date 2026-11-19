import { AppHeader } from "@/components/ui";
import { OrderSkeleton } from "@/components/order/OrderRoom";

export default function Loading() {
  return (
    <>
      <AppHeader title="Order" />
      <main id="main"><OrderSkeleton /></main>
    </>
  );
}
