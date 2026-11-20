import { NextResponse } from 'next/server';
import { handleImport } from '@/lib/import/import-handler';
import { createClient } from '@/lib/supabase/server';
import { csrfOk, readJson, toResponse } from '@/lib/route-utils';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!csrfOk(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const result = await handleImport(
    {
      getUserId: async () => {
        const { data } = await supabase.auth.getClaims();
        return typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
      },
      importRows: async (projectId, rows) => {
        const { data, error } = await supabase.rpc('import_activities', { p_project: projectId, p_rows: rows });
        if (error) {
          const code = error.message.split('\n')[0].trim();
          return { ok: false, code: code === 'import_invalid' || code === 'dependency_cycle' ? code : error.code === '42501' ? 'forbidden' : 'other', detail: error.details ?? undefined };
        }
        const d = data as { activities: number; dependencies: number };
        return { ok: true, activities: d.activities, dependencies: d.dependencies };
      },
    },
    id,
    await readJson(request),
  );
  return toResponse(result);
}
