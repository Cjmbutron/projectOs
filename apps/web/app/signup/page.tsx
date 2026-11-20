import Link from 'next/link';
import { AuthForm } from '@/components';

export default function SignupPage() {
  return (
    <main className="narrow card">
      <h1>Crear cuenta</h1>
      <AuthForm mode="signup" next="/projects" />
      <p>¿Ya tienes cuenta? <Link href="/login">Entra</Link></p>
    </main>
  );
}
