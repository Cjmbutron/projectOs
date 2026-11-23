import { deadlineState } from '@/lib/my-activities';
import { summarizeHealth } from '@/lib/health';

export interface Kpi { key: string; label: string; value: string; hint: string; tone: 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' }

/** Avance medio de los proyectos (entero, redondeado); sin proyectos → null. Valores fuera de 0–100 se acotan. */
export function averageProgress(rows: { progress_percent: number | string | null }[]): number | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce((n, r) => n + Math.min(100, Math.max(0, Number(r.progress_percent ?? 0) || 0)), 0);
  return Math.round(sum / rows.length);
}

/** Actividades propias vencidas (fin calculado anterior a hoy y sin terminar). */
export function countOverdue(rows: { early_finish: string | null; status: string }[], today: string): number {
  return rows.filter((a) => deadlineState(a.early_finish, a.status, today) === 'overdue').length;
}

/** Tarjetas de la lista de proyectos. El hint repite el estado en palabras: el color no es la única señal. */
export function projectKpis(
  projects: { health: string; progress_percent: number | string | null }[],
  overdueMine: number | null,
): Kpi[] {
  const sum = summarizeHealth(projects);
  const risk = sum.counts.amber + sum.counts.red;
  const avg = averageProgress(projects);
  const out: Kpi[] = [
    { key: 'projects', label: 'Proyectos', value: String(sum.total), hint: `${sum.counts.green} en verde`, tone: 'accent' },
    { key: 'risk', label: 'En riesgo', value: String(risk), hint: risk === 0 ? 'Ninguno en ámbar ni rojo' : `${sum.counts.amber} en ámbar · ${sum.counts.red} en rojo`, tone: sum.counts.red > 0 ? 'danger' : risk > 0 ? 'warn' : 'ok' },
    { key: 'progress', label: 'Avance medio', value: avg === null ? '—' : `${avg} %`, hint: avg === null ? 'Sin proyectos' : 'Promedio simple de proyectos', tone: 'neutral' },
  ];
  if (overdueMine !== null) {
    out.push({ key: 'overdue', label: 'Mis actividades vencidas', value: String(overdueMine), hint: overdueMine === 0 ? 'Estás al día' : 'Revisa «Mis actividades»', tone: overdueMine > 0 ? 'danger' : 'ok' });
  }
  return out;
}
