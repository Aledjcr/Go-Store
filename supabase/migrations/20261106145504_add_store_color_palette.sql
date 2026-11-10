-- Store themes support one primary, one secondary, and one accent color.
alter table public.stores
  add column secondary_color text not null default '#EAF0E4'
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column accent_color text not null default '#D9B85D'
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$');

-- Preserve a matching three-color base for existing stores.
update public.stores
set secondary_color = case template_key
      when 'costa' then '#E7EFF2'
      when 'barro' then '#F2E7DE'
      else '#EAF0E4'
    end,
    accent_color = case template_key
      when 'costa' then '#E0A45A'
      when 'barro' then '#D7AD4E'
      else '#D9B85D'
    end;

grant select (secondary_color, accent_color)
  on public.stores to anon, authenticated;
grant insert (secondary_color, accent_color)
  on public.stores to authenticated;
grant update (secondary_color, accent_color)
  on public.stores to authenticated;

create or replace view public.storefronts_public
with (security_invoker = true)
as
select
  id, slug, name, tagline, description, welcome_title, menu_title,
  template_key, primary_color, logo_path, logo_text, contact_phone,
  published_at, secondary_color, accent_color
from public.stores
where status = 'published';

grant select on public.storefronts_public to anon, authenticated;
