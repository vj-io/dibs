// Nexconn proof-of-concept harness (scripts/poc_browser.py). Not served in production.
import { notFound } from "next/navigation";
import PocClient from "./PocClient";

export default function PocPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <PocClient />;
}
