import { createCalendar, type CalendarInput, type WorkCalendar } from './calendar';
import { formatDay, toDayNumber, type IsoDate } from './dates';
import { CycleError, ScheduleError } from './errors';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type ConstraintType = 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';

export interface DateConstraint {
  readonly type: ConstraintType;
  readonly date: IsoDate;
}

export interface ActivityInput {
  readonly id: string;
  /** Duración en días laborables (entero ≥ 0). 0 = hito. */
  readonly duration: number;
  /** Restricciones de fecha. Admite varias (p. ej. un sprint impone SNET y FNLT), pero una sola por tipo. */
  readonly constraints?: readonly DateConstraint[];
}

export interface DependencyInput {
  readonly predecessorId: string;
  readonly successorId: string;
  readonly type: DependencyType;
  /** Desfase en días laborables (entero). Negativo = adelanto (lead). Por defecto 0. */
  readonly lag?: number;
}

export interface ScheduleInput {
  /** Inicio del proyecto. Si no es laborable, el cronograma arranca el siguiente día laborable. */
  readonly projectStart: IsoDate;
  readonly calendar: CalendarInput;
  readonly activities: readonly ActivityInput[];
  readonly dependencies: readonly DependencyInput[];
}

export interface ActivityResult {
  readonly id: string;
  readonly duration: number;
  readonly isMilestone: boolean;
  readonly earlyStart: IsoDate;
  readonly earlyFinish: IsoDate;
  readonly lateStart: IsoDate;
  readonly lateFinish: IsoDate;
  /** Holgura total en días laborables. ≤ 0 → crítica; < 0 → no se puede cumplir. */
  readonly totalFloat: number;
  /** Holgura libre en días laborables (≥ 0). */
  readonly freeFloat: number;
  readonly critical: boolean;
  /** Restricciones de fecha que el cronograma no logra cumplir. */
  readonly violatedConstraints: readonly ConstraintType[];
  /**
   * Posiciones en el eje de días laborables (0 = inicio del proyecto); el día `k` ocupa [k, k+1).
   * Útiles para depurar y para pruebas; la interfaz debe usar las fechas.
   */
  readonly axis: { readonly es: number; readonly ef: number; readonly ls: number; readonly lf: number };
}

export type ScheduleWarning =
  | { readonly code: 'CONSTRAINT_VIOLATED'; readonly activityId: string; readonly constraint: ConstraintType }
  | { readonly code: 'NEGATIVE_FLOAT'; readonly activityId: string; readonly totalFloat: number };

export interface ScheduleResult {
  /** Primer día laborable del proyecto (puede ser posterior a `projectStart` de la entrada). */
  readonly projectStart: IsoDate;
  /** Fin del proyecto: el último día de la actividad que termina más tarde. */
  readonly projectFinish: IsoDate;
  /** Duración total en días laborables. */
  readonly durationWorkingDays: number;
  /** En el mismo orden que la entrada. */
  readonly activities: readonly ActivityResult[];
  readonly criticalActivityIds: readonly string[];
  readonly warnings: readonly ScheduleWarning[];
}

// ---------------------------------------------------------------------------
// Validación y grafo
// ---------------------------------------------------------------------------

const MAX_DURATION = 36_500;
const MAX_LAG = 36_500;
const DEPENDENCY_TYPES: ReadonlySet<string> = new Set(['FS', 'SS', 'FF', 'SF']);
const CONSTRAINT_TYPES: ReadonlySet<string> = new Set(['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']);

interface Graph {
  readonly ids: string[];
  readonly durations: number[];
  readonly edgePred: number[];
  readonly edgeSucc: number[];
  readonly edgeType: DependencyType[];
  readonly edgeLag: number[];
  readonly inEdges: number[][];
  readonly outEdges: number[][];
  /** Orden topológico (predecesoras antes que sucesoras). */
  readonly order: number[];
}

function buildGraph(
  activities: readonly ActivityInput[],
  dependencies: readonly DependencyInput[],
): Graph {
  const ids: string[] = [];
  const durations: number[] = [];
  const indexById = new Map<string, number>();

  activities.forEach((activity, i) => {
    if (!activity || typeof activity.id !== 'string' || activity.id.length === 0) {
      throw new ScheduleError('INVALID_ACTIVITY', `La actividad en la posición ${i} no tiene id válido`);
    }
    if (indexById.has(activity.id)) {
      throw new ScheduleError('DUPLICATE_ACTIVITY', `Id de actividad repetido: "${activity.id}"`);
    }
    const d = activity.duration;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > MAX_DURATION) {
      throw new ScheduleError(
        'INVALID_DURATION',
        `Duración inválida en "${activity.id}": ${String(d)} (entero de 0 a ${MAX_DURATION} días laborables)`,
      );
    }
    indexById.set(activity.id, i);
    ids.push(activity.id);
    durations.push(d);
  });

  const n = ids.length;
  const edgePred: number[] = [];
  const edgeSucc: number[] = [];
  const edgeType: DependencyType[] = [];
  const edgeLag: number[] = [];
  const inEdges: number[][] = Array.from({ length: n }, () => []);
  const outEdges: number[][] = Array.from({ length: n }, () => []);
  const seenPairs = new Set<string>();

  for (const dep of dependencies) {
    const p = indexById.get(dep?.predecessorId);
    const s = indexById.get(dep?.successorId);
    if (p === undefined || s === undefined) {
      const missing = p === undefined ? dep?.predecessorId : dep?.successorId;
      throw new ScheduleError('UNKNOWN_ACTIVITY', `La dependencia hace referencia a una actividad inexistente: "${String(missing)}"`);
    }
    if (!DEPENDENCY_TYPES.has(dep.type)) {
      throw new ScheduleError(
        'INVALID_DEPENDENCY_TYPE',
        `Tipo de dependencia inválido: "${String(dep.type)}" (use FS, SS, FF o SF)`,
      );
    }
    const lag = dep.lag ?? 0;
    if (typeof lag !== 'number' || !Number.isInteger(lag) || Math.abs(lag) > MAX_LAG) {
      throw new ScheduleError(
        'INVALID_LAG',
        `Desfase inválido entre "${dep.predecessorId}" y "${dep.successorId}": ${String(lag)}`,
      );
    }
    const key = `${p}\u0000${s}`;
    if (seenPairs.has(key)) {
      throw new ScheduleError(
        'DUPLICATE_DEPENDENCY',
        `Ya existe una dependencia de "${dep.predecessorId}" a "${dep.successorId}"`,
      );
    }
    seenPairs.add(key);
    const e = edgePred.length;
    edgePred.push(p);
    edgeSucc.push(s);
    edgeType.push(dep.type);
    edgeLag.push(lag);
    outEdges[p]!.push(e);
    inEdges[s]!.push(e);
  }

  // Orden topológico (Kahn). Si quedan nodos sin procesar, hay un ciclo.
  const indegree = inEdges.map((edges) => edges.length);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);
  const order: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head]!;
    order.push(v);
    for (const e of outEdges[v]!) {
      const s = edgeSucc[e]!;
      indegree[s] = indegree[s]! - 1;
      if (indegree[s] === 0) queue.push(s);
    }
  }

  const graph: Graph = { ids, durations, edgePred, edgeSucc, edgeType, edgeLag, inEdges, outEdges, order };
  if (order.length < n) {
    const processed = new Array<boolean>(n).fill(false);
    for (const v of order) processed[v] = true;
    throw new CycleError(extractCycle(graph, processed));
  }
  return graph;
}

/**
 * Extrae un ciclo concreto. Cada nodo no procesado tiene al menos una predecesora no procesada,
 * así que caminar hacia atrás termina forzosamente en un ciclo.
 */
function extractCycle(graph: Graph, processed: readonly boolean[]): string[] {
  let start = processed.indexOf(false);
  const path: number[] = [];
  const seen = new Map<number, number>();
  let cur = start;
  while (!seen.has(cur)) {
    seen.set(cur, path.length);
    path.push(cur);
    let next = -1;
    for (const e of graph.inEdges[cur]!) {
      const p = graph.edgePred[e]!;
      if (!processed[p]) {
        next = p;
        break;
      }
    }
    cur = next;
  }
  // `path` va de sucesora a predecesora; se invierte para quedar en orden de dependencia.
  const cycle = path.slice(seen.get(cur)!).reverse();
  let k = 0;
  for (let i = 1; i < cycle.length; i++) if (cycle[i]! < cycle[k]!) k = i;
  const rotated = [...cycle.slice(k), ...cycle.slice(0, k)];
  start = rotated[0]!;
  return [...rotated, start].map((i) => graph.ids[i]!);
}

/**
 * Antes de guardar una dependencia nueva: devuelve la ruta del ciclo que crearía
 * (`[pred, suc, …, pred]`) o `null` si no crea ninguno. Es la base de US-020.
 */
export function findCycleForNewDependency(
  existing: readonly DependencyInput[],
  candidate: Pick<DependencyInput, 'predecessorId' | 'successorId'>,
): string[] | null {
  const { predecessorId, successorId } = candidate;
  if (predecessorId === successorId) return [predecessorId, predecessorId];

  const successorsOf = new Map<string, string[]>();
  for (const dep of existing) {
    const list = successorsOf.get(dep.predecessorId);
    if (list) list.push(dep.successorId);
    else successorsOf.set(dep.predecessorId, [dep.successorId]);
  }
  // Búsqueda en anchura desde la sucesora hasta alcanzar la predecesora.
  const parent = new Map<string, string | null>([[successorId, null]]);
  const queue = [successorId];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    if (node === predecessorId) {
      const path: string[] = [];
      for (let cur: string | null = node; cur !== null; cur = parent.get(cur) ?? null) path.push(cur);
      path.reverse(); // sucesora … predecesora
      return [predecessorId, ...path];
    }
    for (const next of successorsOf.get(node) ?? []) {
      if (!parent.has(next)) {
        parent.set(next, node);
        queue.push(next);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

/**
 * Calcula el cronograma (método de la ruta crítica sobre un eje de días laborables).
 *
 * Modelo: el día laborable `k` ocupa el intervalo [k, k+1). Una actividad de duración `d` que
 * empieza en `es` termina en `ef = es + d`. Con eso las cuatro dependencias son aritmética entera:
 *   FS: es_s ≥ ef_p + lag        SS: es_s ≥ es_p + lag
 *   FF: ef_s ≥ ef_p + lag        SF: ef_s ≥ es_p + lag
 *
 * Reglas:
 * - Las dependencias siempre se respetan; las restricciones de fecha que no se pueden cumplir no
 *   mueven la actividad: producen holgura negativa y una advertencia (US-065).
 * - Los hitos (duración 0) ocurren al final de un día laborable; sus restricciones se leen como fin de día.
 * - Todo parte del primer día laborable en o después de `projectStart`.
 * - Lags y duraciones se miden en días laborables del calendario del proyecto.
 */
export function computeSchedule(input: ScheduleInput): ScheduleResult {
  const calendar = createCalendar(input.calendar);
  const graph = buildGraph(input.activities, input.dependencies);
  const { durations, inEdges, outEdges, edgePred, edgeSucc, edgeType, edgeLag, order } = graph;
  const n = graph.ids.length;

  const firstDay = calendar.nextWorkingDay(toDayNumber(input.projectStart));
  const c0 = calendar.workingDaysBefore(firstDay);

  // Fechas → posiciones en el eje (ver documentación de la función).
  const startLB = (day: number) => calendar.workingDaysBefore(day) - c0;
  const startUB = (day: number) => calendar.workingDaysBefore(day + 1) - c0 - 1;
  const finishLB = (day: number) => calendar.workingDaysBefore(day) - c0 + 1;
  const finishUB = (day: number) => calendar.workingDaysBefore(day + 1) - c0;

  // Restricciones → cota inferior del inicio y tope del fin.
  const lowerES: number[] = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
  const capsLF: { type: ConstraintType; cap: number }[][] = Array.from({ length: n }, () => []);
  input.activities.forEach((activity, i) => {
    const d = durations[i]!;
    const seenTypes = new Set<string>();
    for (const c of activity.constraints ?? []) {
      if (!c || !CONSTRAINT_TYPES.has(c.type)) {
        throw new ScheduleError(
          'INVALID_CONSTRAINT',
          `Restricción inválida en "${activity.id}": "${String(c?.type)}"`,
        );
      }
      if (seenTypes.has(c.type)) {
        throw new ScheduleError('INVALID_CONSTRAINT', `"${activity.id}" repite la restricción ${c.type}`);
      }
      seenTypes.add(c.type);
      const day = toDayNumber(c.date);
      let lower: number | null = null;
      let cap: number | null = null;
      if (d === 0) {
        // Hito: toda restricción se interpreta como fin de día.
        if (c.type === 'SNET' || c.type === 'FNET' || c.type === 'MSO' || c.type === 'MFO') lower = finishLB(day);
        if (c.type === 'SNLT' || c.type === 'FNLT' || c.type === 'MSO' || c.type === 'MFO') cap = finishUB(day);
      } else {
        switch (c.type) {
          case 'SNET':
            lower = startLB(day);
            break;
          case 'FNET':
            lower = finishLB(day) - d;
            break;
          case 'SNLT':
            cap = startUB(day) + d;
            break;
          case 'FNLT':
            cap = finishUB(day);
            break;
          case 'MSO':
            lower = startLB(day);
            cap = startUB(day) + d;
            break;
          case 'MFO':
            lower = finishLB(day) - d;
            cap = finishUB(day);
            break;
        }
      }
      if (lower !== null) lowerES[i] = Math.max(lowerES[i]!, lower);
      if (cap !== null) capsLF[i]!.push({ type: c.type, cap });
    }
  });

  // Pasada hacia adelante.
  const es: number[] = new Array<number>(n).fill(0);
  const ef: number[] = new Array<number>(n).fill(0);
  for (const a of order) {
    const d = durations[a]!;
    let start = Math.max(0, lowerES[a]!);
    for (const e of inEdges[a]!) {
      const p = edgePred[e]!;
      const lag = edgeLag[e]!;
      let bound: number;
      switch (edgeType[e]!) {
        case 'FS':
          bound = ef[p]! + lag;
          break;
        case 'SS':
          bound = es[p]! + lag;
          break;
        case 'FF':
          bound = ef[p]! + lag - d;
          break;
        case 'SF':
          bound = es[p]! + lag - d;
          break;
      }
      if (bound > start) start = bound;
    }
    es[a] = start;
    ef[a] = start + d;
  }

  let projectEnd = 0;
  for (let i = 0; i < n; i++) if (ef[i]! > projectEnd) projectEnd = ef[i]!;

  // Pasada hacia atrás. Toda actividad precede implícitamente al fin del proyecto.
  const lf: number[] = new Array<number>(n).fill(projectEnd);
  const ls: number[] = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    const a = order[k]!;
    const d = durations[a]!;
    let finish = projectEnd;
    for (const e of outEdges[a]!) {
      const s = edgeSucc[e]!;
      const lag = edgeLag[e]!;
      let bound: number;
      switch (edgeType[e]!) {
        case 'FS':
          bound = ls[s]! - lag;
          break;
        case 'SS':
          bound = ls[s]! - lag + d;
          break;
        case 'FF':
          bound = lf[s]! - lag;
          break;
        case 'SF':
          bound = lf[s]! - lag + d;
          break;
      }
      if (bound < finish) finish = bound;
    }
    for (const { cap } of capsLF[a]!) if (cap < finish) finish = cap;
    lf[a] = finish;
    ls[a] = finish - d;
  }

  // Resultados con fechas.
  const dayCache = new Map<number, string>();
  const dateAt = (index: number): IsoDate => {
    let text = dayCache.get(index);
    if (text === undefined) {
      text = formatDay(calendar.dayOfOrdinal(c0 + index));
      dayCache.set(index, text);
    }
    return text;
  };
  const startDate = (boundary: number, d: number): IsoDate =>
    d === 0 ? dateAt(boundary >= 1 ? boundary - 1 : boundary) : dateAt(boundary);
  const finishDate = (boundary: number, d: number): IsoDate =>
    d === 0 ? dateAt(boundary >= 1 ? boundary - 1 : boundary) : dateAt(boundary - 1);

  const warnings: ScheduleWarning[] = [];
  const criticalActivityIds: string[] = [];
  const activities: ActivityResult[] = [];
  for (let i = 0; i < n; i++) {
    const d = durations[i]!;
    const id = graph.ids[i]!;

    let freeFloat = projectEnd - ef[i]!;
    for (const e of outEdges[i]!) {
      const s = edgeSucc[e]!;
      const lag = edgeLag[e]!;
      let slack: number;
      switch (edgeType[e]!) {
        case 'FS':
          slack = es[s]! - (ef[i]! + lag);
          break;
        case 'SS':
          slack = es[s]! - (es[i]! + lag);
          break;
        case 'FF':
          slack = ef[s]! - (ef[i]! + lag);
          break;
        case 'SF':
          slack = ef[s]! - (es[i]! + lag);
          break;
      }
      if (slack < freeFloat) freeFloat = slack;
    }

    const totalFloat = lf[i]! - ef[i]!;
    const critical = totalFloat <= 0;
    const violated = capsLF[i]!.filter(({ cap }) => ef[i]! > cap).map(({ type }) => type);

    if (critical) criticalActivityIds.push(id);
    for (const constraint of violated) warnings.push({ code: 'CONSTRAINT_VIOLATED', activityId: id, constraint });
    if (totalFloat < 0) warnings.push({ code: 'NEGATIVE_FLOAT', activityId: id, totalFloat });

    activities.push({
      id,
      duration: d,
      isMilestone: d === 0,
      earlyStart: startDate(es[i]!, d),
      earlyFinish: finishDate(ef[i]!, d),
      lateStart: startDate(ls[i]!, d),
      lateFinish: finishDate(lf[i]!, d),
      totalFloat,
      freeFloat,
      critical,
      violatedConstraints: violated,
      axis: { es: es[i]!, ef: ef[i]!, ls: ls[i]!, lf: lf[i]! },
    });
  }

  return {
    projectStart: dateAt(0),
    projectFinish: projectEnd === 0 ? dateAt(0) : dateAt(projectEnd - 1),
    durationWorkingDays: projectEnd,
    activities,
    criticalActivityIds,
    warnings,
  };
}

export type { WorkCalendar };
