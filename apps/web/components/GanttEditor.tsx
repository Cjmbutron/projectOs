'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GanttChart } from '@/components/GanttChart';
import { messageFor } from '@/lib/errors';
import { durationForFinish, shiftIso, snapDays, type WorkCal } from '@/lib/gantt/drag';
import type { Bar, GanttLayout } from '@/lib/gantt/layout';
import { moveActivity, resizeActivity } from '@/app/projects/[id]/gantt/actions';

export interface CalendarData { weekdays: number[]; holidays: string[]; extraWorking: string[] }
type Mode = 'move' | 'resize';
interface Active { id: string; g: SVGGElement; mode: Mode; x0: number; days: number }

/**
 * Gantt editable. Mover = fijar «no empezar antes de»; redimensionar = cambiar la duración (días laborables).
 * Solo propone y guarda; las fechas finales las calcula el motor al recalcular.
 */
export function GanttEditor({ layout, projectId, calendar }: { layout: GanttLayout; projectId: string; calendar: CalendarData }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = useRef<Active | null>(null);
  const bars = useRef(new Map<string, Bar>());
  bars.current = new Map(layout.bars.map((b) => [b.id, b]));
  const cal: WorkCal = useMemo(() => ({ weekdays: calendar.weekdays, holidays: new Set(calendar.holidays), extraWorking: new Set(calendar.extraWorking) }), [calendar]);
  const px = layout.pxPerDay;

  /** Deja una barra exactamente como la describe el layout (quita todo desplazamiento provisional). */
  const restore = (g: SVGGElement) => {
    const bar = bars.current.get(g.getAttribute('data-bar') ?? '');
    g.removeAttribute('transform');
    if (!bar) return;
    g.querySelector('rect.g-bar')?.setAttribute('width', String(bar.width));
    g.querySelector('.g-handle')?.setAttribute('x', String(bar.x + bar.width - 5));
    g.querySelector('text')?.setAttribute('x', String(bar.x + bar.width + 6));
  };
  useEffect(() => { root.current?.querySelectorAll<SVGGElement>('[data-bar]').forEach(restore); }, [layout]);

  const preview = (a: Active) => {
    const bar = bars.current.get(a.id)!;
    if (a.mode === 'move') return a.g.setAttribute('transform', a.days ? `translate(${a.days * px},0)` : '');
    const w = Math.max(px * 0.5, bar.width + a.days * px);
    a.g.querySelector('rect.g-bar')?.setAttribute('width', String(w));
    a.g.querySelector('.g-handle')?.setAttribute('x', String(bar.x + w - 5));
    a.g.querySelector('text')?.setAttribute('x', String(bar.x + w + 6));
  };
  const barOf = (el: EventTarget | null) => {
    const node = el as Element | null;
    const g = node?.closest?.('[data-bar]') as SVGGElement | null;
    return g ? { g, id: g.getAttribute('data-bar')!, handle: !!node?.closest?.('[data-handle]') } : null;
  };
  const describe = (a: Active) => {
    const bar = bars.current.get(a.id)!;
    return a.mode === 'move'
      ? `${bar.label}: nuevo inicio propuesto ${shiftIso(bar.start, a.days)} (Enter guarda, Escape cancela).`
      : `${bar.label}: duración propuesta ${durationForFinish(bar.start, shiftIso(bar.finish, a.days), cal)} día(s) laborable(s) (Enter guarda, Escape cancela).`;
  };

  async function commit(a: Active) {
    const bar = bars.current.get(a.id);
    if (!bar || a.days === 0) return restore(a.g);
    let save: () => ReturnType<typeof moveActivity>; let done: string;
    if (a.mode === 'move') {
      const date = shiftIso(bar.start, a.days);
      save = () => moveActivity(projectId, a.id, date);
      done = `${bar.label}: no empezará antes del ${date}. Si las dependencias la fuerzan más tarde, la barra no se adelanta.`;
    } else {
      const dur = durationForFinish(bar.start, shiftIso(bar.finish, a.days), cal);
      if (dur === durationForFinish(bar.start, bar.finish, cal)) return restore(a.g);
      save = () => resizeActivity(projectId, a.id, dur);
      done = `${bar.label}: duración ${dur} día(s) laborable(s).`;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await save();
      if (!r.ok) { restore(a.g); return setMsg({ text: messageFor(r.error), bad: true }); }
      const res = await fetch(`/api/projects/${projectId}/recalculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { restore(a.g); return setMsg({ text: `El cambio se guardó, pero no se pudo recalcular: ${data.message ? String(data.message) : messageFor(data.error as string)}`, bad: true }); }
      setMsg({ text: done, bad: false });
      router.refresh();
    } catch {
      restore(a.g);
      setMsg({ text: 'No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.', bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={root}
      aria-busy={busy}
      onPointerDown={(e) => {
        const hit = barOf(e.target);
        if (!hit || busy || e.button !== 0) return;
        active.current = { id: hit.id, g: hit.g, mode: hit.handle ? 'resize' : 'move', x0: e.clientX, days: 0 };
        (e.target as Element).setPointerCapture?.(e.pointerId);
        hit.g.focus();
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const a = active.current; if (!a) return;
        a.days = snapDays(e.clientX - a.x0, px);
        preview(a);
      }}
      onPointerUp={() => { const a = active.current; active.current = null; if (a) void commit(a); }}
      onPointerCancel={() => { const a = active.current; active.current = null; if (a) restore(a.g); }}
      onKeyDown={(e) => {
        const hit = barOf(e.target);
        if (!hit || busy) return;
        const mode: Mode = e.shiftKey ? 'resize' : 'move';
        let a = active.current && active.current.id === hit.id ? active.current : null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          if (a && a.mode !== mode) { restore(a.g); a = null; }
          if (!a) a = active.current = { id: hit.id, g: hit.g, mode, x0: 0, days: 0 };
          if (mode === 'resize' && bars.current.get(hit.id)?.milestone) return;
          a.days += e.key === 'ArrowRight' ? 1 : -1; preview(a); setMsg({ text: describe(a), bad: false });
          e.preventDefault();
        } else if (e.key === 'Enter' && a) { active.current = null; e.preventDefault(); void commit(a); }
        else if (e.key === 'Escape' && a) { active.current = null; restore(a.g); setMsg(null); }
      }}
    >
      <GanttChart layout={layout} editable />
      <p role="status" aria-live="polite" className={msg?.bad ? 'err' : 'okmsg'}>{busy ? 'Guardando y recalculando…' : msg?.text}</p>
    </div>
  );
}
