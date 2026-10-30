-- The browser creator supplies a stable UUID so a retry updates the same draft.
grant insert (id) on table public.stores to authenticated;
