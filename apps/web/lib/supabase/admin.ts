import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serviceRoleKey } from '@/lib/env';

/**
 * Cliente service_role: SALTA RLS. Solo para las funciones reservadas al servidor
 * (apply_schedule, get_schedule_snapshot, login_lock_until, record_login_attempt).
 * Jamás se devuelve al navegador ni se usa para leer datos "en nombre" de una persona.
 */
export function createAdminClient() {
  return createClient(publicEnv().url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
