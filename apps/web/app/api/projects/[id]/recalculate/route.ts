import { NextResponse } from 'next/server';
import { SupabaseScheduleRepository, recalculateProject } from '@project-os/schedule-service';
import { handleRecalculate } from '@/lib/schedule/recalc-handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { csrfOk, toResponse } from '@/lib/route-utils';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!csrfOk(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const result = await handleRecalculate(
    {
      getUserId: async () => {
        const { data } = await supabase.auth.getClaims();
        return typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
      },
      canEdit: async (projectId) => {
        const { data, error } = await supabase.rpc('can_edit_schedule', { p_project: projectId });
        return !error && data === true;
      },
      recalculate: (projectId, actorId) =>
        recalculateProject(new SupabaseScheduleRepository(createAdminClient()), { projectId, actorId }),
    },
    id,
  );
  return toResponse(result);
}
