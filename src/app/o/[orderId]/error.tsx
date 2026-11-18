"use client";
import { RouteError } from "@/components/order/RouteError";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} what="your order" />;
}
