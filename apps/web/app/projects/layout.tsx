import { AppShell } from '@/components/AppShell';
import { createClient } from '@/lib/supabase/server';

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return <AppShell who={data.user?.email ?? null}>{children}</AppShell>;
}
