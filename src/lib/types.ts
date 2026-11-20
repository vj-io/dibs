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

// ------------------------------------------------------------------ shared shapes (API package)
// Every time is an ISO string, every amount is paise. Phone numbers appear only in Buyer* (own),
// ConsoleLedgerEntry, DeskOrder and OrderView.buyer.phone (staff viewer); never in public shapes.

type Cards = import("./codec.ts").Card;
type CardOf<T extends Cards["t"]> = Extract<Cards, { t: T }>;

export type Ok = { ok: true };
export type Role = "owner" | "staff";
export type DropStatus = "scheduled" | "live" | "ended";
export type ItemState = "queued" | "live" | "sold_out" | "closed";
export type ClaimState = "held" | "payment_claimed" | "paid" | "shipped" | "waitlisted" | "expired" | "released" | "cancelled" | "left" | "missed";
export type OrderState = import("./codec.ts").OrderState;
export type ClaimOutcome = "won" | "waitlisted" | "not_live" | "closed" | "already" | "too_many_holds" | "waitlist_full" | "banned" | "no_variant";

/** A buyer as only that buyer sees it (phone included). */
export type BuyerSelf = { id: string; name: string; displayName: string; phone: string | null };

export type SellerMe = {
  staffId: string; role: Role; displayName: string; email: string | null;
  /** This owner's account had a password before the email was confirmed: ask them once to check the UPI ID and payee name. */
  proofNotice: boolean;
  shop: { id: string; name: string; slug: string; isSandbox: boolean; deskGroupId: string | null };
};

export type FaqLine = string;
export type ShopSettings = {
  id: string; slug: string; name: string; logoUrl: string | null; upiId: string | null; payeeName: string | null;
  supportWhatsapp: string | null; holdMinutes: number; holdSeconds: number; maxHolds: number; highValuePaise: number | null;
  autoAdvance: boolean; faq: FaqLine[]; isSandbox: boolean; deskGroupId: string | null; createdAt: string;
  staff: StaffMember[];
};
/** `pending` = invited by email, has not signed in yet. */
export type StaffMember = { staffId: string; role: Role; displayName: string; email: string | null; status: "active" | "pending" };

export type ShopInput = {
  name: string; slug: string; upiId?: string | null; payeeName?: string | null; supportWhatsapp?: string | null;
  logoUrl?: string | null; holdMinutes?: number; maxHolds?: number; highValuePaise?: number | null; autoAdvance?: boolean;
  faq?: FaqLine[]; ownerName?: string;
};

export type Variant = { key: string; label: string; qty: number };
export type Product = {
  id: string; title: string; pricePaise: number; note: string | null; photos: string[]; variants: Variant[];
  createdAt: string; inLiveDrop: boolean; usedInDrops: number;
};
/** Photo: a public Storage URL from POST /api/products/upload-url, or a site path starting /demo/. Up to 4. */
export type ProductInput = { title: string; pricePaise: number; note?: string | null; photos?: string[]; variants: Variant[] };

export type DropSummary = {
  dropId: string; code: string; title: string; status: DropStatus; startsAt: string; isSandbox: boolean;
  itemCount: number; createdAt: string; endedAt: string | null; shareUrl: string;
};

export type LiveItem = CardOf<"DB:Item"> & { state: ItemState };
export type DropItemRow = { itemId: string; position: number; title: string; pricePaise: number; photo: string | null; state: ItemState };
/** Public sale-room state (`drop_state`). No phone numbers, no claim ids. */
export type DropState = {
  dropId: string; code: string; title: string; status: DropStatus; startsAt: string; version: number; isSandbox: boolean;
  channelId: string; shop: { id: string; name: string; slug: string; logoUrl: string | null };
  live: LiveItem | null; items: DropItemRow[]; recent: (CardOf<"DB:Sold"> | CardOf<"DB:Back">)[];
  /** People in the sale room (Nexconn participant count, cached ~5 s); null = not measured (mock mode or lookup failed). */
  viewers: number | null;
};

/** The calling buyer's own claims in one drop (`my_status`). mutedUntil "infinity" = muted with no end. */
export type MyStatus = {
  holds: { claimId: string; orderId: string; itemId: string; position: number; title: string; variantLabel: string;
    state: "held" | "payment_claimed" | "paid" | "shipped"; expiresAt: string | null; pricePaise: number }[];
  waits: { claimId: string; itemId: string; position: number; title: string; variantKey: string; variantLabel: string; waitPosition: number }[];
  mutedUntil: string | null; banned: boolean;
};

export type ClaimResult = {
  result: ClaimOutcome; claimId: string | null; orderId: string | null; position: number | null;
  expiresAt: string | null; ms: number | null; message: string;
};

export type ConsoleLedgerEntry = {
  claimId: string; itemId: string; position: number; title: string; buyerId: string; buyer: string; phone: string | null; isBot: boolean;
  variantKey: string; variantLabel: string; state: ClaimState; committedAt: string; ms: number | null; expiresAt: string | null;
  promoted: boolean; waitPosition: number | null; orderId: string | null; orderNo: number | null; orderState: OrderState | null;
  assignedTo: string | null; endedReason: string | null;
};
export type ConsoleState = {
  ledger: ConsoleLedgerEntry[];
  stock: { itemId: string; position: number; title: string; state: ItemState; variants: import("./codec.ts").VariantLive[] }[];
  moderation: { id: number; buyerId: string | null; buyer: string | null; rule: string; action: string; at: string }[];
  bans: { buyerId: string; buyer: string; kind: "ban" | "mute"; until: string | null; reason: string | null }[];
};
/** viewers: Nexconn participant count (nexconn mode, cached 5 s); null = not measured (mock mode or lookup failed). */
export type Heartbeat = { state: DropState; console: ConsoleState; viewers: number | null };

/** null fields = "not measured yet". */
export type DropDashboard = {
  dropId: string; viewers: number | null; taps: number; holds: number; paidOrders: number; paidValuePaise: number;
  waitlistSaves: number; medianWinMs: number | null;
};
export type ImpactTotals = { drops: number; buyers: number; claimsWon: number; paidOrders: number; paidValuePaise: number; waitlistSaves: number };

export type OrderEvent = {
  /** audit event type: claim_won | hold_promoted | payment_claimed | payment_confirmed | payment_not_received | order_shipped | order_assigned | hold_expired | hold_released | hold_cancelled */
  type: string; at: string; actor: "buyer" | "staff" | "system"; note: string | null;
};
export type OrderView = {
  viewer: "buyer" | "staff";
  orderId: string; orderNo: number; claimId: string; state: OrderState; amountPaise: number; createdAt: string;
  /** Hold deadline while state = held; null otherwise (timer paused or finished). */
  expiresAt: string | null;
  utr: string | null; trackingNote: string | null; paidAt: string | null; shippedAt: string | null; cancelledAt: string | null;
  item: { itemId: string; position: number; title: string; note: string | null; photos: string[] };
  variant: { key: string; label: string };
  drop: { id: string; code: string; title: string; isSandbox: boolean };
  shop: { id: string; name: string; slug: string; supportWhatsapp: string | null };
  payment: { upiId: string | null; payee: string; amountPaise: number; upiLink: string | null; demo: boolean }; // demo: upiLink is plain text, not payable
  /** phone only when viewer = staff */
  buyer: { displayName: string; phone?: string | null };
  assignedTo: { staffId: string; displayName: string } | null;
  nexconnGroupId: string;
  history: OrderEvent[];
};

export type DeskOrder = {
  orderId: string; orderNo: number; state: OrderState; buyer: string; phone: string | null; item: string; variantLabel: string;
  amountPaise: number; assignedTo: { staffId: string; displayName: string } | null; expiresAt: string | null; createdAt: string;
  dropCode: string; utr: string | null; nexconnGroupId: string;
};
export type Desk = {
  deskGroupId: string | null; me: string;
  staff: { staffId: string; displayName: string; role: Role }[];
  orders: Record<OrderState, DeskOrder[]>;
};

/** A seller-inbox line: an order whose buyer wrote since the team last opened it. lastText null = a photo or file. */
export type InboxItem = { orderId: string; orderNo: number; buyer: string; item: string; unread: number; lastText: string | null; at: string };

export type MyAccount = {
  buyer: BuyerSelf;
  holds: MeOrder[]; orders: MeOrder[];
  waits: { claimId: string; dropId: string; dropCode: string; shop: { name: string; slug: string }; title: string; position: number;
    variantLabel: string; waitPosition: number }[];
};
export type MeOrder = {
  orderId: string; orderNo: number; state: OrderState; amountPaise: number; expiresAt: string | null; createdAt: string;
  title: string; variantLabel: string; photo: string | null; dropCode: string; shop: { name: string; slug: string };
};

export type HealthReport = {
  mode: "nexconn" | "mock"; features: PublicConfig["features"]; textEnvelope: boolean;
  nexconn: { recent: { kind: string; ok: boolean; code: string; ms: number; at: number }[];
    lastHour: { kind: string; calls: number; failures: number; p50Ms: number | null; lastErrorCode: string | null }[] };
  outbox: { pending: number; failed: number; stuck: number; oldestPendingAt: string | null; recentFailures: { id: string; msgType: string; error: string | null; at: string }[] };
  sweeps: { at: string; ms: number; ok: boolean; drops: number }[];
  ai: { job: string; model: string | null; calls: number; ok: number; avgMs: number | null }[];
};

export type Api = {
  "GET /api/config": { req: undefined; res: PublicConfig };
  "POST /api/nexconn/token": { req: { as?: "buyer" | "staff" } | undefined; res: { userId: string; name: string; token: string | null } };
  "POST /api/mock/send": { req: { target: { type: "room" | "group"; id: string }; text: string; as?: "buyer" | "staff" }; res: { message: MockMsg } };
  "GET /api/mock/send": { req: undefined; res: { messages: MockMsg[] } };

  // buyer session
  "POST /api/buyer/join": { req: { name: string; phone: string; shopSlug: string }; res: { buyerId: string; displayName: string } };
  "GET /api/names": { req: undefined; res: { names: Record<string, string> } };
  "GET /api/buyer/me": { req: undefined; res: { buyer: BuyerSelf | null } };
  "GET /api/me": { req: undefined; res: MyAccount };
  "DELETE /api/me": { req: undefined; res: { ok: true; released: number; left: number; kept: number } };

  // seller session and shop
  "POST /api/seller/session": { req: { accessToken: string } | { testEmail: string }; res: { needsShop: false; me: SellerMe } | { needsShop: true; email: string } };
  "DELETE /api/seller/session": { req: undefined; res: Ok };
  "DELETE /api/seller/notice": { req: undefined; res: Ok };
  "GET /api/seller/inbox": { req: undefined; res: { items: InboxItem[] } };
  "GET /api/seller/me": { req: undefined; res: { me: SellerMe | null; pendingEmail: string | null } };
  "POST /api/shops": { req: ShopInput; res: { shopId: string; staffId: string; me: SellerMe } };
  "GET /api/shops/:id": { req: undefined; res: ShopSettings };
  "PATCH /api/shops/:id": { req: Partial<Omit<ShopInput, "ownerName">>; res: ShopSettings };
  "POST /api/shops/:id/staff": { req: { email: string; name: string }; res: { member: StaffMember } };
  "DELETE /api/shops/:id/staff/:staffId": { req: undefined; res: Ok };

  // catalog
  "GET /api/products": { req: undefined; res: { products: Product[] } };
  "POST /api/products": { req: ProductInput; res: { product: Product } };
  "PATCH /api/products/:id": { req: Partial<ProductInput>; res: { product: Product } };
  "DELETE /api/products/:id": { req: undefined; res: Ok };
  /** Upload with PUT to signedUrl (or supabase-js uploadToSignedUrl(path, token, file)), then save publicUrl in photos. */
  "POST /api/products/upload-url": { req: { contentType: "image/jpeg" | "image/png" | "image/webp" }; res: { path: string; signedUrl: string; token: string; publicUrl: string } };

  // drops (staff)
  "GET /api/drops": { req: undefined; res: { drops: DropSummary[] } };
  "POST /api/drops": { req: { title: string; startsAt: string; productIds: string[] }; res: { dropId: string; code: string; shareUrl: string } };
  "POST /api/drops/:id/live": { req: undefined; res: { ok: true; liveItemId: string | null } };
  "POST /api/drops/:id/next": { req: undefined; res: { ok: true; liveItemId: string | null } };
  "POST /api/drops/:id/end": { req: undefined; res: { ok: true; liveItemId: string | null } };
  "POST /api/drops/:id/items/:itemId/close": { req: undefined; res: { ok: true; liveItemId: string | null } };
  "POST /api/drops/:id/items/:itemId/reopen": { req: undefined; res: { ok: true; liveItemId: string | null } };
  "POST /api/drops/:id/heartbeat": { req: undefined; res: Heartbeat };
  "POST /api/drops/:id/moderate": { req: { buyerId?: string; userId?: string; action: "mute" | "ban" | "unban"; minutes?: number; reason?: string }; res: Ok };
  "GET /api/drops/:id/dashboard": { req: undefined; res: DropDashboard };

  // buying (public / buyer)
  "GET /api/drops/by-code/:shop/:code": { req: undefined; res: { dropId: string; state: DropState } };
  "GET /api/drops/:id/state": { req: undefined; res: DropState };
  "GET /api/drops/:id/me": { req: undefined; res: MyStatus };
  "POST /api/claims": { req: { itemId: string; variantKey: string }; res: ClaimResult };
  "POST /api/claims/:id/release": { req: undefined; res: Ok };
  "POST /api/claims/:id/leave": { req: undefined; res: Ok };

  // orders and desk
  "GET /api/orders/:id": { req: undefined; res: OrderView };
  "POST /api/orders/:id/paid-claim": { req: { utr?: string }; res: Ok };
  "POST /api/orders/:id/confirm": { req: { received: boolean; note?: string }; res: Ok };
  "POST /api/orders/:id/ship": { req: { trackingNote?: string }; res: Ok };
  "POST /api/orders/:id/cancel": { req: { reason: string }; res: Ok };
  "POST /api/orders/:id/assign": { req: { staffId: string }; res: Ok };
  "POST /api/orders/:id/heartbeat": { req: undefined; res: { state: OrderState; expiresAt: string | null } };
  "POST /api/orders/:id/seen": { req: undefined; res: Ok };
  /** params: assigned = "me" | "all" (default) | <staffId>; state = one OrderState to fetch only that group */
  "GET /api/desk": { req: undefined; res: Desk };

  // system
  "GET /api/impact": { req: undefined; res: ImpactTotals };
  "GET /api/health": { req: undefined; res: HealthReport };
  "GET /api/cron/sweep": { req: undefined; res: { drops: number; endedDemos: number; expired: number; promoted: number; returned: number; warned: number; outbox: { sent: number; failed: number; more: boolean } } };

  // judge mode (WP7)
  "POST /api/try/start": { req: { role: "buyer" | "seller"; name?: string }; res: { dropId: string; code: string; shopSlug: string; shareUrl: string; role: "buyer" | "seller"; script: { atMs: number | null; text: string }[] } };
  "POST /api/try/tick": { req: { dropId: string; where?: "room" | "order" }; res: { ok: true; status: "scheduled" | "live" | "ended" | null } };

  // seller onboarding without email (password accounts, invite links), sample pieces, exports
  /** errors: account_exists 409, rate_limited 429, invalid 400 (email / password rules) */
  "POST /api/seller/signup": { req: { email: string; password: string; name: string }; res: { needsShop: false; me: SellerMe } | { needsShop: true; email: string } };
  /** errors: bad_login 401 (same answer whether or not the email exists), rate_limited 429 */
  "POST /api/seller/login": { req: { email: string; password: string }; res: { needsShop: false; me: SellerMe } | { needsShop: true; email: string } };
  /** errors: bad_invite 400, invite_expired 410, invite_used 410, bad_login 401 (email has an account, wrong password), has_shop 409 */
  "POST /api/seller/invite": { req: { token: string; password: string }; res: { needsShop: false; me: SellerMe } | { needsShop: true; email: string } };
  "POST /api/seller/password": { req: { password: string }; res: Ok };
  "POST /api/shops/:id/staff/:staffId/link": { req: undefined; res: { inviteUrl: string } };
  "POST /api/products/samples": { req: undefined; res: { products: Product[] } };
  "DELETE /api/products/samples": { req: undefined; res: { removed: number; products: Product[] } };

  // shop club (FR-26, FEATURE_COMMUNITY)
  "GET /api/club/:shopSlug": { req: undefined; res: ClubSummary };
  "POST /api/club/join": { req: { shopSlug: string }; res: { memberCount: number } };
  "POST /api/club/leave": { req: { shopSlug: string }; res: { memberCount: number } };
  "POST /api/club/send": { req: { shopSlug: string; text: string }; res: { message: ClubChatLine } };
  "POST /api/club/review": { req: { orderId: string; stars: number; text?: string }; res: { review: ClubPostView } };
  "POST /api/club/announce": { req: { text: string; dropCode?: string | null }; res: Ok };
  "GET /api/club/manage": { req: undefined; res: ClubManage };
  "POST /api/club/remove": { req: { buyerId: string }; res: Ok };
  "POST /api/club/hide": { req: { reviewId: string; reason: string }; res: Ok };
};

/** POST /api/shops/:id/staff also returns the invite link (7 days; works with no email sent). */
export type StaffInviteRes = { member: StaffMember; inviteUrl: string };
// ------------------------------------------------------------------ shop club
/** An announcement (#drops), a review (#reviews) or a chat line (#chat). Names are masked display names. */
export type ClubPostView = {
  id: string; text: string; at: string; stars: number | null; name: string | null; from: string | null; msgId: string | null;
  drop: { code: string; status: DropStatus; startsAt: string; shareUrl: string } | null;
  hiddenAt?: string | null; hiddenReason?: string | null;
};
export type ClubChatLine = { id: string; channel: string; from: string; fromName?: string; at: number; kind: "text"; text: string };
export type ClubSummary = {
  enabled: true; clubId: string | null;
  /** Demo shops: the club restarts with the demo slot; nothing older counts. */
  since: string | null;
  shop: { id: string; name: string; slug: string; logoUrl: string | null; isSandbox: boolean };
  memberCount: number;
  nextDrop: { code: string; title: string; status: "scheduled" | "live"; startsAt: string; shareUrl: string } | null;
  announcements: ClubPostView[]; reviews: ClubPostView[];
  /** members only, oldest first */
  chat: ClubPostView[];
  me: { userId: string; member: boolean; banned: boolean; reviewable: { orderId: string; title: string; orderNo: number }[] } | null;
};
export type ClubManage = {
  clubId: string | null; shopSlug: string; isSandbox: boolean; memberCount: number;
  members: { buyerId: string; name: string; joinedAt: string }[];
  chat: ClubPostView[]; reviews: ClubPostView[]; announcements: ClubPostView[];
};
