'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { flatten, moveActive, parseQuery, type FlatResult, type SearchResults } from '@/lib/search';

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'done'; items: FlatResult[] };

/** Búsqueda global en la cabecera: combobox accesible (flechas, Enter, Escape; «/» enfoca la caja). */
export function GlobalSearch() {
  const router = useRouter();
  const id = useId();
  const box = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<State>({ status: 'idle' });
  const q = parseQuery(text);

  useEffect(() => {
    if (!q) { setState({ status: 'idle' }); setActive(-1); return; }
    setState({ status: 'loading' });
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal, credentials: 'same-origin' });
        if (!res.ok) throw new Error(String(res.status));
        const items = flatten((await res.json()) as SearchResults);
        setState({ status: 'done', items });
        setActive(items.length ? 0 : -1);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setState({ status: 'error' });
      }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); box.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, []);

  const items = state.status === 'done' ? state.items : [];
  const go = (href: string) => { setOpen(false); setText(''); router.push(href); };
  const listId = `${id}-list`;
  const showPanel = open && (q !== null || text.trim().length > 0);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => moveActive(a, e.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (e.key === 'Enter') {
      const it = items[active];
      if (it) { e.preventDefault(); go(it.href); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); } else { setText(''); box.current?.blur(); }
    }
  }

  let status = '';
  if (showPanel) {
    if (!q) status = 'Escribe al menos 2 caracteres.';
    else if (state.status === 'loading' || state.status === 'idle') status = 'Buscando…';
    else if (state.status === 'error') status = 'No se pudo buscar. Inténtalo de nuevo.';
    else if (!items.length) status = 'Sin resultados.';
    else status = `${items.length} resultado(s).`;
  }
  const projects = items.filter((i) => i.kind === 'project');
  const activities = items.filter((i) => i.kind === 'activity');
  const row = (it: FlatResult) => {
    const idx = items.indexOf(it);
    return (
      <li key={it.key} id={`${id}-o${idx}`} role="option" aria-selected={idx === active} className={`sr-opt${idx === active ? ' on' : ''}`}
        onMouseEnter={() => setActive(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(it.href)}>
        <span className="sr-label">{it.label}</span><span className="sr-detail">{it.detail}</span>
      </li>
    );
  };

  return (
    <div className="search" ref={wrap} role="search">
      <input ref={box} type="search" value={text} placeholder="Buscar proyectos y actividades…  ( / )" aria-label="Buscar proyectos y actividades"
        role="combobox" aria-expanded={showPanel && items.length > 0} aria-controls={listId} aria-autocomplete="list" autoComplete="off" maxLength={120}
        aria-activedescendant={showPanel && active >= 0 ? `${id}-o${active}` : undefined}
        onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
      {showPanel && (
        <div className="search-panel">
          <p className="search-status" role="status" aria-live="polite">{status}</p>
          {items.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Resultados">
              {projects.length > 0 && <li role="presentation" className="sr-group">Proyectos</li>}
              {projects.map(row)}
              {activities.length > 0 && <li role="presentation" className="sr-group">Actividades</li>}
              {activities.map(row)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
