'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { messageFor } from '@/lib/errors';

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export function AuthForm({ mode, next }: { mode: 'login' | 'signup'; next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    const f = new FormData(e.currentTarget);
    const body = mode === 'login'
      ? { email: f.get('email'), password: f.get('password') }
      : { email: f.get('email'), password: f.get('password'), displayName: f.get('displayName'), acceptedTerms: f.get('terms') === 'on' };
    const { ok, data } = await post(`/api/auth/${mode}`, body);
    setBusy(false);
    if (!ok) {
      const secs = typeof data.retryAfterSeconds === 'number' ? ` (${Math.ceil(data.retryAfterSeconds / 60)} min)` : '';
      return setError(messageFor(data.error as string) + (data.error === 'account_locked' ? secs : ''));
    }
    if (mode === 'login') { router.replace(next); router.refresh(); }
    else setInfo('Revisa tu correo para confirmar la cuenta.');
  }
  return (
    <form onSubmit={submit}>
      {mode === 'signup' && (<><label htmlFor="displayName">Nombre</label><input id="displayName" name="displayName" required maxLength={120} autoComplete="name" /></>)}
      <label htmlFor="email">Correo</label><input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Contraseña{mode === 'signup' ? ' (mínimo 12 caracteres)' : ''}</label>
      <input id="password" name="password" type="password" required minLength={mode === 'signup' ? 12 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      {mode === 'signup' && (<label style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" name="terms" style={{width:'auto'}} required /> Acepto los términos y la política de privacidad</label>)}
      <button disabled={busy}>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
      {error && <p className="err" role="alert">{error}</p>}
      {info && <p className="okmsg">{info}</p>}
    </form>
  );
}

export function RecalcButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const { ok, data } = await post(`/api/projects/${projectId}/recalculate`);
    setBusy(false);
    if (!ok) return setMsg({ text: data.message ? String(data.message) : messageFor(data.error as string), bad: true });
    setMsg({ text: `Calculado: ${String(data.activityCount)} actividades.`, bad: false });
    router.refresh();
  }
  return (<div><button onClick={run} disabled={busy}>Recalcular cronograma</button>
    {msg && <p className={msg.bad ? 'err' : 'okmsg'} role="status">{msg.text}</p>}</div>);
}

export function LogoutButton() {
  const router = useRouter();
  return <button className="secondary" style={{marginTop:0}} onClick={async () => { await post('/api/auth/logout'); router.replace('/login'); router.refresh(); }}>Salir</button>;
}

export function ImportCsv({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [msg, setMsg] = useState('');
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrors([]); setMsg('');
    if (file.size > 1_000_000) return setErrors([{ line: 0, message: 'El archivo supera 1 MB.' }]);
    setBusy(true);
    const { ok, data } = await post(`/api/projects/${projectId}/import`, { csv: await file.text() });
    setBusy(false);
    if (ok) { setMsg(`Importadas ${String(data.activities)} actividades y ${String(data.dependencies)} dependencias. Recalcula el cronograma.`); router.refresh(); return; }
    if (Array.isArray(data.errors)) return setErrors(data.errors as { line: number; message: string }[]);
    setErrors([{ line: 0, message: messageFor(data.error as string) }]);
  }
  return (
    <div>
      <label htmlFor="csv">Importar actividades (CSV: id, nombre, duracion, predecesoras)</label>
      <input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
      {msg && <p className="okmsg" role="status">{msg}</p>}
      {errors.length > 0 && (
        <ul className="err" role="alert">
          {errors.map((er, i) => <li key={i}>{er.line ? `Línea ${er.line}: ` : ''}{er.message}</li>)}
        </ul>
      )}
    </div>
  );
}
