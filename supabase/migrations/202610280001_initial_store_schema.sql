-- Go Store: initial multi-tenant schema.
-- Each merchant owns their data; only published catalogs are public.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$'),
  name text not null check (length(trim(name)) between 1 and 100),
  tagline text,
  description text,
  welcome_title text,
  menu_title text,
  template_key text not null default 'huerta'
    check (template_key in ('huerta', 'costa', 'barro')),
  primary_color text not null default '#536A43'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path text,
  logo_text text,
  contact_phone text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'paused')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_owner_id_idx on public.stores (owner_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$'),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_store_slug_key unique (store_id, slug),
  constraint categories_store_id_id_key unique (store_id, id)
);

create index categories_store_order_idx on public.categories (store_id, active, sort_order);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  category_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  price numeric(12, 2) not null check (price >= 0),
  currency text not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  image_path text,
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_category_same_store_fk
    foreign key (store_id, category_id)
    references public.categories (store_id, id)
    on delete restrict
);

create index products_store_order_idx on public.products (store_id, available, sort_order);
create index products_category_idx on public.products (store_id, category_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();
create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- Populate private profile details from signup metadata.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- A SECURITY DEFINER helper avoids exposing owner_id or causing RLS recursion.
create function public.owns_store(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stores as s
    where s.id::text = p_store_id
      and s.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_store(text) from public, anon;
grant execute on function public.owns_store(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;

create policy "profile owner can read" on public.profiles
for select to authenticated using (id = (select auth.uid()));
create policy "profile owner can update" on public.profiles
for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "published stores are public" on public.stores
for select to anon, authenticated using (status = 'published');
create policy "store owner can read" on public.stores
for select to authenticated using (owner_id = (select auth.uid()));
create policy "store owner can create" on public.stores
for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "store owner can update" on public.stores
for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "published categories are public" on public.categories
for select to anon, authenticated
using (exists (
  select 1 from public.stores as s
  where s.id = categories.store_id and s.status = 'published'
));
create policy "store owner can read categories" on public.categories
for select to authenticated using (public.owns_store(store_id::text));
create policy "store owner can create categories" on public.categories
for insert to authenticated with check (public.owns_store(store_id::text));
create policy "store owner can update categories" on public.categories
for update to authenticated
using (public.owns_store(store_id::text))
with check (public.owns_store(store_id::text));
create policy "store owner can delete categories" on public.categories
for delete to authenticated using (public.owns_store(store_id::text));

create policy "published products are public" on public.products
for select to anon, authenticated
using (exists (
  select 1 from public.stores as s
  where s.id = products.store_id and s.status = 'published'
));
create policy "store owner can read products" on public.products
for select to authenticated using (public.owns_store(store_id::text));
create policy "store owner can create products" on public.products
for insert to authenticated with check (public.owns_store(store_id::text));
create policy "store owner can update products" on public.products
for update to authenticated
using (public.owns_store(store_id::text))
with check (public.owns_store(store_id::text));
create policy "store owner can delete products" on public.products
for delete to authenticated using (public.owns_store(store_id::text));

-- Expose selected store fields only; profile details and owner_id stay private.
revoke all on public.profiles, public.stores, public.categories, public.products
from anon, authenticated;
grant select, update (full_name, phone) on public.profiles to authenticated;

grant select (
  id, slug, name, tagline, description, welcome_title, menu_title,
  template_key, primary_color, logo_path, logo_text, contact_phone,
  status, published_at, created_at, updated_at
) on public.stores to anon, authenticated;
grant insert (
  owner_id, slug, name, tagline, description, welcome_title, menu_title,
  template_key, primary_color, logo_path, logo_text, contact_phone, status
) on public.stores to authenticated;
grant update (
  slug, name, tagline, description, welcome_title, menu_title,
  template_key, primary_color, logo_path, logo_text, contact_phone,
  status, published_at
) on public.stores to authenticated;
grant select on public.categories, public.products to anon, authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;

-- Views bypass RLS by default; security_invoker keeps the store policies in force.
create view public.storefronts_public
with (security_invoker = true)
as
select
  id, slug, name, tagline, description, welcome_title, menu_title,
  template_key, primary_color, logo_path, logo_text, contact_phone, published_at
from public.stores
where status = 'published';
grant select on public.storefronts_public to anon, authenticated;

-- Public object delivery for storefront images; management stays owner-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-assets', 'store-assets', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "store owners can list assets" on storage.objects
for select to authenticated
using (bucket_id = 'store-assets'
  and public.owns_store((storage.foldername(name))[1]));
create policy "store owners can upload assets" on storage.objects
for insert to authenticated
with check (bucket_id = 'store-assets'
  and public.owns_store((storage.foldername(name))[1]));
create policy "store owners can update assets" on storage.objects
for update to authenticated
using (bucket_id = 'store-assets'
  and public.owns_store((storage.foldername(name))[1]))
with check (bucket_id = 'store-assets'
  and public.owns_store((storage.foldername(name))[1]));
create policy "store owners can delete assets" on storage.objects
for delete to authenticated
using (bucket_id = 'store-assets'
  and public.owns_store((storage.foldername(name))[1]));
