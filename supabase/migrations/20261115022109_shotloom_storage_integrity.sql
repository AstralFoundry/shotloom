-- Application revision conflicts must not request database serialization retries.
create or replace function shotloom.save_project(p_user_id uuid, p_client_id text, p_id uuid, p_value jsonb)
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
    raise exception 'Project was changed in another window' using errcode = 'PT409';
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

-- Aggregate inside one statement to avoid PostgREST row limits and mixed graph revisions.
create function shotloom.load_project(p_user_id uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb; spec record; entries jsonb;
begin
  select payload || jsonb_build_object('storageRevision', revision) into result
    from shotloom.projects where id = p_id and user_id = p_user_id for share;
  if not found then return null; end if;
  for spec in select * from (values
    ('nodes','nodes'), ('edges','edges'), ('tasks','tasks'), ('assets','assets'), ('materials','materials'),
    ('conversations','harnessSessions'), ('production_plans','productionPlans'),
    ('agent_batches','agentBatches'), ('agent_evaluations','agentEvaluations')
  ) as s(tbl, key) loop
    execute format('select coalesce(jsonb_agg(payload order by position), ''[]''::jsonb) from shotloom.%I where project_id = $1', spec.tbl)
      into entries using p_id;
    result := result || jsonb_build_object(spec.key, entries);
  end loop;
  return result || jsonb_build_object(
    'canvasHistory', (select coalesce(jsonb_agg(payload order by position), '[]'::jsonb) from shotloom.canvas_history where project_id = p_id and stack = 'undo'),
    'canvasRedoStack', (select coalesce(jsonb_agg(payload order by position), '[]'::jsonb) from shotloom.canvas_history where project_id = p_id and stack = 'redo'));
end $$;
revoke all on function shotloom.load_project(uuid, uuid) from public, anon, authenticated;
grant execute on function shotloom.load_project(uuid, uuid) to service_role;

-- Metadata and rows are one transaction; validation failures preserve the old catalog.
create function shotloom.save_catalog(p_user_id uuid, p_kind text, p_value jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare spec record; entries jsonb;
begin
  if p_kind not in ('skills','recipes','assets','materials') or jsonb_typeof(p_value) <> 'object' then
    raise exception 'Invalid catalog' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/catalog', 0));
  for spec in select * from (values ('skills','skills'), ('recipes','recipes'),
    ('catalog_assets','assets'), ('catalog_materials','materials')) as s(tbl, key)
    where key = p_kind or (p_kind = 'assets' and key = 'materials') loop
    entries := coalesce(p_value->spec.key, '[]'::jsonb);
    if jsonb_typeof(entries) <> 'array' or exists (
      select 1 from jsonb_array_elements(entries) e where jsonb_typeof(e) <> 'object' or coalesce(e->>'id','') = '') then
      raise exception 'Catalog % requires records with stable ids', spec.key using errcode = '22023';
    end if;
    execute format('delete from shotloom.%I where user_id = $1', spec.tbl) using p_user_id;
    execute format('insert into shotloom.%I (user_id,id,position,payload) select $1,e->>''id'',n-1,e from jsonb_array_elements($2) with ordinality a(e,n)', spec.tbl)
      using p_user_id, entries;
    insert into shotloom.catalog_metadatas(user_id, scope, payload)
      values(p_user_id, spec.key, case when spec.key = p_kind then p_value - array['skills','recipes','assets','materials'] else '{}'::jsonb end)
      on conflict(user_id,scope) do update set payload = excluded.payload;
  end loop;
end $$;
revoke all on function shotloom.save_catalog(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function shotloom.save_catalog(uuid, text, jsonb) to service_role;

create function shotloom.load_catalog(p_user_id uuid, p_kind text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb; spec record; entries jsonb;
begin
  if p_kind not in ('skills','recipes','assets','materials') then raise exception 'Invalid catalog' using errcode = '22023'; end if;
  select payload into result from shotloom.catalog_metadatas where user_id = p_user_id and scope = p_kind;
  if not found then return null; end if;
  for spec in select * from (values ('skills','skills'), ('recipes','recipes'),
    ('catalog_assets','assets'), ('catalog_materials','materials')) as s(tbl, key)
    where key = p_kind or (p_kind = 'assets' and key = 'materials') loop
    execute format('select coalesce(jsonb_agg(payload order by position), ''[]''::jsonb) from shotloom.%I where user_id = $1', spec.tbl)
      into entries using p_user_id;
    result := result || jsonb_build_object(spec.key, entries);
  end loop;
  return result;
end $$;
revoke all on function shotloom.load_catalog(uuid, text) from public, anon, authenticated;
grant execute on function shotloom.load_catalog(uuid, text) to service_role;
notify pgrst, 'reload schema';

