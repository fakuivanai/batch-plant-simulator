// Each fault, met by a running batch: the batch holds with the phase's
// reason in its record, and after the repair a restart takes it to the end.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator } from '../../src/engine/simulator.ts';
import { millisecondsPerMinute } from '../../src/engine/time.ts';
import { batchState, createAndStartBatch, operate, quickFormula, runUntil } from '../support/simulation.ts';

const minute = millisecondsPerMinute;

function runUntilBatch(simulator: Simulator, state: string, limitMilliseconds: number): void {
  runUntil(simulator, () => batchState(simulator) === state, limitMilliseconds, `the batch reaching ${state}`);
}

/** The reason the record gives for the batch's last hold. */
function holdReason(simulator: Simulator): string | null {
  const holds = simulator
    .snapshot()
    .journal.flatMap((entry) =>
      entry.event.kind === 'batch-state-changed' && entry.event.cause.kind === 'phase-held'
        ? [`${entry.event.cause.phase}: ${entry.event.cause.reason}`]
        : [],
    );
  return holds.at(-1) ?? null;
}

function restart(simulator: Simulator): void {
  operate(simulator, { kind: 'batch-command', command: 'RESTART' });
}

test('XV-201 fails to open: the batch holds at CHARGE_WATER, and completes after a repair, a reset and a restart', () => {
  const simulator = new Simulator(1);
  simulator.injectFault('inlet-valve-fails-to-open');
  createAndStartBatch(simulator, quickFormula);
  runUntilBatch(simulator, 'HELD', minute);
  assert.equal(holdReason(simulator), 'CHARGE_WATER: XV-201 failed');
  simulator.clearFault('inlet-valve-fails-to-open');
  operate(simulator, { kind: 'reset-device-failure', module: 'XV-201' });
  restart(simulator);
  runUntilBatch(simulator, 'COMPLETE', 60 * minute);
});

test('P-201 fails to start: the batch holds at TRANSFER, and completes after a repair, a reset and a restart', () => {
  const simulator = new Simulator(1);
  createAndStartBatch(simulator, quickFormula);
  runUntil(simulator, () => simulator.phase('HEAT').state === 'RUNNING', 30 * minute, 'HEAT starting');
  simulator.injectFault('pump-fails-to-start');
  runUntilBatch(simulator, 'HELD', 30 * minute);
  assert.equal(holdReason(simulator), 'TRANSFER: the transfer module failed: P-201 failed');
  simulator.clearFault('pump-fails-to-start');
  operate(simulator, { kind: 'reset-device-failure', module: 'P-201' });
  restart(simulator);
  runUntilBatch(simulator, 'COMPLETE', 30 * minute);
});

test('LT-201 stuck: the batch holds at CHARGE_WATER without an overflow, and completes after a repair and a restart', () => {
  const simulator = new Simulator(1);
  createAndStartBatch(simulator, quickFormula);
  runUntil(simulator, () => simulator.unit.level.processValue.value >= 150, 10 * minute, 'charging to 150 L');
  simulator.injectFault('level-transmitter-stuck');
  runUntilBatch(simulator, 'HELD', 15 * minute);
  assert.match(holdReason(simulator) ?? '', /^CHARGE_WATER: /);
  assert.equal(simulator.snapshot().plant.spilledLiters, 0);
  simulator.clearFault('level-transmitter-stuck');
  restart(simulator);
  runUntilBatch(simulator, 'COMPLETE', 60 * minute);
  assert.equal(simulator.snapshot().plant.spilledLiters, 0);
});

test('heater overshoot: the batch holds at HEAT and can only restart once the contents have cooled back within the limit', () => {
  const simulator = new Simulator(1);
  simulator.injectFault('heating-medium-overheated');
  createAndStartBatch(simulator, quickFormula);
  runUntilBatch(simulator, 'HELD', 60 * minute);
  assert.match(holdReason(simulator) ?? '', /^HEAT: TIC-201 high deviation/);
  simulator.clearFault('heating-medium-overheated');
  restart(simulator);
  runUntilBatch(simulator, 'HELD', minute);
  // The loop is in manual now, where its setpoint follows the measurement, so
  // compare with the batch's temperature instead. The margin keeps a noisy
  // reading from crossing the limit again at the restart.
  const limit = (quickFormula['temperature'] ?? Number.NaN) + simulator.unit.temperature.configuration.highDeviationLimit;
  runUntil(
    simulator,
    () => simulator.snapshot().plant.contentsCelsius < limit - 0.5,
    10 * 60 * minute,
    'the contents cooling back within the deviation limit',
  );
  restart(simulator);
  runUntilBatch(simulator, 'COMPLETE', 60 * minute);
});

test('TT-201 failed: the batch holds at HEAT, and completes after a repair and a restart', () => {
  const simulator = new Simulator(1);
  createAndStartBatch(simulator, quickFormula);
  runUntil(simulator, () => simulator.phase('HEAT').state === 'RUNNING', 30 * minute, 'HEAT starting');
  simulator.injectFault('temperature-transmitter-failed');
  runUntilBatch(simulator, 'HELD', minute);
  assert.equal(holdReason(simulator), 'HEAT: TIC-201 has shed to MANUAL: TT-201 is BAD');
  simulator.clearFault('temperature-transmitter-failed');
  restart(simulator);
  runUntilBatch(simulator, 'COMPLETE', 60 * minute);
});
