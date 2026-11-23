'use client';
import { useRef, useState } from 'react';
import { COLUMNS, type Status } from '@/lib/board';

export interface Card {
  id: string; name: string; percent: number; status: Status; duration: number;
  dates: string; assignee: string | null; badge: { text: string; cls: string } | null;
  moves: { to: Status; label: string }[]; canMove: boolean;
}

/** Tablero por estado. Arrastrar una tarjeta o usar «Mover a…» envía el mismo formulario al servidor. */
export function KanbanBoard({ projectId, cards, action }: { projectId: string; cards: Card[]; action: (fd: FormData) => void | Promise<void> }) {
  const [over, setOver] = useState<Status | null>(null);
  const formRefs = useRef<Record<string, HTMLFormElement | null>>({});
  const dragged = useRef<string | null>(null);

  function drop(to: Status) {
    setOver(null);
    const id = dragged.current; dragged.current = null;
    const card = cards.find((c) => c.id === id);
    const form = id ? formRefs.current[id] : null;
    if (!card || !form || !card.canMove || !card.moves.some((m) => m.to === to)) return;
    (form.elements.namedItem('to') as HTMLInputElement).value = to;
    form.requestSubmit();
  }

  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const items = cards.filter((c) => c.status === col.status);
        return (
          <section key={col.status} className={`board-col${over === col.status ? ' over' : ''}`} aria-label={`${col.label}, ${items.length} actividad(es)`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.status); }} onDragLeave={() => setOver((o) => (o === col.status ? null : o))} onDrop={(e) => { e.preventDefault(); drop(col.status); }}>
            <h2 className="board-title">{col.label} <span className="badge badge-neutral">{items.length}</span></h2>
            {items.length === 0 && <p className="empty">Sin actividades</p>}
            {items.map((c) => (
              <article key={c.id} className="board-card" draggable={c.canMove} onDragStart={() => { dragged.current = c.id; }} onDragEnd={() => { dragged.current = null; setOver(null); }}>
                <strong>{c.name}</strong>
                <div className="board-meta"><span>{c.percent} %</span>{c.duration === 0 && <span>Hito</span>}{c.assignee && <span>{c.assignee}</span>}</div>
                <div className="board-meta"><span>{c.dates}</span>{c.badge && <span className={`badge ${c.badge.cls}`}>{c.badge.text}</span>}</div>
                {c.canMove && c.moves.length > 0 && (
                  <form action={action} ref={(el) => { formRefs.current[c.id] = el; }} className="board-move">
                    <input type="hidden" name="project" value={projectId} /><input type="hidden" name="activity" value={c.id} />
                    <input type="hidden" name="to" value={c.moves[0].to} />
                    <label className="sr-only" htmlFor={`mv-${c.id}`}>Mover {c.name} a</label>
                    <select id={`mv-${c.id}`} onChange={(e) => { (e.currentTarget.form!.elements.namedItem('to') as HTMLInputElement).value = e.target.value; }}>
                      {c.moves.map((m) => <option key={m.to} value={m.to}>{m.label}</option>)}
                    </select>
                    <button className="secondary">Mover</button>
                  </form>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
