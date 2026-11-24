// CHARGE_WATER: open the water inlet until the tank holds the target volume,
// then close it.

import { millisecondsPerMinute } from '../../time.ts';
import { done, type PhaseContext, type PhaseDefinition } from '../phase.ts';
import { deviceProblem, firstProblem, measurementProblem } from './equipment-checks.ts';

export type ChargeWaterParameters = { readonly targetVolumeLiters: number };

type Steps = {
  readonly RUNNING: 'TAKE_INLET' | 'FILL' | 'CLOSE_INLET';
  readonly HOLDING: 'CLOSE_INLET';
  readonly RESTARTING: 'TAKE_INLET';
  readonly STOPPING: 'CLOSE_INLET';
  readonly ABORTING: 'CLOSE_INLET';
};

type Context = PhaseContext<ChargeWaterParameters>;

/**
 * The inlet line is designed for 100 L/min. A charge that takes more than
 * half as long again as that flow needs, plus a minute, means the water isn't
 * arriving or isn't being measured, as with a stuck level transmitter.
 */
const designFlowLitersPerMinute = 100;
function chargeTimeLimitMilliseconds(targetVolumeLiters: number): number {
  return 1.5 * (targetVolumeLiters / designFlowLitersPerMinute) * millisecondsPerMinute + millisecondsPerMinute;
}

function closeInlet(context: Context): 'CLOSE_INLET' | typeof done {
  context.unit.inletValve.command(false, context.actor);
  return context.unit.inletValve.confirmedPassive || context.unit.inletValve.failure !== null ? done : 'CLOSE_INLET';
}

export const chargeWater: PhaseDefinition<ChargeWaterParameters, Steps> = {
  name: 'CHARGE_WATER',
  description: 'Open the water inlet until the tank holds the target volume.',
  parameters: {
    targetVolumeLiters: { description: 'Water to charge', unit: 'L', minimum: 100, maximum: 850 },
  },
  logic: {
    RUNNING: {
      firstStep: 'TAKE_INLET',
      steps: {
        TAKE_INLET: (context) => {
          context.unit.inletValve.setMode('CASCADE', context.actor);
          return 'FILL';
        },
        FILL: (context) => {
          context.unit.inletValve.command(true, context.actor);
          return context.unit.level.processValue.value >= context.parameters.targetVolumeLiters ? 'CLOSE_INLET' : 'FILL';
        },
        CLOSE_INLET: (context) => (closeInlet(context) === done ? done : 'CLOSE_INLET'),
      },
    },
    HOLDING: { firstStep: 'CLOSE_INLET', steps: { CLOSE_INLET: closeInlet } },
    // Taking the valve back is all a restart needs: FILL opens it again.
    RESTARTING: {
      firstStep: 'TAKE_INLET',
      steps: {
        TAKE_INLET: (context) => {
          context.unit.inletValve.setMode('CASCADE', context.actor);
          return done;
        },
      },
    },
    STOPPING: { firstStep: 'CLOSE_INLET', steps: { CLOSE_INLET: closeInlet } },
    ABORTING: {
      firstStep: 'CLOSE_INLET',
      steps: {
        CLOSE_INLET: (context) => {
          context.unit.inletValve.command(false, context.actor);
          return done;
        },
      },
    },
  },
  pausePoints: [],
  failureMonitor: (context) =>
    firstProblem(
      deviceProblem(context.unit.inletValve),
      measurementProblem('LT-201', context.unit.level.processValue),
      context.runningMilliseconds > chargeTimeLimitMilliseconds(context.parameters.targetVolumeLiters)
        ? `the charge took longer than ${chargeTimeLimitMilliseconds(context.parameters.targetVolumeLiters) / millisecondsPerMinute} min`
        : null,
    ),
};
