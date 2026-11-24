import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator } from '../../src/engine/simulator.ts';
import { millisecondsPerMinute } from '../../src/engine/time.ts';
import { chargeByHand, commandPhase, operate, runFor, runUntil, runUntilPhase } from '../support/simulation.ts';

const minute = millisecondsPerMinute;

test('CHARGE_WATER charges the target volume and closes the inlet', () => {
  const simulator = new Simulator(1);
  commandPhase(simulator, 'CHARGE_WATER', 'START', { targetVolumeLiters: 400 });
  runUntilPhase(simulator, 'CHARGE_WATER', 'COMPLETE', 10 * minute);
  const volume = simulator.snapshot().plant.volumeLiters;
  // The valve takes a few seconds to close, so a little more comes in.
  assert.ok(volume >= 400 && volume < 410, `${volume} L`);
  assert.ok(simulator.unit.inletValve.confirmedPassive);
});

test('AGITATE runs the agitator at its speed for its mixing time, then stops it', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 300);
  commandPhase(simulator, 'AGITATE', 'START', { speedRpm: 150, durationMinutes: 2 });
  let runningMilliseconds = 0;
  runUntil(
    simulator,
    () => {
      if (simulator.snapshot().plant.agitatorSpeedRpm === 150) runningMilliseconds += 100;
      return simulator.phase('AGITATE').state === 'COMPLETE';
    },
    5 * minute,
    'AGITATE completing',
  );
  assert.ok(Math.abs(runningMilliseconds - 2 * minute) < 2000, `ran ${runningMilliseconds} ms`);
  assert.ok(simulator.unit.agitator.confirmedPassive);
});

test('HEAT brings the contents to the setpoint, soaks, and hands TIC-201 back in manual with TV-201 closed', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 500);
  commandPhase(simulator, 'HEAT', 'START', { setpointCelsius: 37, soakMinutes: 5 });
  runUntil(simulator, () => simulator.phase('HEAT').snapshot.step === 'SOAK', 30 * minute, 'HEAT reaching its soak');
  const soakStart = simulator.timeMilliseconds;
  runUntilPhase(simulator, 'HEAT', 'COMPLETE', 10 * minute);
  assert.ok(Math.abs(simulator.timeMilliseconds - soakStart - 5 * minute) <= 200);
  assert.ok(Math.abs(simulator.unit.temperature.processValue.value - 37) < 2);
  assert.equal(simulator.unit.temperature.targetMode, 'MANUAL');
  simulator.step();
  assert.equal(simulator.snapshot().outputs['TV-201'].milliamps, 4);
});

test('TRANSFER empties the tank, opening the valve before the pump and stopping the pump before the valve', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 300);
  const before = simulator.snapshot().journal.length;
  commandPhase(simulator, 'TRANSFER', 'START', {});
  runUntilPhase(simulator, 'TRANSFER', 'COMPLETE', 10 * minute);
  assert.ok(simulator.unit.level.processValue.value < 2);
  const deviceOrder = simulator
    .snapshot()
    .journal.slice(before)
    .flatMap((entry) => (entry.event.kind === 'device-commanded' ? [`${entry.event.module} ${entry.event.to}`] : []));
  assert.deepEqual(deviceOrder, ['XV-202 OPEN', 'P-201 RUNNING', 'P-201 STOPPED', 'XV-202 CLOSED']);
});

test("PAUSE stops AGITATE's clock with the agitator still running, and RESUME finishes the time that was left", () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 300);
  commandPhase(simulator, 'AGITATE', 'START', { speedRpm: 150, durationMinutes: 2 });
  runFor(simulator, minute);
  commandPhase(simulator, 'AGITATE', 'PAUSE');
  runUntilPhase(simulator, 'AGITATE', 'PAUSED', 1000);
  runFor(simulator, 3 * minute);
  assert.equal(simulator.phase('AGITATE').state, 'PAUSED');
  assert.equal(simulator.snapshot().plant.agitatorSpeedRpm, 150);
  commandPhase(simulator, 'AGITATE', 'RESUME');
  const resumed = simulator.timeMilliseconds;
  runUntilPhase(simulator, 'AGITATE', 'COMPLETE', 3 * minute);
  const left = simulator.timeMilliseconds - resumed;
  assert.ok(left > 0.9 * minute && left < 1.1 * minute, `finished ${left} ms after resuming`);
});

test('HOLD brings CHARGE_WATER to a safe stop, and RESTART carries on to the target', () => {
  const simulator = new Simulator(1);
  commandPhase(simulator, 'CHARGE_WATER', 'START', { targetVolumeLiters: 400 });
  runFor(simulator, minute);
  commandPhase(simulator, 'CHARGE_WATER', 'HOLD');
  runUntilPhase(simulator, 'CHARGE_WATER', 'HELD', 10_000);
  assert.ok(simulator.unit.inletValve.confirmedPassive);
  const heldVolume = simulator.snapshot().plant.volumeLiters;
  runFor(simulator, minute);
  assert.equal(simulator.snapshot().plant.volumeLiters, heldVolume);
  commandPhase(simulator, 'CHARGE_WATER', 'RESTART');
  runUntilPhase(simulator, 'CHARGE_WATER', 'COMPLETE', 10 * minute);
  assert.ok(simulator.snapshot().plant.volumeLiters >= 400);
});

test('STOP ends TRANSFER in order and ABORT ends it at once; both leave the pump stopped and the valve shut', () => {
  for (const command of ['STOP', 'ABORT'] as const) {
    const simulator = new Simulator(1);
    chargeByHand(simulator, 500);
    commandPhase(simulator, 'TRANSFER', 'START', {});
    runUntil(simulator, () => simulator.unit.transfer.state === 'RUNNING', 20_000, 'the transfer running');
    commandPhase(simulator, 'TRANSFER', command);
    runUntilPhase(simulator, 'TRANSFER', command === 'STOP' ? 'STOPPED' : 'ABORTED', 20_000);
    assert.ok(simulator.unit.transferPump.confirmedPassive);
    assert.ok(simulator.unit.outletValve.confirmedPassive);
    assert.ok(simulator.unit.level.processValue.value > 100, 'the tank was not emptied');
  }
});

test('a phase refuses a command its state does not accept, and parameters that are missing or out of limits', () => {
  const simulator = new Simulator(1);
  const command = (command: 'RESTART' | 'START', parameters?: Record<string, number>) =>
    simulator.operate('Test operator', parameters === undefined
      ? { kind: 'phase-command', phase: 'CHARGE_WATER', command }
      : { kind: 'phase-command', phase: 'CHARGE_WATER', command, parameters });
  assert.deepEqual(command('RESTART'), { ok: false, error: 'NOT_ACCEPTED_IN_STATE' });
  assert.deepEqual(command('START'), { ok: false, error: 'BAD_PARAMETERS' });
  assert.deepEqual(command('START', { targetVolumeLiters: 2000 }), { ok: false, error: 'BAD_PARAMETERS' });
  assert.deepEqual(command('START', { targetVolumeLiters: 400, extra: 1 }), { ok: false, error: 'BAD_PARAMETERS' });
  assert.equal(simulator.phase('CHARGE_WATER').state, 'IDLE');
});

test('the failure monitor holds a phase when the operator takes one of its devices into manual', () => {
  const simulator = new Simulator(1);
  chargeByHand(simulator, 300);
  commandPhase(simulator, 'AGITATE', 'START', { speedRpm: 150, durationMinutes: 5 });
  runFor(simulator, minute);
  operate(simulator, { kind: 'set-device-mode', module: 'AG-201', mode: 'MANUAL' });
  simulator.step();
  assert.equal(simulator.phase('AGITATE').state, 'HOLDING');
  assert.equal(simulator.phase('AGITATE').snapshot.failure, 'AG-201 is not in cascade');
});

test('a phase journals its parameters and every state change with its cause', () => {
  const simulator = new Simulator(1);
  commandPhase(simulator, 'CHARGE_WATER', 'START', { targetVolumeLiters: 200 });
  runUntilPhase(simulator, 'CHARGE_WATER', 'COMPLETE', 10 * minute);
  commandPhase(simulator, 'CHARGE_WATER', 'RESET');
  const phaseEvents = simulator
    .snapshot()
    .journal.map((entry) => entry.event)
    .filter((event) => event.kind === 'phase-parameters' || event.kind === 'phase-state-changed');
  assert.deepEqual(
    phaseEvents.map((event) =>
      event.kind === 'phase-parameters' ? event.parameters : [event.from, event.to, event.cause.kind],
    ),
    [{ targetVolumeLiters: 200 }, ['IDLE', 'RUNNING', 'command'], ['RUNNING', 'COMPLETE', 'logic-done'], ['COMPLETE', 'IDLE', 'command']],
  );
});
