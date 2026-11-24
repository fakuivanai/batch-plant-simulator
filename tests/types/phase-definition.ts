// Compile-time checks: each `@ts-expect-error` below marks code that must not
// compile. If it ever compiles, the type check fails on the unused directive.
// This file is type-checked, never run.

import { done, type PhaseContext, type PhaseDefinition, type StateLogic } from '../../src/engine/procedural-model/phase.ts';

type Steps = {
  readonly RUNNING: 'WORK';
  readonly HOLDING: 'SAFE';
  readonly RESTARTING: 'RESUME';
  readonly STOPPING: 'SAFE';
  readonly ABORTING: 'SAFE';
};
type Parameters = { readonly amount: number };

const safe: StateLogic<'SAFE', PhaseContext<Parameters>> = { firstStep: 'SAFE', steps: { SAFE: () => done } };

export const complete: PhaseDefinition<Parameters, Steps> = {
  name: 'CHARGE_WATER',
  description: 'A phase with logic for every state.',
  parameters: { amount: { description: 'Amount', unit: 'L', minimum: 0, maximum: 1 } },
  logic: {
    RUNNING: { firstStep: 'WORK', steps: { WORK: () => done } },
    HOLDING: safe,
    RESTARTING: { firstStep: 'RESUME', steps: { RESUME: () => done } },
    STOPPING: safe,
    ABORTING: safe,
  },
  pausePoints: ['WORK'],
  failureMonitor: () => null,
};

export const missingHolding: PhaseDefinition<Parameters, Steps> = {
  ...complete,
  // @ts-expect-error A phase has to supply logic for every state that runs logic: HOLDING is missing.
  logic: { RUNNING: complete.logic.RUNNING, RESTARTING: complete.logic.RESTARTING, STOPPING: safe, ABORTING: safe },
};

export const foreignPausePoint: PhaseDefinition<Parameters, Steps> = {
  ...complete,
  // @ts-expect-error A pause point has to be a step of the RUNNING logic.
  pausePoints: ['SAFE'],
};

export const strayStep: StateLogic<'WORK', unknown> = {
  firstStep: 'WORK',
  // @ts-expect-error A step can only lead to a step of its own state's logic.
  steps: { WORK: () => 'ELSEWHERE' },
};

export const undeclaredParameter: PhaseDefinition<Parameters, Steps> = {
  ...complete,
  // @ts-expect-error Every parameter the phase takes needs a definition with its unit and limits.
  parameters: {},
};
