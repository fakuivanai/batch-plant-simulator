import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operator, program } from '../../src/engine/actor.ts';
import { highHighTemperatureCelsius, minimumLevelLiters } from '../../src/engine/physical-model/interlocks.ts';
import { Simulator } from '../../src/engine/simulator.ts';
import { chargeByHand, operate, operatorName, runFor, runUntil } from '../support/simulation.ts';

const person = operator(operatorName);
const logic = program('TEST_PHASE');

test('out of service, a device takes no commands from anyone and keeps its output off', () => {
  const simulator = new Simulator(1);
  const valve = simulator.unit.inletValve;
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'OUT_OF_SERVICE' });
  assert.deepEqual(valve.command(true, person), { ok: false, error: 'MODE_REFUSES_ACTOR' });
  assert.deepEqual(valve.command(true, logic), { ok: false, error: 'MODE_REFUSES_ACTOR' });
  runFor(simulator, 1000);
  assert.equal(valve.output, false);
});

test('in manual only the operator commands a device, in cascade only the program', () => {
  const simulator = new Simulator(1);
  const valve = simulator.unit.inletValve;
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' });
  assert.deepEqual(valve.command(true, logic), { ok: false, error: 'MODE_REFUSES_ACTOR' });
  assert.deepEqual(valve.command(true, person), { ok: true });
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'CASCADE' });
  assert.deepEqual(valve.command(false, person), { ok: false, error: 'MODE_REFUSES_ACTOR' });
  assert.deepEqual(valve.command(false, logic), { ok: true });
});

test('a program can take a module from manual into cascade, but nowhere else and not from out of service', () => {
  const simulator = new Simulator(1);
  const valve = simulator.unit.inletValve;
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' });
  assert.deepEqual(valve.setMode('CASCADE', logic), { ok: true });
  assert.deepEqual(valve.setMode('MANUAL', logic), { ok: false, error: 'MODE_REFUSES_ACTOR' });
  assert.deepEqual(valve.setMode('OUT_OF_SERVICE', logic), { ok: false, error: 'MODE_REFUSES_ACTOR' });
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'OUT_OF_SERVICE' });
  assert.deepEqual(valve.setMode('CASCADE', logic), { ok: false, error: 'MODE_REFUSES_ACTOR' });
});

test('an analog input out of service reads BAD and raises no alarm', () => {
  const simulator = new Simulator(1);
  operate(simulator, { kind: 'set-level-mode', mode: 'OUT_OF_SERVICE' });
  runFor(simulator, 1000);
  assert.equal(simulator.unit.level.processValue.status, 'BAD');
  assert.deepEqual(simulator.snapshot().alarms, []);
});

test('in automatic the loop brings the temperature to its setpoint, overshooting by less than the high deviation limit', () => {
  for (const setpoint of [25, 37, 50]) {
    const simulator = new Simulator(1);
    const loop = simulator.unit.temperature;
    chargeByHand(simulator, 500);
    operate(simulator, { kind: 'set-loop-mode', mode: 'AUTOMATIC' });
    operate(simulator, { kind: 'set-loop-setpoint', value: setpoint });
    let highest = -Infinity;
    for (let minute = 0; minute < 60; minute++) {
      runFor(simulator, 60_000);
      highest = Math.max(highest, loop.processValue.value);
      assert.equal(loop.highDeviation, false, `high deviation at ${setpoint} °C`);
    }
    assert.ok(highest > setpoint, `the temperature reached ${setpoint} °C`);
    assert.ok(Math.abs(loop.processValue.value - setpoint) < loop.configuration.highDeviationLimit);
  }
});

test('the LSHH-201 interlock closes XV-201 in manual and in cascade', () => {
  for (const mode of ['MANUAL', 'CASCADE'] as const) {
    const simulator = new Simulator(1);
    const valve = simulator.unit.inletValve;
    operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode });
    assert.deepEqual(valve.command(true, mode === 'MANUAL' ? person : logic), { ok: true });
    runUntil(simulator, () => simulator.unit.highHighLevel.tripped, 15 * 60_000, 'LSHH-201 tripping');
    simulator.step();
    assert.equal(valve.output, false);
    assert.deepEqual(valve.command(true, mode === 'MANUAL' ? person : logic), { ok: false, error: 'INTERLOCKED' });
  }
});

test('the XV-202 interlock stops P-201 in manual and in cascade, and P-201 stays stopped when XV-202 reopens', () => {
  for (const mode of ['MANUAL', 'CASCADE'] as const) {
    const simulator = new Simulator(1);
    const actor = mode === 'MANUAL' ? person : logic;
    chargeByHand(simulator, 300);
    const { outletValve, transferPump } = simulator.unit;
    operate(simulator, { kind: 'set-device-mode', module: 'XV-202', mode: 'MANUAL' });
    operate(simulator, { kind: 'set-device-mode', module: 'P-201', mode });
    assert.deepEqual(transferPump.command(true, actor), { ok: false, error: 'INTERLOCKED' });
    operate(simulator, { kind: 'command-device', module: 'XV-202', active: true });
    runUntil(simulator, () => outletValve.confirmedActive, 10_000, 'XV-202 opening');
    assert.deepEqual(transferPump.command(true, actor), { ok: true });
    runUntil(simulator, () => transferPump.confirmedActive, 5_000, 'P-201 starting');
    operate(simulator, { kind: 'command-device', module: 'XV-202', active: false });
    runUntil(simulator, () => !outletValve.confirmedActive, 1000, 'XV-202 leaving its open position');
    simulator.step();
    assert.equal(transferPump.output, false);
    operate(simulator, { kind: 'command-device', module: 'XV-202', active: true });
    runUntil(simulator, () => outletValve.confirmedActive, 10_000, 'XV-202 reopening');
    runFor(simulator, 5_000);
    assert.equal(transferPump.output, false);
  }
});

test('the minimum level interlock stops AG-201 and closes TV-201 in every mode', () => {
  const simulator = new Simulator(1);
  runFor(simulator, 1000);
  assert.ok(simulator.unit.level.processValue.value < minimumLevelLiters);
  for (const mode of ['MANUAL', 'CASCADE'] as const) {
    operate(simulator, { kind: 'set-device-mode', module: 'AG-201', mode });
    const actor = mode === 'MANUAL' ? person : logic;
    assert.deepEqual(simulator.unit.agitator.command(true, actor), { ok: false, error: 'INTERLOCKED' });
  }
  operate(simulator, { kind: 'set-loop-mode', mode: 'MANUAL' });
  operate(simulator, { kind: 'set-loop-output', percent: 100 });
  simulator.step();
  assert.equal(simulator.snapshot().outputs['TV-201'].milliamps, 4);
  for (const mode of ['AUTOMATIC', 'CASCADE'] as const) {
    operate(simulator, { kind: 'set-loop-mode', mode });
    simulator.step();
    assert.equal(simulator.snapshot().outputs['TV-201'].milliamps, 4, mode);
  }
});

test('the high-high temperature interlock closes TV-201 even in manual at full opening', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 300);
  operate(simulator, { kind: 'set-loop-mode', mode: 'MANUAL' });
  operate(simulator, { kind: 'set-loop-output', percent: 100 });
  runUntil(
    simulator,
    () => simulator.unit.temperature.processValue.value >= highHighTemperatureCelsius,
    60 * 60_000,
    'heating to the high-high temperature',
  );
  simulator.step();
  assert.equal(simulator.snapshot().outputs['TV-201'].milliamps, 4);
  assert.ok(simulator.snapshot().alarms.some((alarm) => alarm.id === 'TT-201 high-high temperature'));
});

test('every operator change is journaled with who made it, the old and new values, and the reason', () => {
  const simulator = new Simulator(1);
  const result = simulator.operate('A. Operator', { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' }, 'Leak test');
  assert.deepEqual(result, { ok: true });
  simulator.operate('A. Operator', { kind: 'command-device', module: 'XV-201', active: true });
  const entries = simulator.snapshot().journal;
  assert.deepEqual(entries.map((entry) => entry.event), [
    { kind: 'mode-changed', module: 'XV-201', from: 'CASCADE', to: 'MANUAL', by: operator('A. Operator') },
    { kind: 'device-commanded', module: 'XV-201', from: 'CLOSED', to: 'OPEN', by: operator('A. Operator') },
  ]);
  assert.deepEqual(entries.map((entry) => entry.reason), ['Leak test', null]);
});

test('an operator command without a name is refused and leaves no trace', () => {
  const simulator = new Simulator(1);
  const result = simulator.operate('  ', { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' });
  assert.deepEqual(result, { ok: false, error: 'NO_OPERATOR_NAME' });
  assert.equal(simulator.unit.inletValve.mode, 'CASCADE');
  assert.deepEqual(simulator.snapshot().journal, []);
});
