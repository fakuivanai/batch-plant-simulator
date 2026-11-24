// HEAT: bring the contents to a temperature with TIC-201, then keep them
// there for a soak time. (Keeping the temperature is called soaking here, not
// holding: in ISA-88, HOLD is a command with its own meaning.) The soak is a
// pause point: PAUSE stops its clock while the loop keeps the temperature.
//
// When it finishes, holds, stops or aborts, the phase hands TIC-201 back to
// the operator in manual with TV-201 closed.

import { millisecondsPerMinute } from '../../time.ts';
import { done, type PhaseContext, type PhaseDefinition } from '../phase.ts';
import { firstProblem, loopProblem } from './equipment-checks.ts';

export type HeatParameters = { readonly setpointCelsius: number; readonly soakMinutes: number };

type Steps = {
  readonly RUNNING: 'TAKE_LOOP' | 'HEAT_UP' | 'SOAK' | 'STOP_HEATING';
  readonly HOLDING: 'STOP_HEATING';
  readonly RESTARTING: 'TAKE_LOOP';
  readonly STOPPING: 'STOP_HEATING';
  readonly ABORTING: 'STOP_HEATING';
};

type Context = PhaseContext<HeatParameters>;

/** The temperature counts as reached within this much below the setpoint. */
const reachedBandCelsius = 0.5;

/** Closed: no heat goes in once the phase lets go of the loop. */
const outputAfterHeatingPercent = 0;

function takeLoop(context: Context): void {
  context.unit.temperature.setMode('CASCADE', context.actor);
  context.unit.temperature.setSetpoint(context.parameters.setpointCelsius, context.actor);
}

function stopHeating(context: Context): typeof done {
  context.unit.temperature.handBack(outputAfterHeatingPercent, context.actor);
  return done;
}

export const heat: PhaseDefinition<HeatParameters, Steps> = {
  name: 'HEAT',
  description: 'Heat the contents to a setpoint and keep them there for a soak time.',
  parameters: {
    setpointCelsius: { description: 'Temperature', unit: '°C', minimum: 20, maximum: 50 },
    soakMinutes: { description: 'Soak time at temperature', unit: 'min', minimum: 0, maximum: 60 },
  },
  logic: {
    RUNNING: {
      firstStep: 'TAKE_LOOP',
      steps: {
        TAKE_LOOP: (context) => {
          takeLoop(context);
          return 'HEAT_UP';
        },
        HEAT_UP: (context) =>
          context.unit.temperature.processValue.value >= context.parameters.setpointCelsius - reachedBandCelsius
            ? 'SOAK'
            : 'HEAT_UP',
        SOAK: (context) =>
          context.stepMilliseconds >= context.parameters.soakMinutes * millisecondsPerMinute ? 'STOP_HEATING' : 'SOAK',
        STOP_HEATING: stopHeating,
      },
    },
    HOLDING: { firstStep: 'STOP_HEATING', steps: { STOP_HEATING: stopHeating } },
    RESTARTING: {
      firstStep: 'TAKE_LOOP',
      steps: {
        TAKE_LOOP: (context) => {
          takeLoop(context);
          return done;
        },
      },
    },
    STOPPING: { firstStep: 'STOP_HEATING', steps: { STOP_HEATING: stopHeating } },
    ABORTING: { firstStep: 'STOP_HEATING', steps: { STOP_HEATING: stopHeating } },
  },
  pausePoints: ['SOAK'],
  failureMonitor: (context) => firstProblem(loopProblem(context.unit.temperature)),
};
