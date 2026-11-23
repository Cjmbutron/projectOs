import { describe, expect, it } from 'vitest';
import { nextLink, type LinkState } from '@/lib/gantt/link';

const off: LinkState = { step: 'off' };
describe('nextLink', () => {
  it('activar y desactivar el modo', () => {
    expect(nextLink(off, { type: 'toggle' }).state).toEqual({ step: 'pick-pred' });
    expect(nextLink({ step: 'pick-pred' }, { type: 'toggle' }).state).toEqual(off);
    expect(nextLink({ step: 'pick-succ', predecessorId: 'a' }, { type: 'toggle' }).state).toEqual(off);
  });
  it('con el modo apagado, seleccionar no hace nada', () => {
    expect(nextLink(off, { type: 'pick', id: 'a' })).toEqual({ state: off });
    expect(nextLink(off, { type: 'cancel' })).toEqual({ state: off });
  });
  it('primero predecesor, luego sucesor: crea y queda listo para otra', () => {
    const s1 = nextLink({ step: 'pick-pred' }, { type: 'pick', id: 'a' });
    expect(s1).toEqual({ state: { step: 'pick-succ', predecessorId: 'a' } });
    expect(s1.submit).toBeUndefined();
    const s2 = nextLink(s1.state, { type: 'pick', id: 'b' });
    expect(s2).toEqual({ state: { step: 'pick-pred' }, submit: { predecessorId: 'a', successorId: 'b' } });
  });
  it('elegir la misma barra dos veces anula, sin crear nada', () => {
    const r = nextLink({ step: 'pick-succ', predecessorId: 'a' }, { type: 'pick', id: 'a' });
    expect(r).toEqual({ state: { step: 'pick-pred' } });
  });
  it('cancelar vuelve a pedir predecesor sin salir del modo', () => {
    expect(nextLink({ step: 'pick-succ', predecessorId: 'a' }, { type: 'cancel' }).state).toEqual({ step: 'pick-pred' });
    expect(nextLink({ step: 'pick-pred' }, { type: 'cancel' }).state).toEqual({ step: 'pick-pred' });
  });
});
