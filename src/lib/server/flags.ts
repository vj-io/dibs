// Realtime mode and feature flags, read once per server instance. Server only.
import type { PublicConfig } from "../types.ts";

const on = (v: string | undefined) => v === "1" || v === "true";

export type Area = "SG" | "NA" | "SA";

export const flags = (() => {
  const a = process.env.NEXCONN_AREA?.toUpperCase();
  return {
    // production always uses Nexconn, whatever REALTIME_MODE says (the mock bus is one process, no auth)
    mode: (process.env.REALTIME_MODE === "mock" && process.env.VERCEL_ENV !== "production" ? "mock" : "nexconn") as "nexconn" | "mock",
    appKey: process.env.NEXCONN_APP_KEY ?? "",
    area: (a === "NA" || a === "SA" ? a : "SG") as Area,
    textEnvelope: on(process.env.NEXCONN_TEXT_ENVELOPE),
    features: {
      premessage: on(process.env.FEATURE_PREMESSAGE),
      community: on(process.env.FEATURE_COMMUNITY),
      systemChannel: on(process.env.FEATURE_SYSTEM_CHANNEL),
      calls: on(process.env.FEATURE_CALLS),
    },
  };
})();

/** Public values only: what GET /api/config returns. */
export const publicConfig = (): PublicConfig => ({
  mode: flags.mode,
  appKey: flags.mode === "nexconn" ? flags.appKey : "",
  area: flags.area,
  textEnvelope: flags.mode === "mock" || flags.textEnvelope,
  features: flags.features,
});
