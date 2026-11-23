-- 2400 · ¿Puede la persona gestionar los recursos de la organización? Para que la aplicación muestre u oculte
-- los formularios; la autorización real sigue siendo la RLS de `resources` (migración 2300).
create function public.can_manage_resources(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.has_org_permission(p_org, 'resource.manage'), false) $$;
revoke all on function public.can_manage_resources(uuid) from public, anon;
grant execute on function public.can_manage_resources(uuid) to authenticated;
