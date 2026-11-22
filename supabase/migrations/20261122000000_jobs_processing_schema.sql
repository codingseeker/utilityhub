create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null default 'anonymous',
  user_id uuid null,
  status text not null default 'pending',
  filename text not null,
  operation text not null,
  parameters jsonb not null default '{}'::jsonb,
  input_path text,
  input_paths text[] not null default '{}',
  result_path text,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobs add column if not exists filename text;
alter table public.jobs add column if not exists operation text;
alter table public.jobs add column if not exists parameters jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists error_message text;
alter table public.jobs add column if not exists input_paths text[] not null default '{}';
alter table public.jobs add column if not exists result jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists input_path text;
alter table public.jobs add column if not exists result_path text;
alter table public.jobs add column if not exists user_id uuid;
alter table public.jobs add column if not exists actor_id text not null default 'anonymous';
alter table public.jobs add column if not exists status text not null default 'pending';
alter table public.jobs add column if not exists created_at timestamptz not null default now();
alter table public.jobs add column if not exists updated_at timestamptz not null default now();

update public.jobs set filename = coalesce(nullif(filename, ''), 'legacy-upload') where filename is null or filename = '';
update public.jobs set operation = coalesce(nullif(operation, ''), 'legacy') where operation is null or operation = '';
update public.jobs set parameters = '{}'::jsonb where parameters is null;
update public.jobs set input_paths = '{}' where input_paths is null;
update public.jobs set result = '{}'::jsonb where result is null;

alter table public.jobs alter column filename set not null;
alter table public.jobs alter column operation set not null;
alter table public.jobs alter column parameters set default '{}'::jsonb;
alter table public.jobs alter column parameters set not null;
alter table public.jobs alter column user_id drop not null;

do $$
declare
  status_constraint record;
begin
  for status_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.jobs drop constraint %I', status_constraint.conname);
  end loop;
end;
$$;

alter table public.jobs alter column status drop default;
alter table public.jobs alter column status type text using status::text;
update public.jobs set status = 'pending' where status in ('queued', 'waiting');
update public.jobs set status = 'done' where status in ('complete', 'completed', 'success');
update public.jobs set status = 'failed' where status in ('error', 'cancelled');
update public.jobs set status = 'pending' where status not in ('pending', 'processing', 'done', 'failed');
alter table public.jobs alter column status set default 'pending';
alter table public.jobs add constraint jobs_status_check
  check (status in ('pending', 'processing', 'done', 'failed'));

create index if not exists jobs_created_at_idx on public.jobs (created_at desc);
create index if not exists jobs_status_idx on public.jobs (status);

insert into storage.buckets (id, name, public)
values ('utilityhub-files', 'utilityhub-files', false)
on conflict (id) do nothing;
