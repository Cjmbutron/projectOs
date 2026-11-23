-- 2200 · Separación de funciones en requisitos: aprobar/rechazar exige scope.review (PM).
-- Quien tiene solo scope.edit (team_lead) registra y edita requisitos en estado 'proposed' y puede
-- avanzar uno ya aprobado entre 'approved', 'implemented' y 'verified'. Todo lo demás (crear con otro
-- estado, aprobar, rechazar, devolver a propuesto, saltar a implementado desde propuesto) es del PM.
create function private.requirement_review_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_gated boolean;
begin
  if tg_op = 'INSERT' then
    v_gated := new.status <> 'proposed';
  else
    v_gated := new.status <> old.status
      and not (old.status in ('approved', 'implemented', 'verified') and new.status in ('approved', 'implemented', 'verified'));
  end if;
  if v_gated and not private.has_project_permission(new.project_id, 'scope.review') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.requirement_review_guard() from public, anon, authenticated;
create trigger requirements_review_guard before insert or update of status on public.requirements
  for each row execute function private.requirement_review_guard();
