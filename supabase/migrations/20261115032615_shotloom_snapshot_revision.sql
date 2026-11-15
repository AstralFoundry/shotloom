create or replace function shotloom.save_editor_snapshot(p_project_id uuid, p_node_id text, p_payload jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into shotloom.editor_snapshots (project_id, node_id, payload)
    values (p_project_id, p_node_id, p_payload)
    on conflict (project_id, node_id) do update
      set payload = excluded.payload, revision = shotloom.editor_snapshots.revision + 1;
$$;
revoke all on function shotloom.save_editor_snapshot(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function shotloom.save_editor_snapshot(uuid, text, jsonb) to service_role;
