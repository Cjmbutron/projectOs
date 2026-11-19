-- =============================================================================
-- 1100 · Vista de panel: proyectos por estado y salud
-- security_invoker: respeta las políticas RLS de quien consulta (no ve más de lo permitido).
-- =============================================================================

create view public.project_dashboard
with (security_invoker = true) as
select p.organization_id, p.status, p.health, count(*)::int as projects
from public.projects p
where p.archived_at is null and p.deleted_at is null
group by p.organization_id, p.status, p.health;

revoke all on public.project_dashboard from public, anon, authenticated;
grant select on public.project_dashboard to authenticated;
