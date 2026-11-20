import { UUID_RE, type HandlerResult } from '@/lib/http';
import { parseActivitiesCsv, type ImportRow } from '@/lib/import/csv';

export interface ImportDeps {
  getUserId(): Promise<string | null>;
  /** import_activities con la SESIÓN de la persona (RLS, MFA y permisos los aplica la base). */
  importRows(projectId: string, rows: ImportRow[]): Promise<{ ok: true; activities: number; dependencies: number } | { ok: false; code: string; detail?: string }>;
}

/** POST /api/projects/:id/import  { csv: string } */
export async function handleImport(deps: ImportDeps, projectId: string, input: unknown): Promise<HandlerResult> {
  if (!UUID_RE.test(projectId)) return { status: 400, body: { error: 'invalid_request' } };
  const csv = (input as { csv?: unknown } | null)?.csv;
  if (typeof csv !== 'string') return { status: 400, body: { error: 'invalid_request' } };
  if (!(await deps.getUserId())) return { status: 401, body: { error: 'not_authenticated' } };

  const parsed = parseActivitiesCsv(csv);
  if (!parsed.ok) return { status: 422, body: { error: 'invalid_file', errors: parsed.errors } };

  const r = await deps.importRows(projectId, parsed.rows);
  if (r.ok) return { status: 200, body: { activities: r.activities, dependencies: r.dependencies } };
  if (r.code === 'forbidden') return { status: 403, body: { error: 'forbidden' } };
  if (r.code === 'dependency_cycle') return { status: 422, body: { error: 'dependency_cycle' } };
  if (r.code === 'import_invalid') return { status: 422, body: { error: 'invalid_file', errors: [{ line: 0, message: r.detail ?? 'Archivo inválido.' }] } };
  return { status: 500, body: { error: 'internal_error' } };
}
