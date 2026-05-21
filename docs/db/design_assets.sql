create table if not exists public.design_assets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text not null check (type in ('background', 'envelope')),
  name text not null,
  image_url text not null,
  storage_path text,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create index if not exists design_assets_type_active_sort_idx
  on public.design_assets (type, is_active, sort_order, created_at);

insert into storage.buckets (id, name, public)
values ('design-assets', 'design-assets', true)
on conflict (id) do update
set public = excluded.public;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read design assets'
  ) then
    create policy "Public read design assets"
    on storage.objects
    for select
    using (bucket_id = 'design-assets');
  end if;
end $$;
