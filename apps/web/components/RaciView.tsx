import Link from 'next/link';
import { saveRow } from '@/app/projects/[id]/raci/actions';
import { messageFor } from '@/lib/errors';
import { CELL_LABEL, CELL_SHORT, CELL_VALUES, rowStatus, summarize, type CellValue } from '@/lib/raci';

export interface RaciDeliverable { id: string; name: string; code: string | null; responsible: string | null }
export interface RaciMember { id: string; name: string; role: string }
export interface RaciViewProps {
  id: string; project: { code: string; name: string };
  deliverables: RaciDeliverable[]; members: RaciMember[]; cells: Map<string, Map<string, CellValue>>;
  canEdit: boolean; closed: boolean; sp: { error?: string; saved?: string };
}

export function RaciView({ id, project, deliverables, members, cells, canEdit, closed, sp }: RaciViewProps) {
  const sum = summarize(deliverables.map((d) => d.id), cells);
  const saved = sp.saved && /^\d{1,3}$/.test(sp.saved) ? Number(sp.saved) : null;
  return (
    <main>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link> · <Link href={`/projects/${id}/wbs`}>WBS y entregables →</Link></p>
      <h1>Matriz RACI</h1>
      <p>Quién hace, aprueba, es consultado e informado en cada entregable. <strong>R</strong> Responsable (hace el trabajo) · <strong>A</strong> Aprobador (responde por el resultado; uno por entregable) · <strong>C</strong> Consultado · <strong>I</strong> Informado.</p>
      {closed && <p className="err" role="status">El proyecto está cerrado o cancelado: la matriz es de solo lectura.</p>}
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}{saved ? ` Se guardaron ${saved} cambio(s) antes del error.` : ''}</p>}
      {!sp.error && saved !== null && <p className="okmsg" role="status">{saved === 0 ? 'No había cambios que guardar.' : `Se guardó ${saved} cambio(s).`}</p>}
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Entregables</span><span className="kpi-value">{sum.total}</span></div>
        <div className="kpi"><span className="kpi-label">Con R y A</span><span className="kpi-value">{sum.complete}</span></div>
        <div className="kpi"><span className="kpi-label">Incompletos</span><span className="kpi-value">{sum.total - sum.complete}</span></div>
        <div className="kpi"><span className="kpi-label">Personas</span><span className="kpi-value">{members.length}</span></div>
      </div>

      {deliverables.length === 0 ? (
        <div className="card"><p>Este proyecto aún no tiene entregables. Créalos en <Link href={`/projects/${id}/wbs`}>WBS y entregables</Link> y vuelve aquí.</p></div>
      ) : (
        <div className="card raci-wrap">
          <table className="raci">
            <thead>
              <tr>
                <th scope="col">Entregable</th>
                {members.map((m) => <th scope="col" key={m.id} title={m.role}>{m.name}</th>)}
                <th scope="col">Estado</th>
                {canEdit && !closed && <th scope="col"><span className="sr-only">Guardar</span></th>}
              </tr>
            </thead>
            <tbody>
              {deliverables.map((d) => {
                const st = rowStatus(cells.get(d.id));
                const form = `row-${d.id}`;
                const editable = canEdit && !closed;
                return (
                  <tr key={d.id} id={`d-${d.id}`}>
                    <th scope="row">
                      {editable && (
                        <form id={form} action={saveRow}><input type="hidden" name="project" value={id} /><input type="hidden" name="deliverable" value={d.id} /></form>
                      )}
                      <span className="raci-code">{d.code ?? '—'}</span> {d.name}
                      {d.responsible && <span className="raci-resp">Responsable asignado: {d.responsible}</span>}
                    </th>
                    {members.map((m) => {
                      const v = cells.get(d.id)?.get(m.id) ?? '';
                      return (
                        <td key={m.id} className={v ? `raci-cell raci-${v}` : 'raci-cell'}>
                          {editable ? (
                            <>
                              <input form={form} type="hidden" name={`orig_${m.id}`} value={v} />
                              <select form={form} name={`cell_${m.id}`} defaultValue={v} aria-label={`${m.name} en ${d.name}`}>
                                {CELL_VALUES.map((c) => <option key={c} value={c} title={CELL_LABEL[c]}>{c === '' ? '—' : CELL_SHORT[c]}</option>)}
                              </select>
                            </>
                          ) : <span title={CELL_LABEL[v]}>{CELL_SHORT[v] || '·'}</span>}
                        </td>
                      );
                    })}
                    <td><span className={`badge ${st.complete ? 'badge-ok' : 'badge-warn'}`}>{st.label}</span></td>
                    {editable && <td><button form={form} className="secondary" aria-label={`Guardar ${d.name}`}>Guardar</button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!canEdit && !closed && deliverables.length > 0 && <p className="hint">Solo quien edita el alcance del proyecto (PM y líder técnico) puede cambiar la matriz.</p>}
      <p className="hint">«Responsable asignado» es el campo del entregable en la WBS; la matriz es independiente de él.</p>
    </main>
  );
}
