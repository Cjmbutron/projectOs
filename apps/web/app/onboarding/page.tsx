import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { messageFor } from '@/lib/errors';

async function createOrg(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const name = String(formData.get('name') ?? '').trim();
  const currency = String(formData.get('currency') ?? 'USD');
  const { error } = await supabase.rpc('create_organization', { p_name: name, p_currency: currency });
  if (error) redirect(`/onboarding?error=${encodeURIComponent(error.message.split('\n')[0].slice(0, 40))}`);
  redirect('/projects');
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="narrow card">
      <h1>Crea tu organización</h1>
      <form action={createOrg}>
        <label htmlFor="name">Nombre</label><input id="name" name="name" required minLength={2} maxLength={120} />
        <label htmlFor="currency">Moneda de referencia</label>
        <select id="currency" name="currency" defaultValue="USD"><option>USD</option><option>BOB</option><option>EUR</option></select>
        <button>Crear</button>
        {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      </form>
    </main>
  );
}
