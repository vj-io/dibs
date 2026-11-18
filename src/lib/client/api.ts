// Typed fetch for our own API: api("POST /api/claims", body) / api("GET /api/drops/:id/me", undefined, { id }).
// `:name` segments are filled from params; other params become the query string. Errors throw ApiError.
import type { Api } from "@/lib/types";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) { super(message); this.code = code; this.status = status; this.name = "ApiError"; }
}

type Res<K> = K extends keyof Api ? Api[K]["res"] : unknown;
type Req<K> = K extends keyof Api ? Api[K]["req"] : unknown;
type Params = Record<string, string | number | boolean | null | undefined>;

export async function api<K extends keyof Api | (string & {})>(key: K, body?: Req<K>, params?: Params): Promise<Res<K>> {
  const [method, rawPath] = key.split(" ") as [string, string];
  const rest = new URLSearchParams();
  let path = rawPath.replace(/:([A-Za-z_]+)/g, (_, k: string) => encodeURIComponent(String(params?.[k] ?? "")));
  for (const [k, v] of Object.entries(params ?? {})) if (!rawPath.includes(`:${k}`) && v != null) rest.set(k, String(v));
  if ([...rest].length) path += (path.includes("?") ? "&" : "?") + rest;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network", "You're offline. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(data?.error ?? `http_${res.status}`, data?.message ?? "Something went wrong. Try again.", res.status);
  return data as Res<K>;
}
