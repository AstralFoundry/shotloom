create table shotloom.feedback (
  id uuid primary key,
  client_id text not null,
  user_id uuid not null references shotloom.users(id) on delete cascade,
  kind text not null check (kind in ('feedback', 'report')),
  description text not null check (length(btrim(description)) between 1 and 10000),
  reference text not null default '' check (length(reference) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'processing', 'resolved')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_user_created on shotloom.feedback(client_id, user_id, created_at desc, id);
create index feedback_admin_created on shotloom.feedback(client_id, created_at desc, id);

create table shotloom.feedback_replies (
  id uuid primary key,
  feedback_id uuid not null references shotloom.feedback(id) on delete cascade,
  actor_id uuid not null references shotloom.users(id),
  body text not null check (length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index feedback_replies_parent on shotloom.feedback_replies(feedback_id, created_at, id);

create table shotloom.inbox_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  user_id uuid not null references shotloom.users(id) on delete cascade,
  feedback_id uuid not null references shotloom.feedback(id) on delete cascade,
  reply_id uuid not null unique references shotloom.feedback_replies(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index inbox_user_created on shotloom.inbox_notifications(client_id, user_id, created_at desc, id);
create index inbox_user_unread on shotloom.inbox_notifications(client_id, user_id) where read_at is null;

alter table shotloom.feedback enable row level security;
alter table shotloom.feedback_replies enable row level security;
alter table shotloom.inbox_notifications enable row level security;
revoke all on shotloom.feedback, shotloom.feedback_replies, shotloom.inbox_notifications from public, anon, authenticated;
grant select, insert, update, delete on shotloom.feedback, shotloom.feedback_replies, shotloom.inbox_notifications to service_role;

-- A reply, its notification and audit entry commit together. Retrying with the same ID is safe.
create function shotloom.support_action(p_client_id text, p_actor_id uuid, p_action text, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item shotloom.feedback;
  reply shotloom.feedback_replies;
  result jsonb;
  page_offset integer;
  page_limit integer;
  boundary timestamptz;
begin
  if not exists(select 1 from shotloom.users where id=p_actor_id and client_id=p_client_id) then
    raise exception 'USER_NOT_FOUND' using errcode='42501';
  end if;
  if p_action in ('admin_list', 'admin_detail', 'reply', 'status') then
    -- Share the administrator mutation lock with role revocation.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_client_id,0));
    if not exists(select 1 from shotloom.app_admins where client_id=p_client_id and user_id=p_actor_id) then
      raise exception 'ADMIN_REQUIRED' using errcode='42501';
    end if;
  end if;
  if p_action in ('list', 'admin_list', 'inbox') then
    page_offset := (p_value->>'offset')::integer;
    page_limit := (p_value->>'limit')::integer;
    if page_offset is null or page_limit is null or page_offset < 0 or page_limit not between 1 and 100 then
      raise exception 'INVALID_PAGINATION' using errcode='22023';
    end if;
  end if;
  if p_action='submit' then
    insert into shotloom.feedback(id,client_id,user_id,kind,description,reference)
      values((p_value->>'id')::uuid,p_client_id,p_actor_id,p_value->>'kind',p_value->>'description',coalesce(p_value->>'reference',''))
      on conflict(id) do nothing;
    select * into item from shotloom.feedback where id=(p_value->>'id')::uuid and client_id=p_client_id and user_id=p_actor_id;
    if not found or item.kind <> p_value->>'kind' or item.description <> p_value->>'description'
      or item.reference <> coalesce(p_value->>'reference','') then
      raise exception 'REQUEST_ID_REUSED' using errcode='40001';
    end if;
    return to_jsonb(item)-'client_id';
  elsif p_action in ('list','admin_list') then
    with matching as materialized (
      select * from shotloom.feedback where client_id=p_client_id and (p_action='admin_list' or user_id=p_actor_id)
        and (coalesce(p_value->>'kind','')='' or kind=p_value->>'kind')
        and (coalesce(p_value->>'status','')='' or status=p_value->>'status')
    ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)-'client_id' order by p.created_at desc,p.id)
        from (select * from matching order by created_at desc,id offset page_offset limit page_limit) p),'[]'::jsonb),
      'total',(select count(*) from matching)) into result;
    return result;
  elsif p_action in ('detail','admin_detail','reply','status') then
    select * into item from shotloom.feedback where id=(p_value->>'id')::uuid and client_id=p_client_id
      and (p_action <> 'detail' or user_id=p_actor_id) for update;
    if not found then raise exception 'FEEDBACK_NOT_FOUND' using errcode='P0002'; end if;
    if p_action in ('detail','admin_detail') then
      return jsonb_build_object('item',to_jsonb(item)-'client_id','replies',
        coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from shotloom.feedback_replies r where feedback_id=item.id),'[]'::jsonb));
    end if;
    if p_action='reply' then
      select * into reply from shotloom.feedback_replies where id=(p_value->>'replyId')::uuid;
      if found then
        if reply.feedback_id <> item.id or reply.actor_id <> p_actor_id or reply.body <> p_value->>'body' then
          raise exception 'REQUEST_ID_REUSED' using errcode='40001';
        end if;
        return to_jsonb(reply);
      end if;
      insert into shotloom.feedback_replies(id,feedback_id,actor_id,body)
        values((p_value->>'replyId')::uuid,item.id,p_actor_id,p_value->>'body') returning * into reply;
      insert into shotloom.inbox_notifications(client_id,user_id,feedback_id,reply_id,body)
        values(p_client_id,item.user_id,item.id,reply.id,reply.body);
      update shotloom.feedback set updated_at=now(),revision=revision+1 where id=item.id;
      result := to_jsonb(reply);
    else
      if item.revision <> (p_value->>'revision')::integer or p_value->>'revision' is null then
        raise exception 'FEEDBACK_CONFLICT' using errcode='40001';
      end if;
      update shotloom.feedback set status=p_value->>'status',revision=revision+1,updated_at=now()
        where id=item.id returning * into item;
      result := to_jsonb(item)-'client_id';
    end if;
    insert into shotloom.admin_audit(client_id,actor_id,action,details)
      values(p_client_id,p_actor_id,'feedback_' || p_action,jsonb_build_object('feedback_id',item.id,'reply_id',reply.id,'status',item.status));
    return result;
  elsif p_action='inbox' then
    boundary := now();
    with matching as materialized (
      select id,feedback_id,reply_id,body,created_at,read_at from shotloom.inbox_notifications
        where client_id=p_client_id and user_id=p_actor_id and created_at<=boundary
    ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id)
        from (select * from matching order by created_at desc,id offset page_offset limit page_limit) p),'[]'::jsonb),
      'total',(select count(*) from matching),'unread',(select count(*) from matching where read_at is null),'asOf',boundary) into result;
    return result;
  elsif p_action='read' then
    update shotloom.inbox_notifications set read_at=coalesce(read_at,now())
      where id=(p_value->>'id')::uuid and client_id=p_client_id and user_id=p_actor_id;
    if not found then raise exception 'NOTIFICATION_NOT_FOUND' using errcode='P0002'; end if;
    return '{}'::jsonb;
  elsif p_action='read_all' then
    boundary := (p_value->>'asOf')::timestamptz;
    if boundary is null or boundary > now() then raise exception 'INVALID_BOUNDARY' using errcode='22023'; end if;
    update shotloom.inbox_notifications set read_at=now()
      where client_id=p_client_id and user_id=p_actor_id and read_at is null and created_at<=boundary;
    return '{}'::jsonb;
  end if;
  raise exception 'INVALID_ACTION' using errcode='22023';
end $$;
revoke all on function shotloom.support_action(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function shotloom.support_action(text,uuid,text,jsonb) to service_role;
