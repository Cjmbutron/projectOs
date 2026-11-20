// Prueba de integración REAL: motor ↔ PostgreSQL (migraciones R1+R2).
// Requiere una BD ya preparada con `db/tests/run.sh` y POS_DB_URL (p. ej. postgres:///pos_test).
// Sin POS_DB_URL se omite.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeSchedule } from '@project-os/schedule-engine';
import { toEngineInput, recalculateProject, ScheduleConflictError, ScheduleDbError, type ScheduleSnapshot } from '../src';
import { PgScheduleRepository } from '../src/pg';

const url = process.env.POS_DB_URL;
const d = url ? describe : describe.skip;

d('integración con PostgreSQL', () => {
  let client: pg.Client;
  let repo: PgScheduleRepository;
  let n = 0;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    repo = new PgScheduleRepository(client);
  });
  afterAll(async () => { await client.end(); });

  const sql = (text: string, params: unknown[] = []) => client.query(text, params);
  const as = async (user: string) => { await sql('select t.as_user($1)', [user]); };
  const reset = async () => { await sql('select t.reset()'); };
  const uid = async (name: string) => (await sql('select t.uid($1) as id', [name])).rows[0].id as string;

  /** Proyecto A(2) → B(3) → M(0) creado con la API real y los permisos reales del PM. */
  async function newProject() {
    n++;
    await reset();
    const org = (await sql("select t.fx('org_a') as id")).rows[0].id;
    await as('pm_a');
    const code = `IT-${Date.now()}-${n}`;
    const pm = await uid('pm_a');
    const p = (await sql(
      "select public.create_project($1, $2, 'Integración', $3, 'predictive') as id", [org, code, pm])).rows[0].id as string;
    await sql("update public.project_schedules set start_date = '2026-03-02' where project_id = $1", [p]);
    const ins = async (name: string, dur: number) => (await sql(
      'insert into public.activities (organization_id, project_id, name, duration) values ($1,$2,$3,$4) returning id',
      [org, p, name, dur])).rows[0].id as string;
    const a = await ins('A', 2); const b = await ins('B', 3); const m = await ins('M', 0);
    await sql('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values ($1,$2,$3,$4),($1,$2,$4,$5)', [org, p, a, b, m]);
    await reset();
    return { org, p, a, b, m, pm };
  }

  const dbRow = async (id: string) => (await sql(
    'select early_start::text es, early_finish::text ef, late_finish::text lf, total_float tf, free_float ff, is_critical c, violated_constraints v from public.activities where id = $1', [id])).rows[0];

  it('el resultado guardado en la base coincide con el del motor ejecutado aparte', async () => {
    const { p, a, b, m, pm } = await newProject();
    const snapshot = await repo.readSnapshot(p);
    const expected = computeSchedule(toEngineInput(snapshot));
    const out = await recalculateProject(repo, { projectId: p, actorId: pm });
    expect(out).toMatchObject({ attempts: 1, activityCount: 3 });
    for (const id of [a, b, m]) {
      const r = expected.activities.find((x) => x.id === id)!;
      expect(await dbRow(id)).toEqual({ es: r.earlyStart, ef: r.earlyFinish, lf: r.lateFinish, tf: r.totalFloat, ff: r.freeFloat, c: r.critical, v: [...r.violatedConstraints] });
    }
    // A: lun 02 – mar 03 · B: mié 04 – vie 06
    expect((await dbRow(a)).es).toBe('2026-03-02');
    expect((await dbRow(b)).ef).toBe('2026-03-06');
    const s = (await sql('select computed_version, schedule_version, computed_finish::text f, duration_days from public.project_schedules where project_id = $1', [p])).rows[0];
    expect(s.computed_version).toBe(s.schedule_version);
    expect(s.f).toBe(expected.projectFinish);
    expect(s.duration_days).toBe(expected.durationWorkingDays);
  });

  it('feriados y fines de semana laborables cambian las fechas guardadas', async () => {
    const { org, p, b, pm } = await newProject();
    await as('pm_a');
    await sql("insert into public.project_calendar_days (organization_id, project_id, day, kind) values ($1,$2,'2026-03-04','holiday')", [org, p]);
    await reset();
    await recalculateProject(repo, { projectId: p, actorId: pm });
    expect((await dbRow(b)).es).toBe('2026-03-05'); // el feriado empuja a B
    await as('pm_a');
    await sql("update public.project_schedules set working_weekdays = '{1,2,3,4,5,6}' where project_id = $1", [p]);
    await reset();
    await recalculateProject(repo, { projectId: p, actorId: pm });
    expect((await dbRow(b)).ef).toBe('2026-03-07'); // con sábado laborable B termina el sábado 07
  });

  it('las restricciones violadas llegan a la base como códigos', async () => {
    const { org, p, b, pm } = await newProject();
    await as('pm_a');
    await sql("insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values ($1,$2,$3,'FNLT','2026-03-04')", [org, p, b]);
    await reset();
    const out = await recalculateProject(repo, { projectId: p, actorId: pm });
    const row = await dbRow(b);
    expect(row.v).toEqual(['FNLT']);
    expect(row.tf).toBeLessThan(0);
    expect(out.warnings.length).toBeGreaterThan(0);
    const w = (await sql('select warnings from public.project_schedules where project_id = $1', [p])).rows[0].warnings;
    expect(w.length).toBe(out.warnings.length);
  });

  it('edición concurrente: el primer intento choca y el reintento ve los datos nuevos', async () => {
    const { org, p, pm } = await newProject();
    let injected = false;
    const racing = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'readSnapshot') {
          return async (id: string) => {
            const snap = await target.readSnapshot(id);
            if (!injected) {
              injected = true; // otra persona agrega una actividad justo después de nuestra lectura
              await as('pm_a');
              await sql("insert into public.activities (organization_id, project_id, name, duration) values ($1,$2,'Colada',4)", [org, p]);
              await reset();
            }
            return snap;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const out = await recalculateProject(racing as PgScheduleRepository, { projectId: p, actorId: pm });
    expect(out.attempts).toBe(2);
    expect(out.activityCount).toBe(4);
    expect((await sql('select count(*)::int c from public.activities where project_id = $1 and early_start is not null', [p])).rows[0].c).toBe(4);
  });

  it('sin reintentos disponibles, el conflicto no deja nada escrito', async () => {
    const { org, p, a, pm } = await newProject();
    const stale: ScheduleSnapshot = await repo.readSnapshot(p);
    await as('pm_a');
    await sql("insert into public.activities (organization_id, project_id, name, duration) values ($1,$2,'Otra',1)", [org, p]);
    await reset();
    const racing = { readSnapshot: async () => stale, applySchedule: (x: Parameters<PgScheduleRepository['applySchedule']>[0]) => repo.applySchedule(x) };
    await expect(recalculateProject(racing, { projectId: p, actorId: pm, maxAttempts: 1 })).rejects.toBeInstanceOf(ScheduleConflictError);
    expect((await dbRow(a)).es).toBeNull();
  });

  it('un actor sin schedule.edit es rechazado por la base de datos', async () => {
    const { p } = await newProject();
    const member = await uid('member_a');
    await expect(recalculateProject(repo, { projectId: p, actorId: member })).rejects.toMatchObject({ name: 'ScheduleDbError', code: 'forbidden' });
    await expect(recalculateProject(repo, { projectId: p, actorId: await uid('owner_b') })).rejects.toBeInstanceOf(ScheduleDbError);
  });

  it('con el cronograma al día se puede crear la línea base (contrato completo)', async () => {
    const { p, a, pm } = await newProject();
    await as('pm_a');
    await expect(sql("select public.create_baseline($1, 'LB')", [p])).rejects.toMatchObject({ message: 'schedule_not_current' });
    await reset();
    await recalculateProject(repo, { projectId: p, actorId: pm });
    await as('pm_a');
    const id = (await sql("select public.create_baseline($1, 'LB') as id", [p])).rows[0].id;
    await reset();
    const f = (await sql('select finish_date::text f from public.baseline_activities where baseline_id = $1 and activity_id = $2', [id, a])).rows[0].f;
    expect(f).toBe('2026-03-03');
  });

  it('proyecto de solo lectura: el recálculo es rechazado', async () => {
    const { p, pm } = await newProject();
    await as('owner_a');
    for (const st of ['proposed', 'approved', 'planning', 'executing', 'closing', 'closed']) {
      await sql('select public.change_project_status($1, $2)', [p, st]);
    }
    await reset();
    await expect(recalculateProject(repo, { projectId: p, actorId: pm })).rejects.toMatchObject({ code: 'project_read_only' });
  });
});
