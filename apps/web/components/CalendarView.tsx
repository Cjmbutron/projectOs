import Link from 'next/link';
import { formatDay } from '@/lib/dates';
import { addDays, addSuggested, removeDay } from '@/app/projects/[id]/calendar/actions';
import { MAX_RANGE_DAYS, planDays, suggestedHolidays, weekdayLabel } from '@/lib/calendar';
import { messageFor } from '@/lib/errors';

export interface CalendarDay { id: string; day: string; kind: 'holiday' | 'working'; name: string | null }
export interface CalendarViewProps {
  id: string; project: { code: string; name: string }; year: number; days: CalendarDay[]; weekdays: number[];
  canEdit: boolean; closed: boolean; stale: boolean;
  sp: { error?: string; added?: string; noeffect?: string; existing?: string; removed?: string };
}
const num = (v?: string) => (v && /^\d{1,4}$/.test(v) ? Number(v) : null);

export function CalendarView({ id, project, year, days, weekdays, canEdit, closed, stale, sp }: CalendarViewProps) {
  const have = new Set(days.map((d) => d.day));
  const suggestions = suggestedHolidays(year);
  const added = num(sp.added);
  const holidays = days.filter((d) => d.kind === 'holiday').length;
  return (
    <main>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link></p>
      <h1>Calendario</h1>
      <p>Feriados y días trabajados excepcionales. El cronograma los usa al calcular fechas, atrasos y la carga de recursos.</p>
      {closed && <p className="err" role="status">El proyecto está cerrado o cancelado: el calendario es de solo lectura.</p>}
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      {added !== null && (
        <p className="okmsg" role="status">
          {added === 0 ? 'No se agregó ningún día.' : `Se agregó ${added} día(s).`}
          {num(sp.existing) ? ` ${num(sp.existing)} ya estaba(n) registrado(s).` : ''}
          {num(sp.noeffect) ? ` ${num(sp.noeffect)} se omitió(eron) porque no cambia(n) nada (un feriado en fin de semana o un día trabajado en un día que ya es laborable).` : ''}
        </p>
      )}
      {sp.removed && <p className="okmsg" role="status">Día eliminado.</p>}
      {(added || sp.removed) && (
        <p role="status">{stale ? <>El cronograma quedó desactualizado: <Link href={`/projects/${id}`}>recalcúlalo en la pantalla del proyecto</Link>.</> : null}</p>
      )}

      <div className="card">
        <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <div><label htmlFor="y">Año</label><input id="y" name="y" type="number" min={2000} max={2100} defaultValue={year} style={{ width: 110 }} /></div>
          <button className="secondary">Ver</button>
        </form>
        <h2 style={{ marginTop: 16 }}>{year} · {holidays} feriado(s), {days.length - holidays} día(s) trabajado(s) excepcional(es)</h2>
        {days.length === 0 ? <p>No hay días registrados en {year}.</p> : (
          <table>
            <thead><tr><th>Fecha</th><th>Día</th><th>Tipo</th><th>Nombre</th>{canEdit && <th><span className="sr-only">Acciones</span></th>}</tr></thead>
            <tbody>{days.map((d) => (
              <tr key={d.id}>
                <td>{formatDay(d.day)}</td><td>{weekdayLabel(d.day)}</td>
                <td><span className={`badge ${d.kind === 'holiday' ? 'badge-warn' : 'badge-info'}`}>{d.kind === 'holiday' ? 'Feriado' : 'Día trabajado'}</span></td>
                <td>{d.name ?? ''}</td>
                {canEdit && <td>
                  <form action={removeDay}>
                    <input type="hidden" name="project" value={id} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="year" value={year} />
                    <button className="secondary" aria-label={`Eliminar ${d.day}`}>Eliminar</button>
                  </form>
                </td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <>
          <form action={addDays} className="card">
            <h2>Agregar un día o un rango</h2>
            <input type="hidden" name="project" value={id} />
            <div className="grid2">
              <div><label htmlFor="start">Desde</label><input id="start" name="start" type="date" required /></div>
              <div><label htmlFor="end">Hasta (opcional, para varios días seguidos)</label><input id="end" name="end" type="date" /></div>
              <div><label htmlFor="kind">Tipo</label>
                <select id="kind" name="kind" defaultValue="holiday">
                  <option value="holiday">Feriado (no se trabaja)</option>
                  <option value="working">Día trabajado excepcional (por ejemplo, un sábado)</option>
                </select></div>
              <div><label htmlFor="name">Nombre</label><input id="name" name="name" maxLength={120} placeholder="Ej.: Aniversario de La Paz" /></div>
            </div>
            <p className="hint">Hasta {MAX_RANGE_DAYS} días por vez. Solo se guardan los días que cambian algo: un feriado en sábado o domingo no se guarda porque ya no se trabaja.</p>
            <button>Agregar</button>
          </form>

          <form action={addSuggested} className="card">
            <h2>Feriados nacionales de Bolivia sugeridos para {year}</h2>
            <p className="hint">Son una ayuda, no una fuente oficial: el gobierno traslada o agrega días por decreto cada año{year === 2026 ? ' (para 2026 se aplicó el DS 5521)' : ''}. Revisa y corrige cada fecha antes de guardar. Los feriados departamentales o de tu ciudad se agregan arriba.</p>
            <input type="hidden" name="project" value={id} /><input type="hidden" name="year" value={year} />
            <div className="sug">
              {suggestions.map((s, i) => {
                const p = planDays([s.day], 'holiday', weekdays, have);
                const state = p.existing ? 'Ya registrado' : p.noEffect ? `Cae en ${weekdayLabel(s.day)}: sin efecto` : weekdayLabel(s.day);
                return (
                  <div className="sug-row" key={s.day}>
                    <input type="checkbox" name={`on_${i}`} aria-label={`Incluir ${s.name}`} defaultChecked={p.toAdd.length === 1} />
                    <input type="date" name={`day_${i}`} defaultValue={s.day} aria-label={`Fecha de ${s.name}`} />
                    <input name={`name_${i}`} defaultValue={s.name} maxLength={120} aria-label={`Nombre de ${s.name}`} />
                    <span className="sug-state">{state}</span>
                  </div>
                );
              })}
            </div>
            <button>Guardar los marcados</button>
          </form>
        </>
      )}
    </main>
  );
}
