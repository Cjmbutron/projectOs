import type { DepType } from '@/lib/schedule/dependency-form';

/** Máquina de estados del modo «crear dependencia»: primero el predecesor, luego el sucesor. */
export type LinkState = { step: 'off' } | { step: 'pick-pred' } | { step: 'pick-succ'; predecessorId: string };
export type LinkEvent = { type: 'toggle' } | { type: 'pick'; id: string } | { type: 'cancel' };
export type LinkStep = { state: LinkState; submit?: { predecessorId: string; successorId: string } };

export function nextLink(state: LinkState, ev: LinkEvent): LinkStep {
  switch (ev.type) {
    case 'toggle': return { state: state.step === 'off' ? { step: 'pick-pred' } : { step: 'off' } };
    case 'cancel': return { state: state.step === 'off' ? state : { step: 'pick-pred' } };
    case 'pick':
      if (state.step === 'off') return { state };
      if (state.step === 'pick-pred') return { state: { step: 'pick-succ', predecessorId: ev.id } };
      // segunda selección: la misma barra anula la primera; otra crea la dependencia y deja el modo listo para la siguiente
      if (ev.id === state.predecessorId) return { state: { step: 'pick-pred' } };
      return { state: { step: 'pick-pred' }, submit: { predecessorId: state.predecessorId, successorId: ev.id } };
  }
}

export const DEP_LABEL: Record<DepType, string> = {
  FS: 'Fin a inicio (FS)', SS: 'Inicio a inicio (SS)', FF: 'Fin a fin (FF)', SF: 'Inicio a fin (SF)',
};
