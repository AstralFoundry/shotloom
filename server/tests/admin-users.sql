-- Run on Supabase with `supabase db query --remote=<ref> --file server/tests/admin-users.sql --yes`.
begin;
do $$
declare
  test_app text := 'admin-user-test-' || gen_random_uuid();
  owner_id uuid;
  target_id uuid;
  outsider_id uuid;
  users_page jsonb;
begin
  insert into shotloom.users(client_id,sub,username,email) values(test_app,'1','owner','owner@example.com') returning id into owner_id;
  insert into shotloom.users(client_id,sub,username,email) values(test_app,'2','member','member@example.com') returning id into target_id;
  insert into shotloom.users(client_id,sub,username,email) values(test_app || '-other','2','other','member@example.com') returning id into outsider_id;
  insert into shotloom.app_admins(client_id,user_id) values(test_app,owner_id);
  begin
    perform shotloom.list_admin_users(test_app,target_id,'',0,20);
    raise exception 'Expected non-admin rejection';
  exception when insufficient_privilege then null;
  end;
  users_page := shotloom.list_admin_users(test_app,owner_id,'MEMBER@EXAMPLE.COM',0,20);
  assert (users_page->>'total')::integer=1;
  assert users_page->'items'->0->>'id'=target_id::text;
  assert not (users_page->'items'->0 ? 'client_id');
  users_page := shotloom.list_admin_users(test_app,owner_id,'',20,20);
  assert (users_page->>'total')::integer=2 and jsonb_array_length(users_page->'items')=0;
  assert (shotloom.list_admin_users(test_app,owner_id,'a),id.eq.x',0,20)->>'total')::integer=0;
  begin
    perform shotloom.set_app_admin(test_app,owner_id,owner_id,false,true);
    raise exception 'Expected last-admin protection';
  exception when check_violation then null;
  end;
  begin
    perform shotloom.set_app_admin(test_app,owner_id,outsider_id,true,false);
    raise exception 'Expected target tenant isolation';
  exception when no_data_found then null;
  end;
  perform shotloom.set_app_admin(test_app,owner_id,target_id,true,false);
  assert exists(select 1 from shotloom.app_admins where client_id=test_app and user_id=target_id);
  begin
    perform shotloom.set_app_admin(test_app,owner_id,target_id,false,false);
    raise exception 'Expected stale-role rejection';
  exception when serialization_failure then null;
  end;
  perform shotloom.set_app_admin(test_app,target_id,owner_id,false,true);
  begin
    perform shotloom.set_app_admin(test_app,owner_id,owner_id,true,false);
    raise exception 'Expected revoked-actor rejection';
  exception when insufficient_privilege then null;
  end;
  begin
    perform shotloom.manage_models(test_app,owner_id,'sync','[]');
    raise exception 'Expected revoked-actor model mutation rejection';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*)=2 from shotloom.admin_audit where client_id=test_app);
  assert exists(select 1 from shotloom.admin_audit where client_id=test_app and action='grant_admin'
    and details->>'user_id'=target_id::text and (details->>'after')::boolean);
  assert not has_function_privilege('authenticated','shotloom.set_app_admin(text,uuid,uuid,boolean,boolean)','execute');
  assert not has_function_privilege('anon','shotloom.list_admin_users(text,uuid,text,integer,integer)','execute');
end $$;
rollback;
select 'PASS: user search, pagination, role grants, revocation, last-admin protection, stale roles, audit and tenant isolation' as result;
