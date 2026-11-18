"use client";
// Bare Nexconn Web SDK harness for the proof of concept. Driven by scripts/poc_browser.py through window.poc.
// Query: ?reg=0 skips registerCustomMessages (to see how an unregistered server type arrives).
import { useEffect, useState } from "react";
import { CARD_TYPES } from "@/lib/codec";

type NC = typeof import("@nexconn/chat");
type Ev = Record<string, unknown> & { ev: string; at: number };

declare global { interface Window { poc?: Record<string, unknown> } }

export default function PocClient() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const log: Ev[] = [];
    const push = (e: Omit<Ev, "at">) => { const x = { ...e, at: Date.now() } as Ev; log.push(x); setLines((l) => [...l.slice(-30), JSON.stringify(x).slice(0, 200)]); };
    let nc: NC;
    const res = (r: { isOk: boolean; code: number; data?: unknown }, t0: number) => ({ ok: r.isOk, code: r.code, data: r.data ?? null, ms: Date.now() - t0 });
    const msgOut = (m: InstanceType<NC["Message"]>) => ({
      messageId: m.messageId, messageType: m.messageType, content: m.content, sender: m.senderUserId, sentTime: m.sentTime,
      channelType: m.channelIdentifier?.channelType, channelId: m.channelIdentifier?.channelId,
      flat: { channelId: (m as unknown as { channelId?: unknown }).channelId, channelType: (m as unknown as { channelType?: unknown }).channelType },
      isPersisted: m.isPersisted, needReceipt: m.needReceipt,
    });

    window.poc = {
      log,
      async init(appKey: string, token: string, register = true) {
        nc = await import("@nexconn/chat");
        nc.NCEngine.initialize({ appKey, areaCode: nc.AreaCode.SG, logLevel: nc.LogLevel.WARN });
        if (register) nc.NCEngine.registerCustomMessages(CARD_TYPES.map((messageType) => ({ messageType, isPersisted: true, isCounted: false })));
        nc.NCEngine.addConnectionStatusHandler("poc", new nc.ConnectionStatusHandler({ onConnectionStatusChanged: ({ status, code }) => push({ ev: "status", status, code }) }));
        nc.NCEngine.addMessageHandler("poc", new nc.MessageHandler({
          onMessageReceived: ({ messages }) => messages.forEach((m) => push({ ev: "msg", ...msgOut(m) })),
          onMessageDeleted: ({ messages }) => push({ ev: "deleted", messages: messages.map((d) => ({ messageId: d.messageId, channelId: d.channelIdentifier?.channelId, channelType: d.channelIdentifier?.channelType })) }),
          onMessageReceiptResponse: ({ responses }) => push({ ev: "receipt", responses: responses.map((r) => ({ id: r.messageId, read: r.readCount, total: r.totalCount })) }),
        }));
        nc.NCEngine.addOpenChannelHandler("poc", new nc.OpenChannelHandler({
          onEntered: (e) => push({ ev: "entered", ...e }),
          onEnterFailed: (e) => push({ ev: "enterFailed", ...e }),
          onExited: (e) => push({ ev: "exited", ...e }),
          onMetadataChanged: ({ changeInfo }) => push({ ev: "meta", changeInfo }),
          onMetadataSynced: (e) => push({ ev: "metaSynced", ...e }),
          onParticipantChanged: (e) => push({ ev: "participants", ...e }),
          onChannelDestroyed: (e) => push({ ev: "destroyed", ...e }),
          onParticipantMuted: ({ info }) => push({ ev: "muted", ...info }),
          onParticipantBanned: ({ info }) => push({ ev: "banned", ...info }),
        }));
        const t0 = Date.now();
        return res(await nc.NCEngine.connect({ token }), t0);
      },
      status: () => nc?.NCEngine.getConnectionStatus(),
      async enter(id: string, messageCount = 10) { const t0 = Date.now(); return res(await new nc.OpenChannel(id).enterChannel({ messageCount }), t0); },
      async exit(id: string) { const t0 = Date.now(); return res(await new nc.OpenChannel(id).exitChannel(), t0); },
      async setMeta(id: string, metadata: Record<string, string>, overwrite: boolean) { const t0 = Date.now(); return res(await new nc.OpenChannel(id).setMetadata({ metadata, overwrite }), t0); },
      async meta(id: string) { const t0 = Date.now(); return res(await new nc.OpenChannel(id).getMetadata(), t0); },
      async sendRoom(id: string, text: string) {
        const t0 = Date.now(); const r = await new nc.OpenChannel(id).sendMessage(new nc.SendTextMessageParams({ text }));
        return { ...res({ ...r, data: undefined }, t0), messageId: r.data?.messageId ?? null };
      },
      async sendGroup(id: string, text: string) {
        const p = new nc.SendTextMessageParams({ text }); p.needReceipt = true;
        const t0 = Date.now(); const r = await new nc.GroupChannel(id).sendMessage(p);
        return { ...res({ ...r, data: undefined }, t0), messageId: r.data?.messageId ?? null };
      },
      async sendCommunity(id: string, sub: string, text: string) {
        const t0 = Date.now(); const r = await new nc.CommunitySubChannel(id, sub).sendMessage(new nc.SendTextMessageParams({ text }));
        return { ...res({ ...r, data: undefined }, t0), messageId: r.data?.messageId ?? null };
      },
      async subChannels(id: string) { const t0 = Date.now(); const r = await new nc.CommunityChannel(id).getSubChannels(); return { ...res({ ...r, data: undefined }, t0), subs: r.data?.map((s) => s.toObject()) ?? null }; },
      async history(type: "group" | "direct" | "system", id: string) {
        const ident = type === "group" ? new nc.GroupChannelIdentifier(id) : type === "direct" ? new nc.DirectChannelIdentifier(id) : new nc.SystemChannelIdentifier(id);
        const t0 = Date.now(); const r = await nc.BaseChannel.createMessagesQuery({ channelIdentifier: ident, pageSize: 50, isAscending: false }).loadNextPage();
        return { ...res({ ...r, data: undefined }, t0), messages: r.data?.data.map(msgOut) ?? null };
      },
      async roomHistory(id: string) {
        const t0 = Date.now(); const r = await nc.OpenChannel.createOpenChannelMessagesQuery({ channelId: id, pageSize: 20, isAscending: false }).loadNextPage();
        return { ...res({ ...r, data: undefined }, t0), messages: r.data?.data.map(msgOut) ?? null };
      },
      async markRead(groupId: string, ids: string[]) { const t0 = Date.now(); return res(await new nc.GroupChannel(groupId).sendReadReceiptResponse(ids), t0); },
      async receipts(groupId: string, ids: string[]) { const t0 = Date.now(); return res(await new nc.GroupChannel(groupId).getMessageReadReceiptInfo(ids), t0); },
      ready: true,
    };
    push({ ev: "ready" });
  }, []);
  return <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{lines.join("\n")}</pre>;
}
