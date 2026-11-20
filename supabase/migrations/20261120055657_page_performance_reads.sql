-- Additive APIs: old clients retain full settings replacement and inbox reads.
create function shotloom.patch_settings(p_user_id uuid, p_value jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Settings must be an object' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/settings', 0));
  insert into shotloom.settings(user_id, key, payload)
    select p_user_id, key, value from jsonb_each(p_value)
    on conflict(user_id, key) do update set payload = excluded.payload;
  select coalesce(jsonb_object_agg(key, payload), '{}'::jsonb) into result
    from shotloom.settings where user_id = p_user_id
      and key not in ('providerConfigs','upstreamModels','rawQuota','usedQuota','balance','apiKeyValid','accountSyncError','projectRootDir','downloadDirectory');
  return result;
end $$;
revoke all on function shotloom.patch_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function shotloom.patch_settings(uuid, jsonb) to service_role;

create function shotloom.unread_notifications(p_user_id uuid, p_client_id text) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('unread', count(*)) from shotloom.inbox_notifications
    where user_id = p_user_id and client_id = p_client_id and read_at is null;
$$;
revoke all on function shotloom.unread_notifications(uuid, text) from public, anon, authenticated;
grant execute on function shotloom.unread_notifications(uuid, text) to service_role;

create function shotloom.check_media_objects(p_user_id uuid, p_client_id text, p_objects jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb; prefix text := p_client_id || '/' || p_user_id::text || '/';
begin
  if not exists(select 1 from shotloom.users where id=p_user_id and client_id=p_client_id) then
    raise exception 'Invalid owner' using errcode='42501';
  end if;
  if jsonb_typeof(p_objects) <> 'array' or jsonb_array_length(p_objects)>200
    or exists(select 1 from jsonb_array_elements(p_objects) e where left(e->>'key',length(prefix)) is distinct from prefix) then
    raise exception 'Invalid object scope' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',e->>'bucket','key',e->>'key',
    'status',case when o.name is null then 'missing' else 'exists' end) order by n),'[]'::jsonb)
    into result from jsonb_array_elements(p_objects) with ordinality a(e,n)
    left join storage.objects o on o.bucket_id=e->>'bucket' and o.name=e->>'key';
  return result;
end $$;
revoke all on function shotloom.check_media_objects(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function shotloom.check_media_objects(uuid,text,jsonb) to service_role;

create function shotloom.list_project_page(p_user_id uuid,p_folder_id uuid,p_search text,p_sort text,p_offset integer,p_limit integer) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_offset<0 or p_limit<1 or p_limit>100 or p_sort not in ('updated','created','name') then raise exception 'Invalid page' using errcode='22023'; end if;
  with matching as (
    select id,name,revision,folder_id,created_at,updated_at,payload->>'coverSource' as cover
      from shotloom.projects where user_id=p_user_id and folder_id is not distinct from p_folder_id
        and (p_search='' or strpos(lower(name),lower(p_search))>0)
  ), page as (
    select *,row_number() over(order by case when p_sort='name' then lower(name) end asc,
      case when p_sort='updated' then updated_at end desc,case when p_sort='created' then created_at end desc,id) as n
      from matching order by n offset p_offset limit p_limit
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,
      'storageRevision',revision,'cloudFolderId',folder_id,'createdAt',created_at,'updatedAt',updated_at,'coverSource',cover) order by n) from page),'[]'::jsonb),
      'total',(select count(*) from matching),'offset',p_offset,'limit',p_limit) into result;
  return result;
end $$;
revoke all on function shotloom.list_project_page(uuid,uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function shotloom.list_project_page(uuid,uuid,text,text,integer,integer) to service_role;

create function shotloom.rename_project(p_user_id uuid,p_id uuid,p_name text,p_expected bigint) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select p.revision into current_revision from shotloom.projects p where id=p_id and user_id=p_user_id for update;
  if not found then raise exception 'Project not found' using errcode='42501'; end if;
  if current_revision<>p_expected then raise exception 'Project changed' using errcode='PT409'; end if;
  update shotloom.projects set name=p_name,payload=jsonb_set(payload,'{name}',to_jsonb(p_name)),revision=current_revision+1,updated_at=now() where id=p_id;
  return jsonb_build_object('id',p_id,'name',p_name,'storageRevision',current_revision+1);
end $$;
revoke all on function shotloom.rename_project(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function shotloom.rename_project(uuid,uuid,text,bigint) to service_role;
