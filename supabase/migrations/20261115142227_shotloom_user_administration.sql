create function shotloom.list_admin_users(p_client_id text, p_actor_id uuid, p_query text, p_offset integer, p_limit integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not exists (select 1 from shotloom.app_admins a join shotloom.users u on u.id=a.user_id
    where a.client_id=p_client_id and a.user_id=p_actor_id and u.client_id=p_client_id) then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  if p_offset < 0 or p_limit < 1 or p_limit > 100 or p_query is null or length(p_query) > 200 then
    raise exception 'INVALID_PAGINATION' using errcode='22023';
  end if;
  with matching as materialized (
    select u.id,u.sub,u.username,u.email,u.created_at,u.updated_at,(a.user_id is not null) as is_admin
    from shotloom.users u left join shotloom.app_admins a on a.client_id=u.client_id and a.user_id=u.id
    where u.client_id=p_client_id and (p_query='' or strpos(lower(coalesce(u.username,'')),lower(p_query)) > 0
      or strpos(lower(coalesce(u.email,'')),lower(p_query)) > 0 or strpos(u.sub,p_query) > 0)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id)
    from (select * from matching order by created_at desc,id offset p_offset limit p_limit) page),'[]'::jsonb),
    'total',(select count(*) from matching)) into result;
  return result;
end $$;

create function shotloom.set_app_admin(p_client_id text, p_actor_id uuid, p_user_id uuid, p_is_admin boolean, p_expected_admin boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare was_admin boolean;
begin
  -- Share the model-management lock so a revoked administrator cannot commit another mutation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id,0));
  if not exists (select 1 from shotloom.app_admins a join shotloom.users u on u.id=a.user_id
    where a.client_id=p_client_id and a.user_id=p_actor_id and u.client_id=p_client_id) then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  if not exists (select 1 from shotloom.users where id=p_user_id and client_id=p_client_id) then
    raise exception 'USER_NOT_FOUND' using errcode='P0002';
  end if;
  if p_is_admin is null or p_expected_admin is null then raise exception 'INVALID_ROLE' using errcode='22023'; end if;
  select exists(select 1 from shotloom.app_admins where client_id=p_client_id and user_id=p_user_id) into was_admin;
  if was_admin <> p_expected_admin then raise exception 'ROLE_CONFLICT' using errcode='40001'; end if;
  if was_admin = p_is_admin then return jsonb_build_object('id',p_user_id,'is_admin',was_admin); end if;
  if p_is_admin then
    insert into shotloom.app_admins(client_id,user_id) values(p_client_id,p_user_id);
  else
    if (select count(*) from shotloom.app_admins a join shotloom.users u on u.id=a.user_id and u.client_id=a.client_id
      where a.client_id=p_client_id) <= 1 then raise exception 'LAST_ADMIN' using errcode='23514'; end if;
    delete from shotloom.app_admins where client_id=p_client_id and user_id=p_user_id;
  end if;
  insert into shotloom.admin_audit(client_id,actor_id,action,details)
    values(p_client_id,p_actor_id,case when p_is_admin then 'grant_admin' else 'revoke_admin' end,
      jsonb_build_object('user_id',p_user_id,'before',was_admin,'after',p_is_admin));
  return jsonb_build_object('id',p_user_id,'is_admin',p_is_admin);
end $$;
revoke all on function shotloom.list_admin_users(text,uuid,text,integer,integer),
  shotloom.set_app_admin(text,uuid,uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function shotloom.list_admin_users(text,uuid,text,integer,integer),
  shotloom.set_app_admin(text,uuid,uuid,boolean,boolean) to service_role;
