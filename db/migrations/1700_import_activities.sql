-- =============================================================================
-- 1700 · Importación de actividades (US-071)
--
-- SECURITY INVOKER a propósito: los inserts pasan por las políticas RLS y las
-- concesiones de columnas de la persona (permiso schedule.edit, MFA, membresía),
-- exactamente como si insertara fila a fila. La función solo aporta atomicidad:
-- o entra todo el archivo o no entra nada.
--
-- p_rows: [{ "ref": "1", "name": "...", "duration": 3,
--            "predecessors": [{ "ref": "0", "type": "FS", "lag": 0 }] }]
-- "ref" es el identificador local del archivo (único); las dependencias se resuelven
-- contra los ref del propio archivo.
-- =============================================================================
create function public.import_activities(p_project uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_org     uuid;
  v_row     jsonb;
  v_pred    jsonb;
  v_ref     text;
  v_pref    text;
  v_type    text;
  v_lag     integer;
  v_dur     integer;
  v_base    integer;
  v_i       integer := 0;
  v_ids     jsonb := '{}'::jsonb;
  v_id      uuid;
  v_acts    integer := 0;
  v_deps    integer := 0;
  v_pairs   text[] := '{}';
  v_pair    text;
begin
  if not public.can_edit_schedule(p_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'import_invalid' using errcode = 'P0001', detail = 'El archivo no tiene filas.';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'import_invalid' using errcode = 'P0001', detail = 'Máximo 1000 actividades por importación.';
  end if;

  select organization_id into v_org from public.projects where id = p_project;
  if v_org is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(max(sort_order), 0) into v_base from public.activities where project_id = p_project;

  -- Pasada 1: validar y crear actividades.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: formato inválido.', v_i);
    end if;
    v_ref := btrim(coalesce(v_row ->> 'ref', ''));
    if v_ref = '' or char_length(v_ref) > 64 then
      raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: identificador vacío o demasiado largo.', v_i);
    end if;
    if v_ids ? v_ref then
      raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: identificador repetido «%s».', v_i, v_ref);
    end if;
    if coalesce(jsonb_typeof(v_row -> 'duration'), '') <> 'number'
       or (v_row ->> 'duration') !~ '^[0-9]{1,5}$' or (v_row ->> 'duration')::integer > 36500 then
      raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: duración inválida (entero de 0 a 36500).', v_i);
    end if;
    v_dur := (v_row ->> 'duration')::integer;
    if char_length(btrim(coalesce(v_row ->> 'name', ''))) not between 1 and 200 then
      raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: nombre vacío o de más de 200 caracteres.', v_i);
    end if;

    insert into public.activities (organization_id, project_id, name, duration, sort_order)
    values (v_org, p_project, btrim(v_row ->> 'name'), v_dur, v_base + v_i)
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object(v_ref, v_id);
    v_acts := v_acts + 1;
  end loop;

  -- Pasada 2: dependencias.
  v_i := 0;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_ref := btrim(v_row ->> 'ref');
    if v_row ? 'predecessors' and jsonb_typeof(v_row -> 'predecessors') <> 'array' then
      raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: predecesoras inválidas.', v_i);
    end if;
    for v_pred in select * from jsonb_array_elements(coalesce(v_row -> 'predecessors', '[]'::jsonb)) loop
      v_pref := btrim(coalesce(v_pred ->> 'ref', ''));
      v_type := coalesce(v_pred ->> 'type', 'FS');
      if not (v_ids ? v_pref) then
        raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: la predecesora «%s» no existe en el archivo.', v_i, v_pref);
      end if;
      if v_pref = v_ref then
        raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: una actividad no puede depender de sí misma.', v_i);
      end if;
      if v_type not in ('FS', 'SS', 'FF', 'SF') then
        raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: tipo de dependencia «%s» inválido.', v_i, v_type);
      end if;
      if coalesce(jsonb_typeof(v_pred -> 'lag'), 'number') <> 'number'
         or coalesce(v_pred ->> 'lag', '0') !~ '^-?[0-9]{1,5}$' or abs(coalesce(v_pred ->> 'lag', '0')::integer) > 36500 then
        raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: desfase inválido.', v_i);
      end if;
      v_lag := coalesce(v_pred ->> 'lag', '0')::integer;
      v_pair := v_pref || E'\u0001' || v_ref;
      if v_pair = any (v_pairs) then
        raise exception 'import_invalid' using errcode = 'P0001', detail = format('Fila %s: predecesora «%s» repetida.', v_i, v_pref);
      end if;
      v_pairs := v_pairs || v_pair;
      insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id, type, lag)
      values (v_org, p_project, (v_ids ->> v_pref)::uuid, (v_ids ->> v_ref)::uuid, v_type, v_lag);
      v_deps := v_deps + 1;
    end loop;
  end loop;

  return jsonb_build_object('activities', v_acts, 'dependencies', v_deps);
end $$;

revoke all on function public.import_activities(uuid, jsonb) from public, anon;
grant execute on function public.import_activities(uuid, jsonb) to authenticated;
