import { describe, expect, it } from 'vitest';
import { activeHref, NAV_ITEMS } from '@/lib/nav';
import { HEALTH_BADGE } from '@/lib/health';

describe('activeHref', () => {
  it('marca la sección de la ruta', () => {
    expect(activeHref('/projects')).toBe('/projects');
    expect(activeHref('/projects/abc/gantt')).toBe('/projects');
    expect(activeHref('/mis-actividades')).toBe('/mis-actividades');
    expect(activeHref('/resources')).toBe('/resources');
  });
  it('la carga semanal marca solo su propia sección, no Recursos', () => {
    expect(activeHref('/resources/load')).toBe('/resources/load');
    expect(activeHref('/resources/load/extra')).toBe('/resources/load');
  });
  it('no confunde prefijos parecidos ni rutas ajenas', () => {
    expect(activeHref('/projectsx')).toBeNull();
    expect(activeHref('/resourcesx')).toBeNull();
    expect(activeHref('/login')).toBeNull();
    expect(activeHref('/')).toBeNull();
  });
  it('las rutas de la barra son únicas', () => { expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length); });
});

describe('HEALTH_BADGE', () => {
  it('una clase por estado de salud', () => {
    expect(HEALTH_BADGE.green).toContain('badge-ok');
    expect(HEALTH_BADGE.amber).toContain('badge-warn');
    expect(HEALTH_BADGE.red).toContain('badge-danger');
    expect(HEALTH_BADGE.unknown).toContain('badge-neutral');
  });
});
