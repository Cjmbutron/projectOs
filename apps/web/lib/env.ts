/** Variables de entorno con error claro si faltan (no con `undefined` en producción). */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return value;
}

export const publicEnv = () => ({
  url: required('NEXT_PUBLIC_SUPABASE_URL'),
  publishableKey: required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
});

/** Solo servidor. */
export const serviceRoleKey = () => required('SUPABASE_SERVICE_ROLE_KEY');
