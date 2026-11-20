/**
 * Geometría del Gantt (pura, sin React). Las fechas las calcula siempre schedule-engine:
 * aquí solo se convierten en coordenadas.
 *
 * Convención del motor: `finish` es el ÚLTIMO día de la actividad (inclusivo) y un hito
 * ocurre al FINAL de su día. Una barra ocupa desde el borde izquierdo de `start` hasta el
 * borde derecho de `finish`; un hito se dibuja en el borde derecho de su día.
 */
export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface GanttActivity {
  id: string;
  name: string;
  start: string | null;
  finish: string | null;
  duration: number;
  critical: boolean;
  code?: string;
}
export interface GanttDependency { predecessorId: string; successorId: string; type: DepType }

export interface GanttOptions { pxPerDay?: number; rowHeight?: number; barHeight?: number; headerHeight?: number }

export interface Bar { id: string; label: string; x: number; y: number; width: number; height: number; milestone: boolean; critical: boolean; row: number; start: string; finish: string }
export interface Link { key: string; points: [number, number][]; critical: boolean }
export interface Tick { x: number; label: string; major: boolean }
export interface GanttLayout {
  width: number; height: number; headerHeight: number; rowHeight: number;
  bars: Bar[]; links: Link[]; ticks: Tick[]; weekends: { x: number; width: number }[];
  unscheduled: string[];
  minDate: string | null;
}

const DAY = 86_400_000;
const epochDay = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const weekday = (day: number) => new Date(day * DAY).getUTCDay(); // 0 = domingo

/** Ancho estimado de un carácter de la etiqueta (px, 12 px de fuente). */
const CHAR_W = 6.5;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function layoutGantt(
  activities: GanttActivity[],
  dependencies: GanttDependency[],
  opts: GanttOptions = {},
): GanttLayout {
  const px = opts.pxPerDay ?? 24;
  const rowH = opts.rowHeight ?? 32;
  const barH = opts.barHeight ?? 18;
  const head = opts.headerHeight ?? 36;

  const scheduled = activities.filter((a) => a.start && a.finish);
  const unscheduled = activities.filter((a) => !a.start || !a.finish).map((a) => a.id);
  if (scheduled.length === 0) {
    return { width: 0, height: head, headerHeight: head, rowHeight: rowH, bars: [], links: [], ticks: [], weekends: [], unscheduled, minDate: null };
  }

  const first = Math.min(...scheduled.map((a) => epochDay(a.start!)));
  const last = Math.max(...scheduled.map((a) => epochDay(a.finish!)));
  // un día de margen a cada lado para que el hito final no quede pegado al borde
  const origin = first - 1;
  const days = last - first + 3;
  const gridWidth = days * px;

  const bars: Bar[] = [];
  const byId = new Map<string, Bar>();
  scheduled.forEach((a, row) => {
    const s = epochDay(a.start!) - origin;
    const f = epochDay(a.finish!) - origin;
    const milestone = a.duration === 0;
    const bar: Bar = milestone
      ? { id: a.id, label: a.name, x: (f + 1) * px - barH / 2, y: head + row * rowH + (rowH - barH) / 2, width: barH, height: barH, milestone, critical: a.critical, row, start: a.start!, finish: a.finish! }
      : { id: a.id, label: a.name, x: s * px, y: head + row * rowH + (rowH - barH) / 2, width: Math.max(px * 0.5, (f - s + 1) * px), height: barH, milestone, critical: a.critical, row, start: a.start!, finish: a.finish! };
    bars.push(bar);
    byId.set(a.id, bar);
  });

  // Bordes de enganche: inicio = borde izquierdo, fin = borde derecho (hito: su centro)
  const left = (b: Bar) => (b.milestone ? b.x + b.width / 2 : b.x);
  const right = (b: Bar) => (b.milestone ? b.x + b.width / 2 : b.x + b.width);
  const cy = (b: Bar) => b.y + b.height / 2;
  const STUB = 8;

  const links: Link[] = [];
  for (const d of dependencies) {
    const p = byId.get(d.predecessorId);
    const s = byId.get(d.successorId);
    if (!p || !s) continue; // alguna de las dos aún sin fechas
    const fromRight = d.type === 'FS' || d.type === 'FF';
    const toLeft = d.type === 'FS' || d.type === 'SS';
    const x1 = fromRight ? right(p) : left(p);
    const x2 = toLeft ? left(s) : right(s);
    const y1 = cy(p), y2 = cy(s);
    const s1 = fromRight ? 1 : -1;
    const s2 = toLeft ? -1 : 1;
    const midY = y2 > y1 ? y1 + rowH / 2 : y1 - rowH / 2;
    const ax = x1 + s1 * STUB;
    const bx = x2 + s2 * STUB;
    links.push({
      key: `${d.predecessorId}>${d.successorId}`,
      points: [[x1, y1], [ax, y1], [ax, midY], [bx, midY], [bx, y2], [x2, y2]],
      critical: p.critical && s.critical,
    });
  }

  // Escala: línea cada lunes (semanas) y etiqueta con el día; mes en el primer día del mes
  const ticks: Tick[] = [];
  const weekends: { x: number; width: number }[] = [];
  for (let day = origin; day < origin + days; day++) {
    const x = (day - origin) * px;
    const wd = weekday(day);
    const iso = isoOf(day);
    if (wd === 6 || wd === 0) weekends.push({ x, width: px });
    if (iso.slice(8) === '01') ticks.push({ x, label: `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`, major: true });
    else if (wd === 1) ticks.push({ x, label: String(+iso.slice(8)), major: false });
  }

  // El texto va a la derecha de cada barra: el lienzo debe ser lo bastante ancho para el último.
  const width = Math.max(gridWidth, ...bars.map((b) => b.x + b.width + 6 + b.label.length * CHAR_W + 8));

  return {
    width, height: head + scheduled.length * rowH + 8, headerHeight: head, rowHeight: rowH,
    bars, links, ticks, weekends, unscheduled, minDate: isoOf(origin),
  };
}

/** Puntos de una polilínea para el atributo `points` de SVG. */
export const toPoints = (pts: [number, number][]) => pts.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join(' ');
