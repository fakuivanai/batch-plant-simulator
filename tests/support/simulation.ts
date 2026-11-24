// Helpers for driving a whole simulation from a test.
import assert from 'node:assert/strict';
import type { PhaseName } from '../../src/engine/procedural-model/phase.ts';
import { bufferPreparation } from '../../src/engine/procedural-model/recipe.ts';
import type { ProceduralCommand, ProceduralState } from '../../src/engine/procedural-model/state-machine.ts';
import { Simulator, type OperatorCommand } from '../../src/engine/simulator.ts';
import { stepsIn } from '../../src/engine/time.ts';

export const operatorName = 'Test operator';

export function runFor(simulator: Simulator, milliseconds: number): void {
  for (let step = 0; step < stepsIn(milliseconds); step++) simulator.step();
}

/** Steps until the condition holds, failing the test if it doesn't within the limit. */
export function runUntil(simulator: Simulator, condition: () => boolean, limitMilliseconds: number, what: string): void {
  for (let step = 0; step < stepsIn(limitMilliseconds); step++) {
    if (condition()) return;
    simulator.step();
  }
  assert.ok(condition(), `${what} did not happen within ${limitMilliseconds / 1000} s of simulated time`);
}

/** An operator command that the test expects to be accepted. */
export function operate(simulator: Simulator, command: OperatorCommand): void {
  const result = simulator.operate(operatorName, command);
  assert.deepEqual(result, { ok: true }, `${command.kind} was refused`);
}

/** Fills the tank by hand through XV-201 to about the given volume. */
export function chargeByHand(simulator: Simulator, liters: number): void {
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' });
  operate(simulator, { kind: 'command-device', module: 'XV-201', active: true });
  runUntil(simulator, () => simulator.unit.level.processValue.value >= liters, 20 * 60_000, `filling to ${liters} L`);
  operate(simulator, { kind: 'command-device', module: 'XV-201', active: false });
  runUntil(simulator, () => simulator.unit.inletValve.confirmedPassive, 20_000, 'closing XV-201');
}

/** Sends a phase command as the operator, expecting it to be accepted. */
export function commandPhase(
  simulator: Simulator,
  phase: PhaseName,
  command: ProceduralCommand,
  parameters?: Readonly<Record<string, number>>,
): void {
  operate(simulator, parameters === undefined ? { kind: 'phase-command', phase, command } : { kind: 'phase-command', phase, command, parameters });
}

/** Steps until the phase reaches the state. */
export function runUntilPhase(simulator: Simulator, phase: PhaseName, state: ProceduralState, limitMilliseconds: number): void {
  runUntil(simulator, () => simulator.phase(phase).state === state, limitMilliseconds, `${phase} reaching ${state}`);
}

/** The master recipe's default formula, with some values changed. */
export function formula(changes: Readonly<Record<string, number>> = {}): Record<string, number> {
  return { ...Object.fromEntries(Object.entries(bufferPreparation.formula).map(([name, value]) => [name, value.defaultValue])), ...changes };
}

/** A shorter formula for tests that only need a batch to run: same steps, quicker times. */
export const quickFormula = formula({ waterVolume: 300, mixTime: 2, soakTime: 2, temperature: 30 });

export function createAndStartBatch(
  simulator: Simulator,
  values: Readonly<Record<string, number>>,
  reason = 'Shorter batch for a test',
): string {
  const result = simulator.operate(operatorName, { kind: 'create-batch', formula: values }, reason);
  assert.deepEqual(result, { ok: true }, 'create-batch was refused');
  operate(simulator, { kind: 'batch-command', command: 'START' });
  const batch = simulator.snapshot().batches.at(-1);
  assert.ok(batch !== undefined);
  return batch.id;
}

export function batchState(simulator: Simulator): ProceduralState | undefined {
  return simulator.snapshot().batches.at(-1)?.state;
}
