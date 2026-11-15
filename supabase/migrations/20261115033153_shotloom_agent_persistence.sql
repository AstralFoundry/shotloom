create table shotloom.agent_sessions (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  id text not null,
  header jsonb not null check (jsonb_typeof(header) = 'object' and header->>'id' = id),
  inherited_count integer not null default 0 check (inherited_count >= 0),
  event_count integer not null default 0 check (event_count >= 0),
  primary key (user_id, id)
);
create table shotloom.agent_events (
  user_id uuid not null,
  session_id text not null,
  seq integer not null check (seq >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (user_id, session_id, seq),
  foreign key (user_id, session_id) references shotloom.agent_sessions(user_id, id) on delete cascade
);
create table shotloom.agent_state (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  scope text not null,
  key text not null,
  payload jsonb not null,
  primary key (user_id, scope, key)
);
alter table shotloom.agent_sessions enable row level security;
alter table shotloom.agent_events enable row level security;
alter table shotloom.agent_state enable row level security;
revoke all on shotloom.agent_sessions, shotloom.agent_events, shotloom.agent_state from public, anon, authenticated;
grant all on shotloom.agent_sessions, shotloom.agent_events, shotloom.agent_state to service_role;

create function shotloom.agent_append(p_user_id uuid, p_id text, p_expected integer, p_events jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare stored integer;
begin
  select event_count into stored from shotloom.agent_sessions where user_id = p_user_id and id = p_id for update;
  if not found then raise exception 'Agent Session not found' using errcode = '42501'; end if;
  if stored <> p_expected then raise exception 'Agent Session revision conflict' using errcode = 'PT409'; end if;
  if jsonb_typeof(p_events) <> 'array' or exists (
    select 1 from jsonb_array_elements(p_events) with ordinality a(e,n)
      where jsonb_typeof(e) <> 'object' or (e->>'seq')::integer is distinct from p_expected + n - 1
  ) then raise exception 'Agent events must be contiguous' using errcode = '22023'; end if;
  insert into shotloom.agent_events(user_id, session_id, seq, payload)
    select p_user_id, p_id, (e->>'seq')::integer, e from jsonb_array_elements(p_events) e;
  update shotloom.agent_sessions set event_count = stored + jsonb_array_length(p_events) where user_id = p_user_id and id = p_id;
end;
$$;

create function shotloom.agent_read_events(p_user_id uuid, p_id text, p_offset integer, p_length integer default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(payload order by seq), '[]'::jsonb) from shotloom.agent_events
    where user_id = p_user_id and session_id = p_id and seq >= p_offset
      and (p_length is null or seq::bigint < p_offset::bigint + p_length);
$$;
create function shotloom.agent_list_sessions(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'header', header, 'inheritedCount', inherited_count, 'eventCount', event_count) order by id), '[]'::jsonb)
    from shotloom.agent_sessions where user_id = p_user_id;
$$;
create function shotloom.agent_list_state(p_user_id uuid, p_scope text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'payload', payload) order by key), '[]'::jsonb)
    from shotloom.agent_state where user_id = p_user_id and scope = p_scope;
$$;
revoke all on function shotloom.agent_append(uuid, text, integer, jsonb), shotloom.agent_read_events(uuid, text, integer, integer),
  shotloom.agent_list_sessions(uuid), shotloom.agent_list_state(uuid, text) from public, anon, authenticated;
grant execute on function shotloom.agent_append(uuid, text, integer, jsonb), shotloom.agent_read_events(uuid, text, integer, integer),
  shotloom.agent_list_sessions(uuid), shotloom.agent_list_state(uuid, text) to service_role;
