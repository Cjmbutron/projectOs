-- Ausencias de recursos y su efecto en la capacidad semanal (migración 2500).
do $$
declare
  v_org uuid := t.fx('org_a'); v_ob uuid := t.fx('org_b');
  v_p uuid; v_a uuid; v_r uuid; v_rb uuid; v_ab uuid; v_ab2 uuid;
  v_q text := 'select hours::text || ''/'' || capacity_hours::text || ''/'' || overallocated::text from public.resource_load(%L, ''2026-03-02'', ''2026-03-15'') where resource_id = %L and week_start = %L';
  v_res text; v_a2 uuid; v_r2 uuid;
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'AUS-P', 'Ausencias', t.uid('pm_a'), 'predictive');
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Trabajo', 5) returning id into v_a;
  perform t.reset();
  update public.activities set early_start = '2026-03-02', early_finish = '2026-03-06' where id = v_a;
  insert into public.resources (organization_id, name, daily_hours) values (v_org, 'Persona ausente', 8) returning id into v_r;
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (v_org, v_p, v_a, v_r, 50);
  insert into public.resources (organization_id, name) values (v_ob, 'Recurso B') returning id into v_rb;

  -- ---- Permisos ----
  perform t.as_user('pm_a');
  insert into public.resource_absences (organization_id, resource_id, start_date, end_date, reason) values (v_org, v_r, '2026-03-04', '2026-03-05', 'Vacaciones') returning id into v_ab;
  perform t.ok('PM registra una ausencia', v_ab is not null);
  perform t.as_user('admin_a');
  perform t.lives('admin registra una ausencia', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2026-06-01'', ''2026-06-02'')', v_org, v_r));
  perform t.as_user('member_a');
  perform t.throws('member no registra ausencias', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2026-07-01'', ''2026-07-02'')', v_org, v_r), '42501');
  perform t.eq('member no edita ausencias (0 filas)', t.affected(format('update public.resource_absences set reason = ''x'' where id = %L', v_ab)), 0::bigint);
  perform t.eq('member no borra ausencias (0 filas)', t.affected(format('delete from public.resource_absences where id = %L', v_ab)), 0::bigint);
  perform t.ok('member interno ve las ausencias', t.count_of('select 1 from public.resource_absences') = 2);
  perform t.as_user('auditor_a');
  perform t.throws('auditor no registra ausencias', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2026-07-01'', ''2026-07-02'')', v_org, v_r), '42501');
  perform t.as_user('ext_a');
  perform t.eq('externo no ve ausencias', t.count_of('select 1 from public.resource_absences'), 0::bigint);
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve ausencias', t.count_of('select 1 from public.resource_absences'), 0::bigint);
  perform t.throws('otra organización no registra ausencias en org_a', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2026-07-01'', ''2026-07-02'')', v_org, v_r), '42501');
  perform t.throws('recurso de otra organización', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2026-07-01'', ''2026-07-02'')', v_ob, v_r), '23503');

  -- ---- Validaciones ----
  perform t.as_user('pm_a');
  perform t.throws('fin anterior al inicio', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2026-07-05'', ''2026-07-04'')', v_org, v_r), '23514');
  perform t.lives('un solo día es válido', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2026-08-03'', ''2026-08-03'')', v_org, v_r));
  perform t.lives('365 días de diferencia es válido', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2027-01-01'', ''2027-12-31'')', v_org, v_r));
  perform t.throws('más de 365 días', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (%L, %L, ''2027-01-01'', ''2028-01-02'')', v_org, v_r), '23514');
  perform t.throws('motivo de más de 200 caracteres', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date, reason) values (%L, %L, ''2026-09-01'', ''2026-09-02'', %L)', v_org, v_r, repeat('x', 201)), '23514');
  perform t.lives('motivo de 200 caracteres', format('insert into public.resource_absences (organization_id, resource_id, start_date, end_date, reason) values (%L, %L, ''2026-09-01'', ''2026-09-02'', %L)', v_org, v_r, repeat('x', 200)));
  perform t.throws('el recurso de una ausencia no se cambia', format('update public.resource_absences set resource_id = %L where id = %L', v_rb, v_ab), '42501');
  perform t.lives('PM edita fechas y motivo', format('update public.resource_absences set reason = ''Licencia'' where id = %L', v_ab));

  -- ---- Efecto en la capacidad ----
  -- Trabajo: 50 % × 8 h × 5 días = 20 h. Ausente mié 04 y jue 05 → capacidad 8 × 3 = 24 h.
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('2 días ausentes: capacidad 24 h', v_res, '20.00/24.00/false');
  perform t.as_user('pm_a');
  update public.resource_absences set start_date = '2026-03-02', end_date = '2026-03-06' where id = v_ab;
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('semana completa ausente: capacidad 0 y sobreasignada con trabajo', v_res, '20.00/0.00/true');
  perform t.as_user('pm_a');
  update public.resource_absences set start_date = '2026-03-02', end_date = '2026-03-04' where id = v_ab;
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('3 días ausentes: capacidad 16 h → sobreasignada (20 > 16)', v_res, '20.00/16.00/true');
  perform t.as_user('pm_a');
  update public.resource_absences set start_date = '2026-03-02', end_date = '2026-03-03' where id = v_ab;
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('2 días ausentes con 3 laborables: 20 h caben en 24 h', v_res, '20.00/24.00/false');
  -- Ausencias que se cruzan no cuentan dos veces el mismo día
  perform t.as_user('pm_a');
  insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (v_org, v_r, '2026-03-03', '2026-03-04') returning id into v_ab2;
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('ausencias solapadas: lun-mié = 3 días distintos → 16 h', v_res, '20.00/16.00/true');
  -- Sábado y domingo no restan capacidad
  perform t.as_user('pm_a');
  update public.resource_absences set start_date = '2026-03-07', end_date = '2026-03-08' where id = v_ab;
  update public.resource_absences set start_date = '2026-03-07', end_date = '2026-03-08' where id = v_ab2;
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('fin de semana ausente no reduce la capacidad', v_res, '20.00/40.00/false');
  -- Una ausencia que empieza antes y termina dentro de la semana, y otra que continúa a la siguiente
  perform t.as_user('pm_a');
  update public.resource_absences set start_date = '2026-02-20', end_date = '2026-03-03' where id = v_ab;
  update public.resource_absences set start_date = '2026-03-02', end_date = '2026-03-02' where id = v_ab2;
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('ausencia que viene de la semana anterior: lun y mar = 2 días', v_res, '20.00/24.00/false');
  -- Una ausencia de otro recurso no afecta
  perform t.as_user('pm_a');
  update public.resource_absences set start_date = '2026-03-02', end_date = '2026-03-06' where id = v_ab2;
  delete from public.resource_absences where id = v_ab;
  perform t.as_user('owner_b');
  insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (v_ob, v_rb, '2026-03-02', '2026-03-06');
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('solo cuentan las ausencias del propio recurso (5 días ausentes → 0 h)', v_res, '20.00/0.00/true');
  -- Borrar las ausencias restituye la capacidad
  perform t.as_user('pm_a');
  delete from public.resource_absences where resource_id = v_r;
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('sin ausencias: capacidad completa', v_res, '20.00/40.00/false');
  -- Una ausencia sin trabajo en esa semana no crea filas
  perform t.as_user('pm_a');
  insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (v_org, v_r, '2026-03-09', '2026-03-13');
  perform t.as_user('member_a');
  perform t.eq('semana sin carga no aparece aunque haya ausencia', (select count(*) from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r and week_start = '2026-03-09'), 0::bigint);

  -- ---- Dos semanas con carga: cada ausencia solo afecta a su semana y a su recurso ----
  perform t.as_user('pm_a');
  delete from public.resource_absences where resource_id = v_r;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Semana 2', 5) returning id into v_a2;
  insert into public.resources (organization_id, name, daily_hours) values (v_org, 'Otra persona', 8) returning id into v_r2;
  perform t.reset();
  update public.activities set early_start = '2026-03-09', early_finish = '2026-03-13' where id = v_a2;
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (v_org, v_p, v_a2, v_r, 100);
  perform t.as_user('pm_a');
  insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (v_org, v_r, '2026-03-07', '2026-03-10');
  insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (v_org, v_r2, '2026-03-02', '2026-03-13');
  perform t.as_user('member_a');
  execute format(v_q, v_org, v_r, '2026-03-02') into v_res;
  perform t.eq('semana 1: la ausencia que empieza en sábado no resta nada', v_res, '20.00/40.00/false');
  execute format(v_q, v_org, v_r, '2026-03-09') into v_res;
  perform t.eq('semana 2: lunes y martes ausentes = 3 días laborables (40 h > 24 h)', v_res, '40.00/24.00/true');
  perform t.eq('la ausencia de otro recurso no cambia la capacidad de este (ya verificado) y no crea filas para él', (select count(*) from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r2), 0::bigint);

  -- ---- Borrar recurso y auditoría ----
  perform t.reset();
  perform t.ok('la creación quedó en la auditoría', exists (select 1 from public.audit_log where entity_table = 'resource_absences' and action = 'insert'));
  insert into public.resources (organization_id, name) values (v_org, 'Para borrar') returning id into v_r;
  insert into public.resource_absences (organization_id, resource_id, start_date, end_date) values (v_org, v_r, '2026-03-02', '2026-03-03');
  delete from public.resources where id = v_r;
  perform t.eq('borrar el recurso borra sus ausencias', (select count(*) from public.resource_absences where resource_id = v_r), 0::bigint);
  perform t.as_anon();
  perform t.throws('anónimo no lee ausencias', 'select * from public.resource_absences', '42501');
  perform t.reset();
end $$;
