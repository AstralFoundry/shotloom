-- BFF-only schema. Application identity comes from the verified new-api subject.
alter table shotloom.users drop constraint users_sub_key;
alter table shotloom.users add constraint users_app_subject_key unique (client_id, sub);

revoke all on schema shotloom from public, anon, authenticated;
grant usage on schema shotloom to service_role;
grant all on all tables in schema shotloom to service_role;
alter default privileges in schema shotloom revoke execute on functions from public;

-- Derive tenant columns from existing foreign keys, never from a client claim.
create function shotloom.set_client_id() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if to_jsonb(new) ? 'user_id' then
    select client_id into new.client_id from shotloom.users where id = new.user_id;
  else
    select client_id into new.client_id from shotloom.projects where id = new.project_id;
  end if;
  return new;
end $$;
revoke all on function shotloom.set_client_id() from public, anon, authenticated;
grant execute on function shotloom.set_client_id() to service_role;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'shotloom' and tablename <> 'users'
  order by (tablename = 'projects') desc loop
    execute format('alter table shotloom.%I add column client_id text', t);
    if exists (select 1 from information_schema.columns where table_schema = 'shotloom' and table_name = t and column_name = 'user_id') then
      execute format('update shotloom.%I r set client_id = u.client_id from shotloom.users u where u.id = r.user_id', t);
    else
      execute format('update shotloom.%I r set client_id = p.client_id from shotloom.projects p where p.id = r.project_id', t);
    end if;
    execute format('alter table shotloom.%I alter column client_id set not null', t);
    execute format('create trigger tenant_binding before insert or update on shotloom.%I for each row execute function shotloom.set_client_id()', t);
    execute format('create index on shotloom.%I (client_id)', t);
  end loop;
end $$;

-- One RPC makes the revision check and the entire graph commit atomic.
create function shotloom.save_project(p_user_id uuid, p_client_id text, p_id uuid, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  existing shotloom.projects;
  spec record;
  entries jsonb;
  revision bigint;
begin
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Project must be an object' using errcode = '22023'; end if;
  if not exists (select 1 from shotloom.users where id = p_user_id and client_id = p_client_id) then
    raise exception 'Invalid application owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into existing from shotloom.projects where id = p_id for update;
  if found and (existing.user_id <> p_user_id or existing.client_id <> p_client_id) then
    raise exception 'Project not found' using errcode = '42501';
  end if;
  revision := coalesce(existing.revision, 0);
  if coalesce((p_value->>'storageRevision')::bigint, 0) <> revision then
    raise exception 'Project was changed in another window' using errcode = '40001';
  end if;
  revision := revision + 1;
  insert into shotloom.projects (id, user_id, name, revision, payload)
    values (p_id, p_user_id, coalesce(p_value->>'name', ''), revision,
      p_value - array['nodes','edges','tasks','assets','materials','harnessSessions','productionPlans','agentBatches','agentEvaluations','canvasHistory','canvasRedoStack','storageRevision'])
    on conflict (id) do update set name = excluded.name, revision = excluded.revision, payload = excluded.payload, updated_at = now();
  for spec in select * from (values
    ('nodes','nodes'), ('edges','edges'), ('tasks','tasks'), ('assets','assets'), ('materials','materials'),
    ('conversations','harnessSessions'), ('production_plans','productionPlans'),
    ('agent_batches','agentBatches'), ('agent_evaluations','agentEvaluations')
  ) as s(tbl, key) loop
    entries := coalesce(p_value->spec.key, '[]'::jsonb);
    if jsonb_typeof(entries) <> 'array' then raise exception 'Invalid collection %', spec.key using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(entries) e where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') = '') then
      raise exception 'Collection % requires stable ids', spec.key using errcode = '22023';
    end if;
    execute format('delete from shotloom.%I where project_id = $1', spec.tbl) using p_id;
    execute format('insert into shotloom.%I (project_id, id, position, payload) select $1, e->>''id'', n-1, e from jsonb_array_elements($2) with ordinality a(e,n)', spec.tbl) using p_id, entries;
  end loop;
  delete from shotloom.canvas_history where project_id = p_id;
  insert into shotloom.canvas_history (project_id, stack, position, payload)
    select p_id, 'undo', n-1, e from jsonb_array_elements(coalesce(p_value->'canvasHistory', '[]'::jsonb)) with ordinality a(e,n)
    union all
    select p_id, 'redo', n-1, e from jsonb_array_elements(coalesce(p_value->'canvasRedoStack', '[]'::jsonb)) with ordinality a(e,n);
  return p_value || jsonb_build_object('storageRevision', revision);
end $$;
revoke all on function shotloom.save_project(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function shotloom.save_project(uuid, text, uuid, jsonb) to service_role;

create function shotloom.save_settings(p_user_id uuid, p_value jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Settings must be an object' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/settings', 0));
  delete from shotloom.settings where user_id = p_user_id and key <> 'downloadDirectory';
  insert into shotloom.settings (user_id, key, payload)
    select p_user_id, key, value from jsonb_each(p_value) where key <> 'downloadDirectory';
end $$;
revoke all on function shotloom.save_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function shotloom.save_settings(uuid, jsonb) to service_role;

update storage.buckets set allowed_mime_types = array['image/*','video/*','audio/*','application/json','application/pdf','application/zip','application/octet-stream'],
  public = false where id in ('shotloom-media', 'shotloom-assets');

-- Expose only this service-role protected schema, preserving all existing APIs.
do $$ declare schemas text; begin
  select coalesce(rolconfig::text, '') into schemas from pg_roles where rolname = 'authenticator';
  select setting into schemas from pg_db_role_setting s cross join lateral unnest(s.setconfig) setting
    where s.setrole = (select oid from pg_roles where rolname = 'authenticator') and setting like 'pgrst.db_schemas=%' limit 1;
  schemas := coalesce(nullif(split_part(schemas, '=', 2), ''), 'public, storage, graphql_public');
  if not 'shotloom' = any(string_to_array(replace(schemas, ' ', ''), ',')) then
    execute format('alter role authenticator set pgrst.db_schemas = %L', schemas || ', shotloom');
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
