# @project-os/web
Variables: ver `.env.example` (`SUPABASE_SERVICE_ROLE_KEY` solo en servidor).
`npm run dev -w @project-os/web` · `npm test -w @project-os/web` · `npm run build -w @project-os/web`
Lógica testeable en `lib/` (login con bloqueo, registro, recálculo, CSRF, redirección segura); las rutas en `app/api` solo conectan dependencias.
