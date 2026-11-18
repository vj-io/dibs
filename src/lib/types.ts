// Request/response shapes of every API route, keyed "METHOD /path". Shared by server and browser (types only).
// The realtime package added the entries below; the API package fills in the rest.

export type PublicConfig = {
  mode: "nexconn" | "mock";
  appKey: string;
  area: "SG" | "NA" | "SA";
  textEnvelope: boolean;
  features: { premessage: boolean; community: boolean; systemChannel: boolean; calls: boolean };
};

/** A mock-bus message as GET /api/mock/stream and /api/mock/send return it. */
export type MockMsg = { id: string; type: "room" | "group" | "user"; channel: string; from: string; fromName?: string; at: number; text: string };

export type Api = {
  "GET /api/config": { req: undefined; res: PublicConfig };
  "POST /api/nexconn/token": { req: { as?: "buyer" | "staff" } | undefined; res: { userId: string; name: string; token: string | null } };
  "POST /api/mock/send": { req: { target: { type: "room" | "group"; id: string }; text: string; as?: "buyer" | "staff" }; res: { message: MockMsg } };
  "GET /api/mock/send": { req: undefined; res: { messages: MockMsg[] } };
};
