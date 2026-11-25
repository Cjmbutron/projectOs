'use client';
import { useRef, useState } from 'react';
import { COLUMNS, type Status } from '@/lib/board';
import { MAX_NOTE, type NoteView } from '@/lib/notes';

export interface Card {
  id: string; name: string; percent: number; status: Status; duration: number;
  dates: string; assignee: string | null; badge: { text: string; cls: string } | null;
  moves: { to: Status; label: string }[]; canMove: boolean;
  notes: (NoteView & { canEdit: boolean; canDelete: boolean })[]; canAddNote: boolean;
}
type Act = (fd: FormData) => void | Promise<void>;
export interface NoteActions { add: Act; edit: Act; remove: Act }

/** Tablero por estado. Arrastrar una tarjeta o usar «Mover a…» envía el mismo formulario al servidor. */
export function KanbanBoard({ projectId, cards, action, noteActions, openNotes }: { projectId: string; cards: Card[]; action: Act; noteActions: NoteActions; openNotes: string | null }) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set(openNotes ? [openNotes] : []));
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
              <article key={c.id} id={`card-${c.id}`} className="board-card" draggable={c.canMove && !opened.has(c.id)} onDragStart={() => { dragged.current = c.id; }} onDragEnd={() => { dragged.current = null; setOver(null); }}>
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
                {(c.notes.length > 0 || c.canAddNote) && (
                  <details className="notes" open={opened.has(c.id)}
                    onToggle={(e) => { const o = e.currentTarget.open; setOpened((prev) => { if (prev.has(c.id) === o) return prev; const n = new Set(prev); if (o) n.add(c.id); else n.delete(c.id); return n; }); }}>
                    <summary>Notas ({c.notes.length})</summary>
                    <ul className="note-list">
                      {c.notes.map((n) => (
                        <li key={n.id} className="note">
                          <div className="note-head"><strong>{n.author}</strong><span>{n.when}{n.edited ? ' · editada' : ''}</span></div>
                          <p className="note-body">{n.body}</p>
                          {(n.canEdit || n.canDelete) && (
                            <div className="note-actions">
                              {n.canEdit && (
                                <details className="note-edit">
                                  <summary>Editar</summary>
                                  <form action={noteActions.edit}>
                                    <input type="hidden" name="project" value={projectId} /><input type="hidden" name="note" value={n.id} /><input type="hidden" name="activity" value={c.id} />
                                    <label className="sr-only" htmlFor={`ne-${n.id}`}>Editar nota</label>
                                    <textarea id={`ne-${n.id}`} name="body" defaultValue={n.body} rows={3} maxLength={MAX_NOTE} required />
                                    <button className="secondary">Guardar</button>
                                  </form>
                                </details>
                              )}
                              {n.canDelete && (
                                <form action={noteActions.remove}>
                                  <input type="hidden" name="project" value={projectId} /><input type="hidden" name="note" value={n.id} /><input type="hidden" name="activity" value={c.id} />
                                  <button className="secondary danger" aria-label={`Eliminar nota de ${n.author}`}>Eliminar</button>
                                </form>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {c.canAddNote && (
                      <form action={noteActions.add} className="note-new">
                        <input type="hidden" name="project" value={projectId} /><input type="hidden" name="activity" value={c.id} />
                        <label className="sr-only" htmlFor={`nn-${c.id}`}>Nueva nota en {c.name}</label>
                        <textarea id={`nn-${c.id}`} name="body" rows={3} maxLength={MAX_NOTE} placeholder="Escribe una nota para el equipo…" required />
                        <button>Agregar nota</button>
                      </form>
                    )}
                  </details>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
