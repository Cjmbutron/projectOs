import { toPoints, type GanttLayout } from '@/lib/gantt/layout';

/** Gantt de solo lectura (SVG en el servidor). Las fechas vienen del motor; aquí solo se dibujan. */
export function GanttChart({ layout }: { layout: GanttLayout }) {
  const { width, height, headerHeight: head, rowHeight: rowH, bars, links, ticks, weekends } = layout;
  if (bars.length === 0) return null;
  const critical = bars.filter((b) => b.critical).length;
  return (
    <div className="gantt-scroll" tabIndex={0} aria-label="Diagrama de Gantt, desplazable">
      <svg
        width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Diagrama de Gantt con ${bars.length} actividades, ${critical} en la ruta crítica. La misma información está en la tabla de abajo.`}
        style={{ display: 'block' }}
      >
        <defs>
          <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" className="g-arrow" />
          </marker>
        </defs>
        {weekends.map((w) => <rect key={w.x} x={w.x} y={head} width={w.width} height={height - head} className="g-weekend" />)}
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} x2={t.x} y1={t.major ? 0 : head - 10} y2={height} className={t.major ? 'g-grid-major' : 'g-grid'} />
            <text x={t.x + 3} y={t.major ? 14 : head - 14} className="g-tick">{t.label}</text>
          </g>
        ))}
        {bars.map((b) => (
          <line key={`r${b.row}`} x1={0} x2={width} y1={head + (b.row + 1) * rowH} y2={head + (b.row + 1) * rowH} className="g-grid" />
        ))}
        {links.map((l) => (
          <polyline key={l.key} points={toPoints(l.points)} fill="none" markerEnd="url(#gantt-arrow)"
            className={l.critical ? 'g-link g-link-critical' : 'g-link'} />
        ))}
        {bars.map((b) => (
          <g key={b.id}>
            <title>{`${b.label}: ${b.start}${b.milestone ? '' : ` → ${b.finish}`}${b.critical ? ' (ruta crítica)' : ''}`}</title>
            {b.milestone ? (
              <polygon points={`${b.x + b.width / 2},${b.y} ${b.x + b.width},${b.y + b.height / 2} ${b.x + b.width / 2},${b.y + b.height} ${b.x},${b.y + b.height / 2}`}
                className={b.critical ? 'g-bar g-critical' : 'g-bar'} />
            ) : (
              <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={3} className={b.critical ? 'g-bar g-critical' : 'g-bar'} />
            )}
            <text x={b.x + b.width + 6} y={b.y + b.height / 2 + 4} className="g-label">{b.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
