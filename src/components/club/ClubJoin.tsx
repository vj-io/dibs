"use client";
// Sale-room entry to the shop club: "Join the club" (one tap for a buyer who already joined the sale) or "In the club".
// Renders nothing when the club is off (404) or cannot load.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Icon, LinkButton, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import type { ClubSummary } from "@/lib/types";

export function ClubJoin({ shopId, shopSlug }: { shopId: string; shopSlug: string }) {
  const toast = useToast();
  const router = useRouter();
  const [d, setD] = useState<ClubSummary | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("GET /api/club/:shopSlug", undefined, { shopSlug }).then((x) => { if (x.shop.id === shopId) setD(x); }, () => {});
  }, [shopId, shopSlug]);
  if (!d) return null;

  const href = `/s/${shopSlug}/club`;
  async function join() {
    setBusy(true);
    try {
      const r = await api("POST /api/club/join", { shopSlug });
      setD((x) => x && { ...x, memberCount: r.memberCount, me: x.me && { ...x.me, member: true } });
      toast("You're in the club. You'll hear about the next drop.", { tone: "good" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.push(href); // not joined as a buyer yet: the club page asks
      else toast(e instanceof Error ? e.message : "Couldn't join. Try again.", { tone: "warn" });
    } finally { setBusy(false); }
  }

  return (
    <Card flat className="flex flex-col gap-2 p-3" data-testid="club-join">
      <p className="flex items-center gap-2 font-extrabold"><Icon name="users" size={20} />{d.shop.name} club
        <span className="font-mono text-sm font-normal text-muted">{d.memberCount} {d.memberCount === 1 ? "member" : "members"}</span></p>
      {d.me?.member ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tint="lime" icon="check" size="sm">In the club</Badge>
          <LinkButton size="sm" variant="ghost" href={href} icon="arrowRight">Open club</LinkButton>
        </div>
      ) : d.me?.banned ? null : (
        <>
          <p className="text-muted">Hear about the next drop first and chat with other buyers.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="bell" busy={busy} busyLabel="Joining…" onClick={() => void join()}>Join the club</Button>
            <LinkButton size="sm" variant="ghost" href={href}>See the club</LinkButton>
          </div>
        </>
      )}
    </Card>
  );
}
