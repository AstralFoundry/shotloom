-- One user revision covers assets/materials, which share underlying tables.
create table shotloom.catalog_revisions (
  user_id uuid primary key references shotloom.users(id) on delete cascade,
  revision bigint not null default 0
);
alter table shotloom.catalog_revisions enable row level security;
revoke all on shotloom.catalog_revisions from public, anon, authenticated;
grant all on shotloom.catalog_revisions to service_role;
create function shotloom.bump_catalog_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into shotloom.catalog_revisions(user_id,revision) values(new.user_id,1)
    on conflict(user_id) do update set revision=shotloom.catalog_revisions.revision+1;
  return new;
end $$;
revoke all on function shotloom.bump_catalog_revision() from public,anon,authenticated;
grant execute on function shotloom.bump_catalog_revision() to service_role;
create trigger catalog_revision after insert or update on shotloom.catalog_metadatas
  for each row execute function shotloom.bump_catalog_revision();

create function shotloom.read_catalog_versioned(p_user_id uuid,p_kind text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/catalog',0));
  return jsonb_build_object('catalog',shotloom.load_catalog(p_user_id,p_kind),
    'revision',coalesce((select revision from shotloom.catalog_revisions where user_id=p_user_id),0));
end $$;
revoke all on function shotloom.read_catalog_versioned(uuid,text) from public,anon,authenticated;
grant execute on function shotloom.read_catalog_versioned(uuid,text) to service_role;

-- Apply only changed rows. Legacy whole-directory writes take the same advisory lock.
create function shotloom.patch_catalog(p_user_id uuid,p_kind text,p_expected bigint,p_changes jsonb,p_metadata jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint; spec record; change jsonb; item jsonb; next_position integer;
begin
  if p_kind not in ('skills','recipes','assets','materials') or jsonb_typeof(p_changes)<>'object' or jsonb_typeof(p_metadata)<>'object' then
    raise exception 'Invalid catalog patch' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/catalog',0));
  select coalesce((select revision from shotloom.catalog_revisions where user_id=p_user_id),0) into current_revision;
  if current_revision<>p_expected then raise exception 'Catalog changed; refresh before saving' using errcode='PT409'; end if;
  if exists(select 1 from jsonb_object_keys(p_changes) k where k<>p_kind and not(p_kind='assets' and k='materials')) then
    raise exception 'Invalid collection' using errcode='22023';
  end if;
  for spec in select * from (values ('skills','skills'),('recipes','recipes'),('assets','catalog_assets'),('materials','catalog_materials')) s(key,tbl)
    where p_changes ? key loop
    change:=p_changes->spec.key;
    if jsonb_typeof(change)<>'object' or jsonb_typeof(change->'upsert') is distinct from 'array' or jsonb_typeof(change->'remove') is distinct from 'array'
      or exists(select 1 from jsonb_array_elements(change->'upsert') e where jsonb_typeof(e)<>'object' or coalesce(e->>'id','')='')
      or exists(select 1 from jsonb_array_elements(change->'remove') e where jsonb_typeof(e)<>'string')
      or (select count(*)<>count(distinct e->>'id') from jsonb_array_elements(change->'upsert') e) then
      raise exception 'Invalid catalog records' using errcode='22023';
    end if;
    execute format('delete from shotloom.%I where user_id=$1 and id in (select jsonb_array_elements_text($2))',spec.tbl) using p_user_id,change->'remove';
    execute format('select coalesce(max(position)+1,0) from shotloom.%I where user_id=$1',spec.tbl) into next_position using p_user_id;
    for item in select * from jsonb_array_elements(change->'upsert') loop
      execute format('insert into shotloom.%I(user_id,id,position,payload) values($1,$2,$3,$4) on conflict(user_id,id) do update set payload=excluded.payload',spec.tbl)
        using p_user_id,item->>'id',next_position,item;
      next_position:=next_position+1;
    end loop;
  end loop;
  insert into shotloom.catalog_metadatas(user_id,scope,payload) values(p_user_id,p_kind,p_metadata-array['skills','recipes','assets','materials'])
    on conflict(user_id,scope) do update set payload=shotloom.catalog_metadatas.payload || excluded.payload;
  return jsonb_build_object('revision',(select revision from shotloom.catalog_revisions where user_id=p_user_id));
end $$;
revoke all on function shotloom.patch_catalog(uuid,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function shotloom.patch_catalog(uuid,text,bigint,jsonb,jsonb) to service_role;

create function shotloom.list_catalog_page(p_user_id uuid,p_kind text,p_search text,p_sort text,p_offset integer,p_limit integer,p_categories text[] default '{}') returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare tbl text; result jsonb;
begin
  tbl:=case p_kind when 'skills' then 'skills' when 'recipes' then 'recipes' when 'assets' then 'catalog_assets' when 'materials' then 'catalog_materials' end;
  if tbl is null or p_offset<0 or p_limit<1 or p_limit>100 or p_sort not in ('name','updated') then raise exception 'Invalid page' using errcode='22023'; end if;
  execute format($q$
    with usages as (select r->>'assetId' id,count(*) uses from shotloom.catalog_metadatas cm,
      lateral jsonb_array_elements(coalesce(cm.payload->'references','[]'::jsonb)) r where cm.user_id=$1 and cm.scope='assets' group by r->>'assetId'),
    records as (select a.id,a.position,case when $6='assets' then coalesce(m.payload,'{}'::jsonb)||a.payload||jsonb_build_object('usageCount',coalesce(u.uses,0)) else a.payload end payload
      from shotloom.%I a left join shotloom.catalog_materials m on $6='assets' and m.user_id=a.user_id and m.id=a.payload->>'materialId'
      left join usages u on $6='assets' and u.id=a.id where a.user_id=$1),
    matching as (select * from records where ($2='' or strpos(lower(concat_ws(' ',payload->>'name',payload->>'description',payload->>'category',payload->>'note',payload->>'tags',id)),lower($2))>0)
      and (cardinality($7)=0 or coalesce(payload->>'category','')='' or payload->>'category'=any($7))),
    page as (select *,row_number() over(order by case when $3='name' then lower(payload->>'name') end asc,
      case when $3='updated' then payload->>'updatedAt' end desc nulls last,id) n from matching order by n offset $4 limit $5)
    select jsonb_build_object('items',coalesce((select jsonb_agg((select jsonb_object_agg(key,value) from jsonb_each(payload) where key=any(array['id','name','description','category','version','enabled','agentIds','updatedAt','createdAt','materialId','path','ext','size','mimeType','resourceType','sourceType','tags','importedAt','note','usageCount'])) order by n) from page),'[]'::jsonb),
    'total',(select count(*) from matching),'offset',$4,'limit',$5,
    'revision',coalesce((select revision from shotloom.catalog_revisions where user_id=$1),0))
  $q$,tbl) into result using p_user_id,p_search,p_sort,p_offset,p_limit,p_kind,p_categories;
  return result;
end $$;
revoke all on function shotloom.list_catalog_page(uuid,text,text,text,integer,integer,text[]) from public,anon,authenticated;
grant execute on function shotloom.list_catalog_page(uuid,text,text,text,integer,integer,text[]) to service_role;

create function shotloom.catalog_detail(p_user_id uuid,p_kind text,p_id text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare tbl text; result jsonb;
begin
  tbl:=case p_kind when 'skills' then 'skills' when 'recipes' then 'recipes' when 'assets' then 'catalog_assets' when 'materials' then 'catalog_materials' end;
  if tbl is null then raise exception 'Invalid catalog' using errcode='22023'; end if;
  execute format('select payload from shotloom.%I where user_id=$1 and id=$2',tbl) into result using p_user_id,p_id;
  return result;
end $$;
revoke all on function shotloom.catalog_detail(uuid,text,text) from public,anon,authenticated;
grant execute on function shotloom.catalog_detail(uuid,text,text) to service_role;
notify pgrst,'reload schema';
