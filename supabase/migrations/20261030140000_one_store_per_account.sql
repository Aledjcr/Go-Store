-- The hosted Go Store MVP allows one store for each authenticated account.
create unique index stores_one_store_per_owner_idx
on public.stores (owner_id);
