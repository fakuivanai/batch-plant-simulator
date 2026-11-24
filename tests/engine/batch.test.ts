import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator } from '../../src/engine/simulator.ts';
import { millisecondsPerMinute } from '../../src/engine/time.ts';
import {
  batchState,
  createAndStartBatch,
  formula,
  operate,
  operatorName,
  quickFormula,
  runFor,
  runUntil,
} from '../support/simulation.ts';

const minute = millisecondsPerMinute;

function runUntilBatch(simulator: Simulator, state: string, limitMilliseconds: number): void {
  runUntil(simulator, () => batchState(simulator) === state, limitMilliseconds, `the batch reaching ${state}`);
}

test('a batch runs its procedure: CHARGE_WATER, AGITATE, HEAT and TRANSFER, in order, and completes', () => {
  const simulator = new Simulator(1);
  const id = createAndStartBatch(simulator, formula());
  runUntilBatch(simulator, 'COMPLETE', 90 * minute);
  const started = simulator
    .snapshot()
    .journal.flatMap((entry) => (entry.event.kind === 'procedure-step-started' ? [entry.event.phase] : []));
  assert.deepEqual(started, ['CHARGE_WATER', 'AGITATE', 'HEAT', 'TRANSFER']);
  assert.ok(simulator.unit.level.processValue.value < 2, 'the tank was emptied');
  assert.equal(simulator.snapshot().batches.at(-1)?.id, id);
});

test('the batch owns its phases while it runs: the operator commands the batch, and gets the phases back at its end', () => {
  const simulator = new Simulator(1);
  createAndStartBatch(simulator, quickFormula);
  simulator.step();
  assert.deepEqual(
    simulator.operate(operatorName, { kind: 'phase-command', phase: 'CHARGE_WATER', command: 'HOLD' }),
    { ok: false, error: 'OWNED_BY_BATCH' },
  );
  runUntilBatch(simulator, 'COMPLETE', 60 * minute);
  for (const phase of Object.values(simulator.snapshot().phases)) {
    assert.deepEqual([phase.state, phase.owner], ['IDLE', { kind: 'operator' }], phase.name);
  }
});

test('holding the batch holds its active phase, and restarting the batch restarts it', () => {
  const simulator = new Simulator(1);
  createAndStartBatch(simulator, quickFormula);
  runFor(simulator, minute);
  operate(simulator, { kind: 'batch-command', command: 'HOLD' });
  runUntilBatch(simulator, 'HELD', 30_000);
  assert.equal(simulator.phase('CHARGE_WATER').state, 'HELD');
  operate(simulator, { kind: 'batch-command', command: 'RESTART' });
  runUntilBatch(simulator, 'RUNNING', 30_000);
  assert.equal(simulator.phase('CHARGE_WATER').state, 'RUNNING');
  runUntilBatch(simulator, 'COMPLETE', 60 * minute);
});

test("PAUSE stops the batch at the next boundary between phases, and RESUME starts the next phase", () => {
  const simulator = new Simulator(1);
  createAndStartBatch(simulator, quickFormula);
  runFor(simulator, minute);
  operate(simulator, { kind: 'batch-command', command: 'PAUSE' });
  runUntilBatch(simulator, 'PAUSED', 10 * minute);
  assert.equal(simulator.phase('CHARGE_WATER').state, 'IDLE', 'the running phase finished');
  runFor(simulator, 5 * minute);
  assert.equal(simulator.phase('AGITATE').state, 'IDLE', 'the next phase waits');
  operate(simulator, { kind: 'batch-command', command: 'RESUME' });
  runFor(simulator, 1000);
  assert.equal(simulator.phase('AGITATE').state, 'RUNNING');
});

test('stopping or aborting a batch needs a reason, ends its active phase and ends the batch', () => {
  for (const [command, final] of [['STOP', 'STOPPED'], ['ABORT', 'ABORTED']] as const) {
    const simulator = new Simulator(1);
    createAndStartBatch(simulator, quickFormula);
    runFor(simulator, minute);
    assert.deepEqual(
      simulator.operate(operatorName, { kind: 'batch-command', command }),
      { ok: false, error: 'REASON_REQUIRED' },
    );
    assert.deepEqual(simulator.operate(operatorName, { kind: 'batch-command', command }, 'Wrong water grade'), { ok: true });
    runUntilBatch(simulator, final, 30_000);
    // ABORT doesn't wait for the valve to confirm closed, so check what the control system drives.
    simulator.step();
    assert.equal(simulator.unit.inletValve.output, false);
    assert.equal(simulator.phase('CHARGE_WATER').state, 'IDLE');
    assert.equal(simulator.phase('AGITATE').state, 'IDLE', 'nothing after the stop ran');
  }
});

test('a formula value outside its limits is refused, and a value off the default needs a reason', () => {
  const simulator = new Simulator(1);
  const create = (values: Record<string, number>, reason?: string) =>
    simulator.operate(operatorName, { kind: 'create-batch', formula: values }, reason);
  assert.deepEqual(create(formula({ waterVolume: 5000 }), 'Too much'), { ok: false, error: 'BAD_FORMULA' });
  assert.deepEqual(create({ waterVolume: 500 }), { ok: false, error: 'BAD_FORMULA' });
  assert.deepEqual(create(formula({ waterVolume: 450 })), { ok: false, error: 'REASON_REQUIRED' });
  assert.deepEqual(create(formula({ waterVolume: 450 }), 'Smaller lot'), { ok: true });
  const recorded = simulator.snapshot().journal.find(
    (entry) => entry.event.kind === 'formula-value-set' && entry.event.parameter === 'waterVolume',
  );
  assert.deepEqual([recorded?.event, recorded?.reason], [
    { kind: 'formula-value-set', batchId: 'B-0001', parameter: 'waterVolume', from: 500, to: 450, unit: 'L', by: { kind: 'operator', name: operatorName } },
    'Smaller lot',
  ]);
});

test('a formula value can change until the phase that uses it starts', () => {
  const simulator = new Simulator(1);
  createAndStartBatch(simulator, quickFormula);
  runFor(simulator, minute);
  const change = (parameter: string, value: number) =>
    simulator.operate(operatorName, { kind: 'change-formula-value', parameter, value }, 'Adjusted by QA');
  assert.deepEqual(change('waterVolume', 350), { ok: false, error: 'PARAMETER_ALREADY_USED' });
  assert.deepEqual(change('temperature', 32), { ok: true });
  runUntil(simulator, () => simulator.phase('HEAT').state === 'RUNNING', 30 * minute, 'HEAT starting');
  assert.equal(simulator.phase('HEAT').snapshot.parameters?.['setpointCelsius'], 32);
});

test("the batch record is the journal's entries written while the batch was active, and only those", () => {
  const simulator = new Simulator(1);
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' });
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'CASCADE' });
  const id = createAndStartBatch(simulator, quickFormula);
  runUntilBatch(simulator, 'COMPLETE', 60 * minute);
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' });
  const journal = simulator.snapshot().journal;
  const record = journal.filter((entry) => entry.batchId === id);
  assert.equal(record[0]?.event.kind, 'batch-created');
  assert.deepEqual(record.at(-1)?.event, {
    kind: 'batch-state-changed',
    batchId: id,
    from: 'RUNNING',
    to: 'COMPLETE',
    cause: { kind: 'logic-done' },
  });
  // Everything between creation and the end belongs to the batch; nothing outside does.
  const first = journal.indexOf(record[0]!);
  const last = journal.indexOf(record.at(-1)!);
  assert.equal(record.length, last - first + 1);
});

test('the same commands at the same simulated times give an identical journal', () => {
  const run = () => {
    const simulator = new Simulator(5);
    createAndStartBatch(simulator, quickFormula);
    runFor(simulator, 3 * minute);
    operate(simulator, { kind: 'batch-command', command: 'HOLD' });
    runFor(simulator, minute);
    operate(simulator, { kind: 'batch-command', command: 'RESTART' });
    runUntilBatch(simulator, 'COMPLETE', 60 * minute);
    return simulator.snapshot().journal;
  };
  assert.deepStrictEqual(run(), run());
});
