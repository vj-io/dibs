import { EmptyState, LinkButton } from "@/components/ui";

export default function SellerNotFound() {
  return (
    <EmptyState icon="cross" title="That isn't in your shop."
      body="It may belong to another shop, or the link is wrong."
      action={<LinkButton href="/seller/drops" icon="arrowRight">Back to your drops</LinkButton>} />
  );
}
