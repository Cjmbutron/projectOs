export interface NavItem { href: string; label: string }

/** Secciones de la barra lateral. «Carga semanal» es una sección propia aunque cuelgue de /resources. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/projects', label: 'Proyectos' },
  { href: '/mis-actividades', label: 'Mis actividades' },
  { href: '/resources', label: 'Recursos' },
  { href: '/resources/load', label: 'Carga semanal' },
];

/** La sección activa es la de coincidencia más específica: «/resources/load» no marca también «/resources». */
export function activeHref(pathname: string, items: NavItem[] = NAV_ITEMS): string | null {
  let best: NavItem | null = null;
  for (const it of items) {
    if (pathname === it.href || pathname.startsWith(it.href + '/')) {
      if (!best || it.href.length > best.href.length) best = it;
    }
  }
  return best ? best.href : null;
}
