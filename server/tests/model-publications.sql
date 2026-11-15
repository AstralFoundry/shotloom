-- Run against Supabase with `supabase db query --remote=<ref> --file server/tests/model-publications.sql --yes`.
-- Test fixtures and mutations are rolled back, including audit rows.
begin;
do $$
declare
  test_app text := 'model-publication-test-' || gen_random_uuid();
  actor uuid;
  saved jsonb;
  audit_count integer;
begin
  insert into shotloom.users(client_id,sub) values(test_app,'test-admin') returning id into actor;
  insert into shotloom.app_admins(client_id,user_id) values(test_app,actor);
  perform shotloom.manage_models(test_app,actor,'sync','[{"id":"first","owned_by":"upstream"},{"id":"second"}]');
  assert (select count(*) = 2 from shotloom.model_publications where client_id=test_app and not published and type is null);
  saved := shotloom.manage_models(test_app,actor,'save','{"id":"first","name":"First","type":"textGeneration","template_id":"newapi-chat-completions","published":true,"sort_order":1,"revision":1}');
  assert (saved->>'revision')::integer = 2;
  select count(*) into audit_count from shotloom.admin_audit where client_id=test_app;
  begin
    perform shotloom.manage_models(test_app,actor,'save','{"id":"first","name":"Stale","type":"textGeneration","template_id":"newapi-chat-completions","published":false,"sort_order":1,"revision":1}');
    raise exception 'Expected stale revision rejection';
  exception when serialization_failure then null;
  end;
  assert (select count(*) = audit_count from shotloom.admin_audit where client_id=test_app);
  begin
    perform shotloom.manage_models(test_app || '-other',actor,'sync','[]');
    raise exception 'Expected tenant isolation rejection';
  exception when insufficient_privilege then null;
  end;
  perform shotloom.manage_models(test_app,actor,'sync','[{"id":"first","owned_by":"changed"}]');
  assert (select published and type='textGeneration' and owned_by='changed' and revision=3
    from shotloom.model_publications where client_id=test_app and id='first');
  assert (select not available from shotloom.model_publications where client_id=test_app and id='second');
  begin
    perform shotloom.manage_models(test_app,actor,'save','{"id":"first","name":"Invalid","type":null,"template_id":null,"published":true,"sort_order":1,"revision":3}');
    raise exception 'Expected publication constraint rejection';
  exception when check_violation then null;
  end;
  assert not has_table_privilege('anon','shotloom.model_publications','select');
  assert not has_table_privilege('authenticated','shotloom.app_admins','insert');
  assert not has_function_privilege('authenticated','shotloom.manage_models(text,uuid,text,jsonb)','execute');
end $$;
rollback;
select 'PASS: sync, publication constraints, revisions, audit atomicity, tenant isolation and grants' as result;
