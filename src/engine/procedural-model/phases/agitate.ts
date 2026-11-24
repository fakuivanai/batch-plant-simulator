// AGITATE: run the agitator at a speed for a time, then stop it. The mixing
// time is a pause point: PAUSE stops the clock with the agitator still
// running, and RESUME carries on with the time that was left.

import { millisecondsPerMinute } from '../../time.ts';
import { done, type PhaseContext, type PhaseDefinition } from '../phase.ts';
import { deviceProblem } from './equipment-checks.ts';

export type AgitateParameters = { readonly speedRpm: number; readonly durationMinutes: number };

type Steps = {
  readonly RUNNING: 'TAKE_AGITATOR' | 'START_AGITATOR' | 'MIX' | 'STOP_AGITATOR';
  readonly HOLDING: 'STOP_AGITATOR';
  readonly RESTARTING: 'TAKE_AGITATOR' | 'START_AGITATOR';
  readonly STOPPING: 'STOP_AGITATOR';
  readonly ABORTING: 'STOP_AGITATOR';
};

type Context = PhaseContext<AgitateParameters>;

function takeAgitator(context: Context): void {
  context.unit.agitator.setMode('CASCADE', context.actor);
  context.unit.agitator.setSpeed(context.parameters.speedRpm, context.actor);
}

/** Runs the agitator and reports whether its run feedback has come. */
function runAgitator(context: Context): boolean {
  context.unit.agitator.command(true, context.actor);
  return context.unit.agitator.confirmedActive;
}

function stopAgitator(context: Context): 'STOP_AGITATOR' | typeof done {
  context.unit.agitator.command(false, context.actor);
  return context.unit.agitator.confirmedPassive || context.unit.agitator.failure !== null ? done : 'STOP_AGITATOR';
}

export const agitate: PhaseDefinition<AgitateParameters, Steps> = {
  name: 'AGITATE',
  description: 'Run the agitator at a set speed for a set time.',
  parameters: {
    speedRpm: { description: 'Agitator speed', unit: 'rpm', minimum: 50, maximum: 300 },
    durationMinutes: { description: 'Mixing time', unit: 'min', minimum: 1, maximum: 60 },
  },
  logic: {
    RUNNING: {
      firstStep: 'TAKE_AGITATOR',
      steps: {
        TAKE_AGITATOR: (context) => {
          takeAgitator(context);
          return 'START_AGITATOR';
        },
        START_AGITATOR: (context) => (runAgitator(context) ? 'MIX' : 'START_AGITATOR'),
        MIX: (context) => {
          runAgitator(context);
          return context.stepMilliseconds >= context.parameters.durationMinutes * millisecondsPerMinute ? 'STOP_AGITATOR' : 'MIX';
        },
        STOP_AGITATOR: (context) => (stopAgitator(context) === done ? done : 'STOP_AGITATOR'),
      },
    },
    HOLDING: { firstStep: 'STOP_AGITATOR', steps: { STOP_AGITATOR: stopAgitator } },
    RESTARTING: {
      firstStep: 'TAKE_AGITATOR',
      steps: {
        TAKE_AGITATOR: (context) => {
          takeAgitator(context);
          return 'START_AGITATOR';
        },
        START_AGITATOR: (context) => (runAgitator(context) ? done : 'START_AGITATOR'),
      },
    },
    STOPPING: { firstStep: 'STOP_AGITATOR', steps: { STOP_AGITATOR: stopAgitator } },
    ABORTING: {
      firstStep: 'STOP_AGITATOR',
      steps: {
        STOP_AGITATOR: (context) => {
          context.unit.agitator.command(false, context.actor);
          return done;
        },
      },
    },
  },
  pausePoints: ['MIX'],
  failureMonitor: (context) => deviceProblem(context.unit.agitator),
};
