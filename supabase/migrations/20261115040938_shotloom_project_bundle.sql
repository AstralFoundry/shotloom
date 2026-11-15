-- Portable project imports are new records; graph and editor data commit together.
create function shotloom.load_project_bundle(p_user_id uuid, p_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'project', shotloom.load_project(p_user_id, p_id),
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object('nodeId', node_id, 'payload', payload) order by node_id)
      from shotloom.editor_snapshots where project_id = p_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('nodeId', node_id, 'key', key, 'payload', payload) order by node_id, key)
      from shotloom.editor_records where project_id = p_id), '[]'::jsonb)
  ) end from (select id from shotloom.projects where id = p_id and user_id = p_user_id) p;
$$;

create function shotloom.import_project_bundle(p_user_id uuid, p_client_id text, p_id uuid, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved jsonb; snapshots jsonb; records jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  if exists (select 1 from shotloom.projects where id = p_id) then
    raise exception 'Import requires a new project id' using errcode = 'PT409';
  end if;
  snapshots := coalesce(p_value->'snapshots', '[]'::jsonb);
  records := coalesce(p_value->'records', '[]'::jsonb);
  if jsonb_typeof(snapshots) <> 'array' or jsonb_typeof(records) <> 'array' then
    raise exception 'Invalid editor collections' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(snapshots) e where coalesce(e->>'nodeId', '') = '' or not (e ? 'payload'))
    or exists (select 1 from jsonb_array_elements(records) e where coalesce(e->>'nodeId', '') = '' or coalesce(e->>'key', '') = '' or not (e ? 'payload')) then
    raise exception 'Editor records require nodeId, key and payload' using errcode = '22023';
  end if;
  saved := shotloom.save_project(p_user_id, p_client_id, p_id,
    (p_value->'project') || jsonb_build_object('id', p_id, 'storageRevision', 0));
  insert into shotloom.editor_snapshots (project_id, node_id, payload)
    select p_id, e->>'nodeId', e->'payload' from jsonb_array_elements(snapshots) e;
  insert into shotloom.editor_records (project_id, node_id, key, payload)
    select p_id, e->>'nodeId', e->>'key', e->'payload' from jsonb_array_elements(records) e;
  return saved;
end $$;

revoke all on function shotloom.load_project_bundle(uuid, uuid) from public, anon, authenticated;
revoke all on function shotloom.import_project_bundle(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function shotloom.load_project_bundle(uuid, uuid) to service_role;
grant execute on function shotloom.import_project_bundle(uuid, text, uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
