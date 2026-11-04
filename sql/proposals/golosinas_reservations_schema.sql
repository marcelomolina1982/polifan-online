-- DESIGN PROPOSAL ONLY. Do not run on production without integration tests.
-- Reservations are tied to web_requests and must be created in the same transaction.
create table if not exists public.candy_reservations (
 request_id bigint not null references public.web_requests(id),
 product_id text not null references public.candy_stock(product_id),
 quantity integer not null check(quantity>0),
 status text not null default 'reserved' check(status in ('reserved','completed','released')),
 created_at timestamptz not null default now(),
 primary key(request_id,product_id)
);
create index if not exists candy_reservations_product_status on public.candy_reservations(product_id,status);
alter table public.candy_reservations enable row level security;
-- No client-side direct access to reservations; server-side functions only.

-- An atomic submission endpoint should:
-- (1) validate items and prices against public_catalog, not client input;
-- (2) reject uninitialized stock products until the owner enters initial counts;
-- (3) lock candy_stock rows in product_id order and validate availability;
-- (4) insert web_requests and candy_reservations within one transaction;
-- (5) update stock and append movement records atomically;
-- (6) enforce request idempotency via a unique client-generated key;
-- (7) return only the public request identifier, not customer records.
-- Cancellation/confirmation must be staff-only and idempotent.
-- This file deliberately does not expose an unsafe anonymous SECURITY DEFINER endpoint.
