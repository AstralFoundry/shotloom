create table shotloom.app_admins (
  client_id text not null,
  user_id uuid not null references shotloom.users(id) on delete cascade,
  primary key (client_id, user_id)
);
create table shotloom.model_publications (
  client_id text not null,
  id text not null check (length(btrim(id)) > 0),
  owned_by text not null default '',
  supported_endpoint_types jsonb not null default '[]' check (jsonb_typeof(supported_endpoint_types) = 'array'),
  available boolean not null default true,
  name text not null default '',
  type text check (type in ('textGeneration','imageGeneration','videoGeneration','audioGeneration')),
  template_id text,
  sort_order integer not null default 0,
  published boolean not null default false,
  revision integer not null default 1,
  primary key (client_id, id),
  check (not published or (type is not null and template_id is not null and length(btrim(name)) > 0))
);
create table shotloom.admin_audit (
  id bigint generated always as identity primary key,
  client_id text not null,
  actor_id uuid not null references shotloom.users(id),
  action text not null,
  model_id text,
  details jsonb not null,
  created_at timestamptz not null default now()
);
alter table shotloom.app_admins enable row level security;
alter table shotloom.model_publications enable row level security;
alter table shotloom.admin_audit enable row level security;
revoke all on shotloom.app_admins, shotloom.model_publications, shotloom.admin_audit from public, anon, authenticated;
grant select, insert, update, delete on shotloom.app_admins, shotloom.model_publications to service_role;
grant select, insert on shotloom.admin_audit to service_role;
grant usage, select on sequence shotloom.admin_audit_id_seq to service_role;

-- One app lock serializes sync and saves; each mutation and its audit commit together.
create function shotloom.manage_models(p_client_id text, p_actor_id uuid, p_action text, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item jsonb; saved shotloom.model_publications; result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id, 0));
  if not exists (select 1 from shotloom.app_admins a join shotloom.users u on u.id = a.user_id
    where a.client_id = p_client_id and a.user_id = p_actor_id and u.client_id = p_client_id) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_action = 'sync' then
    update shotloom.model_publications set available = false, revision = revision + 1 where client_id = p_client_id;
    for item in select value from jsonb_array_elements(p_value) loop
      insert into shotloom.model_publications(client_id,id,owned_by,supported_endpoint_types)
        values(p_client_id,item->>'id',coalesce(item->>'owned_by',''),coalesce(item->'supported_endpoint_types','[]'))
      on conflict(client_id,id) do update set available = true, owned_by = excluded.owned_by,
        supported_endpoint_types = excluded.supported_endpoint_types;
    end loop;
    result := jsonb_build_object('count',jsonb_array_length(p_value));
  elsif p_action = 'save' then
    update shotloom.model_publications set name = p_value->>'name', type = p_value->>'type',
      template_id = p_value->>'template_id', sort_order = (p_value->>'sort_order')::integer,
      published = (p_value->>'published')::boolean, revision = revision + 1
      where client_id = p_client_id and id = p_value->>'id' and revision = (p_value->>'revision')::integer
      returning * into saved;
    if not found then raise exception 'MODEL_CONFLICT' using errcode = '40001'; end if;
    result := to_jsonb(saved) - 'client_id';
  else raise exception 'INVALID_ACTION'; end if;
  insert into shotloom.admin_audit(client_id,actor_id,action,model_id,details)
    values(p_client_id,p_actor_id,p_action,p_value->>'id',p_value);
  return result;
end $$;
revoke all on function shotloom.manage_models(text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function shotloom.manage_models(text,uuid,text,jsonb) to service_role;
