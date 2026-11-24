/** Búsqueda global (proyectos y actividades por nombre). Lógica pura: la consulta a la base vive en la ruta. */

export const MIN_QUERY = 2;
export const MAX_QUERY = 80;
export const MAX_PROJECTS = 5;
export const MAX_ACTIVITIES = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Texto de búsqueda limpio (espacios colapsados, sin caracteres de control) o null si es demasiado corto. */
export function parseQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY).trim();
  return s.length >= MIN_QUERY ? s : null;
}

/** Patrón ILIKE «contiene» con %, _ y \ tomados literalmente. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface ProjectHit { id: string; code: string; name: string }
export interface ActivityHit { id: string; name: string; projectId: string; projectName: string }

export interface SearchResults { projects: ProjectHit[]; activities: ActivityHit[] }

/** Une listas de proyectos (por nombre y por código) sin repetir, en orden de aparición y con tope. */
export function mergeProjects(...lists: ProjectHit[][]): ProjectHit[] {
  const seen = new Set<string>();
  const out: ProjectHit[] = [];
  for (const list of lists) for (const p of list) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= MAX_PROJECTS) return out;
  }
  return out;
}

/** Destino al elegir un resultado. Una actividad abre su panel de dependencias en la pantalla del proyecto. */
export function projectHref(id: string): string | null {
  return UUID_RE.test(id) ? `/projects/${id}` : null;
}
export function activityHref(projectId: string, activityId: string): string | null {
  return UUID_RE.test(projectId) && UUID_RE.test(activityId)
    ? `/projects/${projectId}?open=${activityId}#dep-${activityId}`
    : null;
}

export interface FlatResult { key: string; kind: 'project' | 'activity'; label: string; detail: string; href: string }

/** Lista plana (la que se navega con el teclado): primero proyectos y luego actividades; descarta destinos inválidos. */
export function flatten(r: SearchResults): FlatResult[] {
  const out: FlatResult[] = [];
  for (const p of r.projects) {
    const href = projectHref(p.id);
    if (href) out.push({ key: `p-${p.id}`, kind: 'project', label: p.name, detail: p.code, href });
  }
  for (const a of r.activities) {
    const href = activityHref(a.projectId, a.id);
    if (href) out.push({ key: `a-${a.id}`, kind: 'activity', label: a.name, detail: a.projectName, href });
  }
  return out;
}

/** Siguiente posición activa con las flechas; -1 = ninguna. Da la vuelta en los extremos. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}
