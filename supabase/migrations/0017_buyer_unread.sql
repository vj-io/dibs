-- 0017: the seller portal tells the team when a buyer writes in an order room, without opening the order first.
-- The message:send webhook counts each buyer message in their own order's group; staff opening the order reset it.
-- Additive and re-runnable.
--   buyer_unread     buyer messages since a staff member last had the order open
--   buyer_msg_at     when the latest of them arrived
--   buyer_last_text  its text (trimmed, 140 chars), null for a photo, file or other non-text message
alter table orders add column if not exists buyer_unread int not null default 0;
alter table orders add column if not exists buyer_msg_at timestamptz;
alter table orders add column if not exists buyer_last_text text;
create index if not exists orders_buyer_unread on orders (shop_id, buyer_msg_at desc) where buyer_unread > 0;

notify pgrst, 'reload schema';
