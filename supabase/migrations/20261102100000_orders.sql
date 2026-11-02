-- Customer orders are created through one validated database transaction.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  reference text not null,
  status text not null default 'received'
    check (status in ('received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  customer_name text not null check (length(trim(customer_name)) between 1 and 100),
  customer_phone text not null check (length(trim(customer_phone)) between 6 and 30),
  fulfillment_method text not null check (fulfillment_method in ('pickup', 'delivery')),
  delivery_address text,
  customer_note text check (customer_note is null or length(customer_note) <= 500),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(16, 2) not null check (subtotal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_store_reference_key unique (store_id, reference),
  constraint orders_store_id_id_key unique (store_id, id),
  constraint orders_delivery_address_check check (
    (fulfillment_method = 'pickup' and delivery_address is null)
    or (fulfillment_method = 'delivery' and length(trim(delivery_address)) between 3 and 300)
  )
);

create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_store_status_created_idx on public.orders (store_id, status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  product_id uuid,
  product_name text not null check (length(trim(product_name)) between 1 and 120),
  quantity integer not null check (quantity between 1 and 100),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(14, 2) not null check (line_total >= 0),
  constraint order_items_order_same_store_fk
    foreign key (store_id, order_id)
    references public.orders (store_id, id) on delete cascade
);

create index order_items_order_idx on public.order_items (order_id);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.orders, public.order_items from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;
grant update (status) on public.orders to authenticated;

create policy "store owners can read orders" on public.orders
for select to authenticated using (public.owns_store(store_id::text));
create policy "store owners can change order status" on public.orders
for update to authenticated
using (public.owns_store(store_id::text))
with check (public.owns_store(store_id::text));
create policy "store owners can read order items" on public.order_items
for select to authenticated using (public.owns_store(store_id::text));

create function public.create_store_order(
  p_store_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_fulfillment_method text,
  p_delivery_address text,
  p_customer_note text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_reference text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_requested_count integer;
  v_matched_count integer;
  v_currency_count integer;
  v_currency text;
  v_subtotal numeric(16, 2);
begin
  if length(trim(coalesce(p_customer_name, ''))) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Ingresá un nombre válido.';
  end if;
  if length(trim(coalesce(p_customer_phone, ''))) not between 6 and 30 then
    raise exception using errcode = '22023', message = 'Ingresá un teléfono válido.';
  end if;
  if p_fulfillment_method not in ('pickup', 'delivery') then
    raise exception using errcode = '22023', message = 'Elegí retiro o delivery.';
  end if;
  if p_fulfillment_method = 'delivery'
    and length(trim(coalesce(p_delivery_address, ''))) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'Ingresá una dirección de entrega válida.';
  end if;
  if p_fulfillment_method = 'pickup' then
    p_delivery_address := null;
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'El pedido debe incluir una lista de productos.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'El pedido debe incluir entre 1 y 30 productos.';
  end if;

  select s.id into v_store_id
  from public.stores as s
  where s.slug = lower(trim(p_store_slug)) and s.status = 'published'
  for share;
  if v_store_id is null then
    raise exception using errcode = 'P0002', message = 'Esta tienda no está disponible para recibir pedidos.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    where requested.product_id is null or requested.quantity is null
      or requested.quantity < 1 or requested.quantity > 20
  ) then
    raise exception using errcode = '22023', message = 'Revisá las cantidades del pedido.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    group by requested.product_id
    having sum(requested.quantity) > 100
  ) then
    raise exception using errcode = '22023', message = 'La cantidad máxima por producto es 100.';
  end if;

  select count(*) into v_requested_count
  from (
    select requested.product_id, sum(requested.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    group by requested.product_id
  ) as requested;

  perform 1
  from public.products as p
  join (
    select requested.product_id
    from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    group by requested.product_id
  ) as requested on requested.product_id = p.id
  where p.store_id = v_store_id and p.available = true
  order by p.id
  for share of p;

  select count(*), count(distinct p.currency), min(p.currency),
    coalesce(sum(p.price * requested.quantity), 0)
  into v_matched_count, v_currency_count, v_currency, v_subtotal
  from (
    select requested.product_id, sum(requested.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    group by requested.product_id
  ) as requested
  join public.products as p
    on p.id = requested.product_id
   and p.store_id = v_store_id
   and p.available = true;

  if v_matched_count <> v_requested_count then
    raise exception using errcode = '22023', message = 'Algún producto ya no está disponible. Actualizá el catálogo y probá otra vez.';
  end if;
  if v_currency_count <> 1 then
    raise exception using errcode = '22023', message = 'El catálogo tiene productos con monedas distintas.';
  end if;

  insert into public.orders (
    id, store_id, reference, customer_name, customer_phone,
    fulfillment_method, delivery_address, customer_note, currency, subtotal
  ) values (
    v_order_id, v_store_id, v_reference, trim(p_customer_name), trim(p_customer_phone),
    p_fulfillment_method, nullif(trim(p_delivery_address), ''),
    nullif(trim(coalesce(p_customer_note, '')), ''), v_currency, v_subtotal
  );

  insert into public.order_items (
    store_id, order_id, product_id, product_name, quantity, unit_price, line_total
  )
  select v_store_id, v_order_id, p.id, p.name, requested.quantity,
    p.price, p.price * requested.quantity
  from (
    select requested.product_id, sum(requested.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer)
    group by requested.product_id
  ) as requested
  join public.products as p
    on p.id = requested.product_id
   and p.store_id = v_store_id
   and p.available = true;

  return jsonb_build_object(
    'reference', v_reference,
    'currency', v_currency,
    'subtotal', v_subtotal
  );
end;
$$;

revoke all on function public.create_store_order(text, text, text, text, text, text, jsonb)
from public;
grant execute on function public.create_store_order(text, text, text, text, text, text, jsonb)
to anon, authenticated;
