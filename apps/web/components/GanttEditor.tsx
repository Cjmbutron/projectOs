'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GanttChart } from '@/components/GanttChart';
import { messageFor } from '@/lib/errors';
import { shiftIso, snapDays } from '@/lib/gantt/drag';
import type { GanttLayout } from '@/lib/gantt/layout';
import { moveActivity } from '@/app/projects/[id]/gantt/actions';

/** Gantt editable: arrastre con puntero o teclado. Solo dibuja y propone; las fechas las calcula el motor al recalcular. */
export function GanttEditor({ layout, projectId }: { layout: GanttLayout; projectId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; g: SVGGElement; x0: number; days: number } | null>(null);
  const bars = useRef(new Map(layout.bars.map((b) => [b.id, b])));
  bars.current = new Map(layout.bars.map((b) => [b.id, b]));

  // Con datos nuevos (tras recalcular) las barras ya vienen en su posición real: se quita el desplazamiento provisional.
  useEffect(() => { root.current?.querySelectorAll('[data-bar]').forEach((g) => g.removeAttribute('transform')); }, [layout]);

  const show = (g: SVGGElement, days: number) => g.setAttribute('transform', days ? `translate(${days * layout.pxPerDay},0)` : '');
  const barOf = (el: EventTarget | null) => {
    const g = (el as Element | null)?.closest?.('[data-bar]') as SVGGElement | null;
    return g ? { g, id: g.getAttribute('data-bar')! } : null;
  };

  async function commit(id: string, g: SVGGElement, days: number) {
    const bar = bars.current.get(id);
    if (!bar || days === 0) return show(g, 0);
    const date = shiftIso(bar.start, days);
    setBusy(true); setMsg(null);
    try {
      const r = await moveActivity(projectId, id, date);
      if (!r.ok) { show(g, 0); return setMsg({ text: messageFor(r.error), bad: true }); }
      const res = await fetch(`/api/projects/${projectId}/recalculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { show(g, 0); return setMsg({ text: `Se guardó «no empezar antes del ${date}», pero no se pudo recalcular: ${data.message ? String(data.message) : messageFor(data.error as string)}`, bad: true }); }
      setMsg({ text: `${bar.label}: no empezará antes del ${date}. Si las dependencias la fuerzan más tarde, la barra no se adelanta.`, bad: false });
      router.refresh();
    } catch {
      show(g, 0);
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
        drag.current = { id: hit.id, g: hit.g, x0: e.clientX, days: 0 };
        hit.g.setPointerCapture?.(e.pointerId);
        hit.g.focus();
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        d.days = snapDays(e.clientX - d.x0, layout.pxPerDay);
        show(d.g, d.days);
      }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d) void commit(d.id, d.g, d.days); }}
      onPointerCancel={() => { const d = drag.current; drag.current = null; if (d) show(d.g, 0); }}
      onKeyDown={(e) => {
        const hit = barOf(e.target);
        if (!hit || busy) return;
        const cur = drag.current && drag.current.id === hit.id ? drag.current : (drag.current = { id: hit.id, g: hit.g, x0: 0, days: 0 });
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          cur.days += e.key === 'ArrowRight' ? 1 : -1; show(hit.g, cur.days);
          const bar = bars.current.get(hit.id)!;
          setMsg({ text: `${bar.label}: nuevo inicio propuesto ${shiftIso(bar.start, cur.days)} (Enter guarda, Escape cancela).`, bad: false });
          e.preventDefault();
        } else if (e.key === 'Enter') { drag.current = null; e.preventDefault(); void commit(hit.id, hit.g, cur.days); }
        else if (e.key === 'Escape') { drag.current = null; show(hit.g, 0); setMsg(null); }
      }}
    >
      <GanttChart layout={layout} editable />
      <p role="status" aria-live="polite" className={msg?.bad ? 'err' : 'okmsg'}>{busy ? 'Guardando y recalculando…' : msg?.text}</p>
    </div>
  );
}
