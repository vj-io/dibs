import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/seller/Dashboard";

export const metadata: Metadata = { title: "Results" };

export default function Page() {
  return <Suspense><Dashboard /></Suspense>;
}
