export interface ImportRow {
  ref: string;
  name: string;
  duration: number;
  predecessors: { ref: string; type: 'FS' | 'SS' | 'FF' | 'SF'; lag: number }[];
}
export interface ImportError { line: number; message: string }
export type ParseResult = { ok: true; rows: ImportRow[] } | { ok: false; errors: ImportError[] };

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_ROWS = 1000;

/** CSV (RFC 4180) mínimo: comillas dobles, saltos de línea dentro de comillas, BOM, delimitador , o ;. */
export function parseCsvText(input: string): string[][] | { error: string } {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  text = text.replace(/\r\n?/g, '\n');
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) return { error: 'Hay unas comillas sin cerrar.' };
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const HEADERS: Record<string, 'ref' | 'name' | 'duration' | 'pred'> = {
  id: 'ref', nombre: 'name', actividad: 'name', name: 'name',
  duracion: 'duration', dias: 'duration', duration: 'duration',
  predecesoras: 'pred', predecesora: 'pred', predecessors: 'pred',
};

/** "1|3SS+2|4FF-1" (también ; o ,) → [{ref:'1',FS,0},{ref:'3',SS,2},{ref:'4',FF,-1}] */
export function parsePredecessors(raw: string): { ok: true; value: ImportRow['predecessors'] } | { ok: false; message: string } {
  const out: ImportRow['predecessors'] = [];
  for (const part of raw.split(/[;|,]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(.+?)(FS|SS|FF|SF)?([+-]\d{1,5})?$/i.exec(part);
    if (!m || !m[1].trim()) return { ok: false, message: `predecesora «${part}» inválida` };
    out.push({ ref: m[1].trim(), type: (m[2]?.toUpperCase() ?? 'FS') as 'FS', lag: m[3] ? Number(m[3]) : 0 });
  }
  return { ok: true, value: out };
}

/** Convierte y valida el archivo. Reporta TODOS los errores con su número de línea. */
export function parseActivitiesCsv(csv: string): ParseResult {
  if (csv.length > MAX_CSV_BYTES) return { ok: false, errors: [{ line: 0, message: 'El archivo supera 1 MB.' }] };
  const table = parseCsvText(csv);
  if (!Array.isArray(table)) return { ok: false, errors: [{ line: 0, message: table.error }] };
  if (table.length < 2) return { ok: false, errors: [{ line: 0, message: 'El archivo debe tener encabezado y al menos una actividad.' }] };

  const cols: Partial<Record<'ref' | 'name' | 'duration' | 'pred', number>> = {};
  table[0].forEach((h, idx) => { const k = HEADERS[norm(h)]; if (k && cols[k] === undefined) cols[k] = idx; });
  const missing = (['ref', 'name', 'duration'] as const).filter((k) => cols[k] === undefined);
  if (missing.length) {
    return { ok: false, errors: [{ line: 1, message: 'Faltan columnas: ' + missing.map((k) => ({ ref: 'id', name: 'nombre', duration: 'duracion' })[k]).join(', ') + '.' }] };
  }
  if (table.length - 1 > MAX_ROWS) return { ok: false, errors: [{ line: 0, message: `Máximo ${MAX_ROWS} actividades por archivo.` }] };

  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, k) => {
    const line = k + 2;
    if (cells.slice(table[0].length).some((x) => x.trim() !== '')) {
      errors.push({ line, message: 'tiene más columnas que el encabezado (si el archivo usa «;» como separador, separa las predecesoras con «|»).' });
    }
    const get = (c?: number) => (c === undefined ? '' : (cells[c] ?? '').trim());
    const ref = get(cols.ref);
    const name = get(cols.name);
    const durRaw = get(cols.duration);
    if (!ref) errors.push({ line, message: 'id vacío.' });
    else if (ref.length > 64) errors.push({ line, message: 'id demasiado largo.' });
    else if (seen.has(ref)) errors.push({ line, message: `id repetido «${ref}».` });
    seen.add(ref);
    if (!name || name.length > 200) errors.push({ line, message: 'nombre vacío o de más de 200 caracteres.' });
    if (!/^\d{1,5}$/.test(durRaw) || Number(durRaw) > 36500) errors.push({ line, message: `duración inválida «${durRaw}» (entero de 0 a 36500).` });
    const p = parsePredecessors(get(cols.pred));
    if (!p.ok) errors.push({ line, message: p.message + '.' });
    rows.push({ ref, name, duration: Number(durRaw), predecessors: p.ok ? p.value : [] });
  });
  // referencias cruzadas (solo si no hay ya errores de ids repetidos que las confundan)
  const refs = new Set(rows.map((r) => r.ref));
  rows.forEach((r, k) => r.predecessors.forEach((p) => {
    if (!refs.has(p.ref)) errors.push({ line: k + 2, message: `la predecesora «${p.ref}» no existe en el archivo.` });
    else if (p.ref === r.ref) errors.push({ line: k + 2, message: 'una actividad no puede depender de sí misma.' });
  }));
  return errors.length ? { ok: false, errors: errors.slice(0, 50) } : { ok: true, rows };
}
