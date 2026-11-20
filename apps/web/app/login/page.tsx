import Link from 'next/link';
import { AuthForm } from '@/components';
import { safeNext } from '@/lib/auth/redirect';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="narrow card">
      <h1>Iniciar sesión</h1>
      {sp.error === 'confirm' && <p className="err">El enlace no es válido o expiró.</p>}
      <AuthForm mode="login" next={safeNext(sp.next, '/projects')} />
      <p>¿Sin cuenta? <Link href="/signup">Regístrate</Link></p>
    </main>
  );
}
