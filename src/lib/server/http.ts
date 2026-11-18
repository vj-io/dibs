// Route plumbing: uniform `{ error: code, message }` JSON, zod bodies, one log line per request, no stack traces leaked.
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status: number, code: string, message?: string): never => { throw new HttpError(status, code, message); };
export const forbidden = (): never => fail(403, "forbidden");
export const notFound = (): never => fail(404, "not_found");

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Wraps a route handler. `name` is the route label in logs, e.g. "POST /api/claims". */
export function route<C>(name: string, handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const requestId = req.headers.get("x-vercel-id") ?? randomUUID().slice(0, 8);
    const t0 = Date.now();
    let res: Response;
    let result = "ok";
    try {
      res = await handler(req, ctx);
      if (res.status >= 400) result = `http_${res.status}`;
    } catch (e) {
      if (e instanceof HttpError) {
        result = e.code;
        res = json({ error: e.code, message: e.message }, e.status);
      } else if (e instanceof ZodError) {
        result = "invalid";
        res = json({ error: "invalid", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
      } else {
        result = "internal";
        console.error("[api]", name, requestId, e);
        res = json({ error: "internal", message: "Something went wrong. Try again." }, 500);
      }
    }
    console.log(JSON.stringify({ requestId, route: name, ms: Date.now() - t0, result }));
    return res;
  };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail(400, "invalid", "body must be JSON"); }
  return schema.parse(raw);
}

/** A uuid dynamic segment from Next 16's promised params; 404 when it is not a uuid. */
export async function uuidParam<K extends string>(ctx: { params: Promise<Record<K, string>> }, key: K): Promise<string> {
  const v = (await ctx.params)[key];
  return z.uuid().safeParse(v).success ? v : notFound();
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
