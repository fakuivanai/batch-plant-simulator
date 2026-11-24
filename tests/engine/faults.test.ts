// What the control layer does about each fault that can be injected. Each test
// injects one fault and pins the reaction of the control modules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator } from '../../src/engine/simulator.ts';
import { chargeByHand, commandPhase, operate, runFor, runUntil, runUntilPhase } from '../support/simulation.ts';

function alarmIds(simulator: Simulator): string[] {
  return simulator.snapshot().alarms.map((alarm) => alarm.id);
}

test('XV-201 fails to open: the device fails after its feedback timeout, alarms, and drops its output', () => {
  const simulator = new Simulator(1);
  const valve = simulator.unit.inletValve;
  simulator.injectFault('inlet-valve-fails-to-open');
  operate(simulator, { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' });
  operate(simulator, { kind: 'command-device', module: 'XV-201', active: true });
  runFor(simulator, valve.configuration.feedbackTimeoutMilliseconds);
  assert.equal(valve.failure, null, 'not failed before the timeout');
  runFor(simulator, 200);
  assert.equal(valve.failure, 'FAILED_TO_ACTIVATE');
  assert.equal(valve.output, false);
  assert.ok(alarmIds(simulator).includes('XV-201 failed to open'));
  assert.deepEqual(
    simulator.operate('Test operator', { kind: 'command-device', module: 'XV-201', active: true }),
    { ok: false, error: 'DEVICE_FAILED' },
  );
});

test('P-201 fails to start: the device fails after its feedback timeout, alarms, and drops its output', () => {
  const simulator = new Simulator(1);
  const pump = simulator.unit.transferPump;
  chargeByHand(simulator, 200);
  simulator.injectFault('pump-fails-to-start');
  operate(simulator, { kind: 'set-device-mode', module: 'XV-202', mode: 'MANUAL' });
  operate(simulator, { kind: 'command-device', module: 'XV-202', active: true });
  runUntil(simulator, () => simulator.unit.outletValve.confirmedActive, 10_000, 'XV-202 opening');
  operate(simulator, { kind: 'set-device-mode', module: 'P-201', mode: 'MANUAL' });
  operate(simulator, { kind: 'command-device', module: 'P-201', active: true });
  runUntil(simulator, () => pump.failure !== null, pump.configuration.feedbackTimeoutMilliseconds + 1000, 'P-201 failing');
  assert.equal(pump.failure, 'FAILED_TO_ACTIVATE');
  assert.equal(pump.output, false);
  assert.ok(alarmIds(simulator).includes('P-201 failed to start'));
});

test('LT-201 stuck: the independent LSHH-201 trips and its interlock closes XV-201 before the tank overflows', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 300);
  simulator.injectFault('level-transmitter-stuck');
  const stuckReading = simulator.unit.level.processValue.value;
  operate(simulator, { kind: 'command-device', module: 'XV-201', active: true });
  runFor(simulator, 15 * 60_000);
  assert.equal(simulator.unit.level.processValue.status, 'GOOD', 'the stuck transmitter still reads GOOD');
  assert.ok(Math.abs(simulator.unit.level.processValue.value - stuckReading) < 1e-9);
  assert.equal(simulator.unit.inletValve.output, false);
  assert.equal(simulator.snapshot().plant.spilledLiters, 0);
  assert.ok(alarmIds(simulator).includes('LSHH-201 high-high level'));
});

test('heater overshoot: the temperature passes the high deviation limit and TIC-201 raises its high deviation alarm', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 500);
  simulator.injectFault('heating-medium-overheated');
  operate(simulator, { kind: 'set-loop-mode', mode: 'AUTOMATIC' });
  operate(simulator, { kind: 'set-loop-setpoint', value: 37 });
  runUntil(simulator, () => alarmIds(simulator).includes('TIC-201 high deviation'), 30 * 60_000, 'the high deviation alarm');
});

test('TT-201 failed: TIC-201 sheds to manual with TV-201 closed, alarms, and returns to automatic once the signal is good', () => {
  const simulator = new Simulator(1);
  const loop = simulator.unit.temperature;
  chargeByHand(simulator, 500);
  operate(simulator, { kind: 'set-loop-mode', mode: 'AUTOMATIC' });
  operate(simulator, { kind: 'set-loop-setpoint', value: 37 });
  runFor(simulator, 2 * 60_000);
  assert.ok(simulator.snapshot().outputs['TV-201'].milliamps > 4, 'the loop is heating');
  simulator.injectFault('temperature-transmitter-failed');
  runFor(simulator, 200);
  assert.equal(loop.processValue.status, 'BAD');
  assert.equal(loop.targetMode, 'AUTOMATIC');
  assert.equal(loop.actualMode, 'MANUAL');
  assert.equal(simulator.snapshot().outputs['TV-201'].milliamps, 4);
  assert.ok(alarmIds(simulator).includes('TT-201 signal failure'));
  simulator.clearFault('temperature-transmitter-failed');
  runFor(simulator, 200);
  assert.equal(loop.actualMode, 'AUTOMATIC');
});

// What the phases do about the same faults: the failure monitor holds the
// phase, and its holding logic leaves the equipment safe.

test('XV-201 fails to open: CHARGE_WATER holds with the inlet closed, and completes after a repair, a reset and a restart', () => {
  const simulator = new Simulator(1);
  simulator.injectFault('inlet-valve-fails-to-open');
  commandPhase(simulator, 'CHARGE_WATER', 'START', { targetVolumeLiters: 300 });
  runUntilPhase(simulator, 'CHARGE_WATER', 'HELD', 30_000);
  assert.equal(simulator.phase('CHARGE_WATER').snapshot.failure, 'XV-201 failed');
  assert.equal(simulator.unit.inletValve.output, false);
  simulator.clearFault('inlet-valve-fails-to-open');
  operate(simulator, { kind: 'reset-device-failure', module: 'XV-201' });
  commandPhase(simulator, 'CHARGE_WATER', 'RESTART');
  runUntilPhase(simulator, 'CHARGE_WATER', 'COMPLETE', 10 * 60_000);
});

test('P-201 fails to start: TRANSFER holds with the pump off and XV-202 closed', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 300);
  simulator.injectFault('pump-fails-to-start');
  commandPhase(simulator, 'TRANSFER', 'START', {});
  runUntilPhase(simulator, 'TRANSFER', 'HELD', 60_000);
  assert.equal(simulator.phase('TRANSFER').snapshot.failure, 'the transfer module failed: P-201 failed');
  assert.ok(simulator.unit.transferPump.confirmedPassive);
  assert.ok(simulator.unit.outletValve.confirmedPassive);
});

test('LT-201 stuck: CHARGE_WATER holds before the tank overflows, with the inlet closed', () => {
  const simulator = new Simulator(1);
  commandPhase(simulator, 'CHARGE_WATER', 'START', { targetVolumeLiters: 600 });
  runUntil(simulator, () => simulator.unit.level.processValue.value >= 300, 10 * 60_000, 'charging to 300 L');
  simulator.injectFault('level-transmitter-stuck');
  runUntilPhase(simulator, 'CHARGE_WATER', 'HELD', 15 * 60_000);
  assert.ok(simulator.unit.inletValve.confirmedPassive);
  runFor(simulator, 10 * 60_000);
  assert.equal(simulator.snapshot().plant.spilledLiters, 0);
});

test('heater overshoot: HEAT holds on the high deviation and hands TIC-201 back with TV-201 closed', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 500);
  simulator.injectFault('heating-medium-overheated');
  commandPhase(simulator, 'HEAT', 'START', { setpointCelsius: 37, soakMinutes: 10 });
  runUntilPhase(simulator, 'HEAT', 'HELD', 30 * 60_000);
  assert.match(simulator.phase('HEAT').snapshot.failure ?? '', /^TIC-201 high deviation/);
  assert.equal(simulator.unit.temperature.targetMode, 'MANUAL');
  simulator.step();
  assert.equal(simulator.snapshot().outputs['TV-201'].milliamps, 4);
});

test('TT-201 failed: HEAT holds, and restarting while the signal is still BAD holds it again', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 500);
  commandPhase(simulator, 'HEAT', 'START', { setpointCelsius: 37, soakMinutes: 10 });
  runFor(simulator, 2 * 60_000);
  simulator.injectFault('temperature-transmitter-failed');
  runUntilPhase(simulator, 'HEAT', 'HELD', 10_000);
  assert.equal(simulator.phase('HEAT').snapshot.failure, 'TIC-201 has shed to MANUAL: TT-201 is BAD');
  commandPhase(simulator, 'HEAT', 'RESTART');
  runUntilPhase(simulator, 'HEAT', 'HELD', 10_000);
});
