// TRANSFER: empty the tank to the next unit through the transfer equipment
// module. The phase says start and stop; the equipment module knows that the
// valve opens before the pump starts, and the pump stops before the valve
// closes.

import { done, type PhaseContext, type PhaseDefinition } from '../phase.ts';
import { firstProblem, measurementProblem } from './equipment-checks.ts';

/** TRANSFER takes no parameters: it always empties the tank. */
export type TransferParameters = Record<never, number>;

type Steps = {
  readonly RUNNING: 'START_TRANSFER' | 'EMPTY_TANK' | 'STOP_TRANSFER';
  readonly HOLDING: 'STOP_TRANSFER';
  readonly RESTARTING: 'START_TRANSFER';
  readonly STOPPING: 'STOP_TRANSFER';
  readonly ABORTING: 'SHUT_DOWN';
};

type Context = PhaseContext<TransferParameters>;

/**
 * Below this the tank counts as empty, and the pump stops before it runs dry.
 * It is a few times LT-201's noise above zero, so noise can't end the
 * transfer early by much.
 */
const emptyLiters = 2;

function stopTransfer(context: Context): 'STOP_TRANSFER' | typeof done {
  context.unit.transfer.stop();
  return context.unit.transfer.state === 'STOPPED' ? done : 'STOP_TRANSFER';
}

export const transfer: PhaseDefinition<TransferParameters, Steps> = {
  name: 'TRANSFER',
  description: 'Pump the contents to the next unit until the tank is empty.',
  parameters: {},
  logic: {
    RUNNING: {
      firstStep: 'START_TRANSFER',
      steps: {
        START_TRANSFER: (context) => {
          context.unit.transfer.start();
          return 'EMPTY_TANK';
        },
        EMPTY_TANK: (context) =>
          context.unit.transfer.state === 'RUNNING' && context.unit.level.processValue.value < emptyLiters
            ? 'STOP_TRANSFER'
            : 'EMPTY_TANK',
        STOP_TRANSFER: (context) => (stopTransfer(context) === done ? done : 'STOP_TRANSFER'),
      },
    },
    HOLDING: { firstStep: 'STOP_TRANSFER', steps: { STOP_TRANSFER: stopTransfer } },
    RESTARTING: {
      firstStep: 'START_TRANSFER',
      steps: {
        START_TRANSFER: (context) => {
          context.unit.transfer.start();
          return done;
        },
      },
    },
    STOPPING: { firstStep: 'STOP_TRANSFER', steps: { STOP_TRANSFER: stopTransfer } },
    ABORTING: {
      firstStep: 'SHUT_DOWN',
      steps: {
        SHUT_DOWN: (context) => {
          context.unit.transfer.abort();
          return context.unit.transfer.state === 'STOPPED' ? done : 'SHUT_DOWN';
        },
      },
    },
  },
  pausePoints: [],
  failureMonitor: (context) =>
    firstProblem(
      context.unit.transfer.state === 'FAILED' ? `the transfer module failed: ${context.unit.transfer.failure}` : null,
      measurementProblem('LT-201', context.unit.level.processValue),
    ),
};
