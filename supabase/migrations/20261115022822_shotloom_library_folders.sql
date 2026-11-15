create table shotloom.library_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shotloom.users(id) on delete cascade,
  client_id text not null,
  parent_id uuid,
  name text not null check (length(trim(name)) > 0),
  unique (user_id, id),
  foreign key (user_id, parent_id) references shotloom.library_folders(user_id, id) on delete cascade
);
create trigger tenant_binding before insert or update on shotloom.library_folders
  for each row execute function shotloom.set_client_id();
alter table shotloom.library_folders enable row level security;
revoke all on shotloom.library_folders from public, anon, authenticated;
grant all on shotloom.library_folders to service_role;
alter table shotloom.projects add column folder_id uuid;
alter table shotloom.projects add foreign key (user_id, folder_id)
  references shotloom.library_folders(user_id, id) on delete cascade;
create index on shotloom.library_folders(user_id, parent_id);
create index on shotloom.projects(user_id, folder_id);

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
  insert into shotloom.projects (id, user_id, name, revision, folder_id, payload)
    values (p_id, p_user_id, coalesce(p_value->>'name', ''), revision, nullif(p_value->>'cloudFolderId', '')::uuid,
      p_value - array['nodes','edges','tasks','assets','materials','harnessSessions','productionPlans','agentBatches','agentEvaluations','canvasHistory','canvasRedoStack','storageRevision'])
    on conflict (id) do update set name = excluded.name, revision = excluded.revision, payload = excluded.payload, folder_id = excluded.folder_id, updated_at = now();
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

create function shotloom.list_projects(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(payload || jsonb_build_object('id', id, 'name', name, 'storageRevision', revision, 'updatedAt', updated_at)
    order by updated_at desc, id), '[]'::jsonb) from shotloom.projects where user_id = p_user_id
$$;
create function shotloom.list_library_folders(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'parentId',parent_id,'name',name) order by name,id), '[]'::jsonb)
    from shotloom.library_folders where user_id = p_user_id
$$;
revoke all on function shotloom.list_projects(uuid), shotloom.list_library_folders(uuid) from public, anon, authenticated;
grant execute on function shotloom.list_projects(uuid), shotloom.list_library_folders(uuid) to service_role;
notify pgrst, 'reload schema';
