-- brief-desk: run once in the Supabase SQL editor (free project).
-- Enables GitHub OAuth sync for brief history and saved shortcuts.
-- RLS: each row is only visible/writable by auth.uid().

create table if not exists brief_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  at bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists brief_history_user_at_idx
  on brief_history (user_id, at desc);

create table if not exists saved_shortcuts (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  at bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists saved_shortcuts_user_at_idx
  on saved_shortcuts (user_id, at desc);

alter table brief_history enable row level security;
alter table saved_shortcuts enable row level security;

drop policy if exists brief_history_select_own on brief_history;
create policy brief_history_select_own on brief_history
  for select using (auth.uid() = user_id);

drop policy if exists brief_history_insert_own on brief_history;
create policy brief_history_insert_own on brief_history
  for insert with check (auth.uid() = user_id);

drop policy if exists brief_history_update_own on brief_history;
create policy brief_history_update_own on brief_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists brief_history_delete_own on brief_history;
create policy brief_history_delete_own on brief_history
  for delete using (auth.uid() = user_id);

drop policy if exists saved_shortcuts_select_own on saved_shortcuts;
create policy saved_shortcuts_select_own on saved_shortcuts
  for select using (auth.uid() = user_id);

drop policy if exists saved_shortcuts_insert_own on saved_shortcuts;
create policy saved_shortcuts_insert_own on saved_shortcuts
  for insert with check (auth.uid() = user_id);

drop policy if exists saved_shortcuts_update_own on saved_shortcuts;
create policy saved_shortcuts_update_own on saved_shortcuts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists saved_shortcuts_delete_own on saved_shortcuts;
create policy saved_shortcuts_delete_own on saved_shortcuts
  for delete using (auth.uid() = user_id);
