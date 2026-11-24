// An outside batch engine driving the phases, as one would over OPC UA.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { watchdogTimeoutMilliseconds } from '../../src/engine/procedural-model/phase.ts';
import { Simulator } from '../../src/engine/simulator.ts';
import { formula, operate, operatorName, runFor, runUntil } from '../support/simulation.ts';

const engine = 'Test batch engine';

function handOver(simulator: Simulator, owner: 'operator' | 'external'): void {
  operate(simulator, { kind: 'set-phase-owner', phase: 'CHARGE_WATER', owner });
}

test('once the operator hands a phase to the batch engine only the engine commands it, until the operator takes it back', () => {
  const simulator = new Simulator(1);
  const external = (command: 'START' | 'HOLD') =>
    simulator.operateExternal(engine, {
      kind: 'phase-command',
      phase: 'CHARGE_WATER',
      command,
      ...(command === 'START' ? { parameters: { targetVolumeLiters: 300 } } : {}),
    });
  assert.deepEqual(external('START'), { ok: false, error: 'NOT_OWNER' });
  handOver(simulator, 'external');
  assert.deepEqual(
    simulator.operate(operatorName, { kind: 'phase-command', phase: 'CHARGE_WATER', command: 'START', parameters: { targetVolumeLiters: 300 } }),
    { ok: false, error: 'OWNED_BY_BATCH_ENGINE' },
  );
  assert.deepEqual(external('START'), { ok: true });
  handOver(simulator, 'operator');
  assert.deepEqual(external('HOLD'), { ok: false, error: 'NOT_OWNER' });
  operate(simulator, { kind: 'phase-command', phase: 'CHARGE_WATER', command: 'HOLD' });
  const owners = simulator
    .snapshot()
    .journal.flatMap((entry) => (entry.event.kind === 'phase-owner-changed' ? [`${entry.event.from.kind} → ${entry.event.to.kind}`] : []));
  assert.deepEqual(owners, ['operator → external', 'external → operator']);
});

test('a phase the batch engine drives holds once the engine stops writing new watchdog values', () => {
  const simulator = new Simulator(1);
  handOver(simulator, 'external');
  simulator.operateExternal(engine, {
    kind: 'phase-command',
    phase: 'CHARGE_WATER',
    command: 'START',
    parameters: { targetVolumeLiters: 600 },
  });
  for (let second = 1; second <= 30; second++) {
    simulator.operateExternal(engine, { kind: 'feed-watchdog', phase: 'CHARGE_WATER', value: second });
    runFor(simulator, 1000);
  }
  assert.equal(simulator.phase('CHARGE_WATER').state, 'RUNNING', 'a fed watchdog keeps the phase running');
  runFor(simulator, watchdogTimeoutMilliseconds - 1000);
  assert.equal(simulator.phase('CHARGE_WATER').state, 'RUNNING', 'not before the timeout');
  runUntil(simulator, () => simulator.phase('CHARGE_WATER').state === 'HELD', 20_000, 'the phase holding');
  assert.match(simulator.phase('CHARGE_WATER').snapshot.failure ?? '', /^lost contact with the batch engine/);
});

test("our own batch can't start while a phase belongs to the batch engine, and can't be handed one it owns", () => {
  const simulator = new Simulator(1);
  handOver(simulator, 'external');
  operate(simulator, { kind: 'create-batch', formula: formula() });
  assert.deepEqual(simulator.operate(operatorName, { kind: 'batch-command', command: 'START' }), {
    ok: false,
    error: 'EQUIPMENT_NOT_AVAILABLE',
  });
  handOver(simulator, 'operator');
  operate(simulator, { kind: 'batch-command', command: 'START' });
  assert.deepEqual(
    simulator.operate(operatorName, { kind: 'set-phase-owner', phase: 'CHARGE_WATER', owner: 'external' }),
    { ok: false, error: 'OWNED_BY_BATCH' },
  );
});
