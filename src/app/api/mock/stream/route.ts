// Mock transport stream (REALTIME_MODE=mock only): SSE of room messages for ?rooms=, the caller's groups and personal messages.
import { flags } from "@/lib/server/flags";
import { notFound, route } from "@/lib/server/http";
import { bus, type BusMsg } from "@/lib/server/mockbus";
import { liveIdentity } from "@/lib/server/nexconn";

export const GET = route("GET /api/mock/stream", async (req: Request) => {
  if (flags.mode !== "mock") notFound();
  const url = new URL(req.url);
  const as = url.searchParams.get("as");
  const me = await liveIdentity(as === "buyer" || as === "staff" ? as : undefined);
  const rooms = (url.searchParams.get("rooms") ?? "").split(",").filter(Boolean).slice(0, 10);
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (s: string) => { try { c.enqueue(enc.encode(s)); } catch { stop(); } };
      send(`event: hello\ndata: ${JSON.stringify({ userId: me.userId })}\n\n`);
      const unsub = bus().subscribe(me.userId, rooms, (m: BusMsg) => send(`data: ${JSON.stringify(m)}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 15_000);
      stop = () => { unsub(); clearInterval(ping); };
      req.signal.addEventListener("abort", () => { stop(); try { c.close(); } catch {} });
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } });
});
