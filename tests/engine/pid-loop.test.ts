import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operator } from '../../src/engine/actor.ts';
import { toMilliamps } from '../../src/engine/io.ts';
import { PidLoop } from '../../src/engine/physical-model/control-modules/pid-loop.ts';

const range = { lower: 0, upper: 150 };

function loop(): PidLoop {
  return new PidLoop(
    {
      tag: 'TIC-1',
      description: 'Test loop',
      transmitterTag: 'TT-1',
      valveTag: 'TV-1',
      range,
      unit: '°C',
      gainPercentPerUnit: 100,
      integralTimeSeconds: 600,
      setpointLimits: { lower: 0, upper: 90 },
      highDeviationLimit: 2.5,
    },
    { record: () => {} },
  );
}

test('switching from manual to automatic leaves the output where it was: a bumpless transfer', () => {
  const pid = loop();
  const person = operator('A');
  const signal = { milliamps: toMilliamps(30, range) };
  pid.readSignal(signal);
  assert.deepEqual(pid.setOutput(40, person), { ok: true });
  pid.writeOutput();
  assert.deepEqual(pid.setMode('AUTOMATIC', person), { ok: true });
  pid.readSignal(signal);
  pid.writeOutput();
  assert.equal(pid.snapshot.outputPercent, 40);
});

test('while the output is pinned at its limit, the integral term does not wind up', () => {
  const pid = loop();
  const person = operator('A');
  pid.readSignal({ milliamps: toMilliamps(20, range) });
  pid.writeOutput();
  pid.setMode('AUTOMATIC', person);
  pid.setSetpoint(37, person);
  // An hour far below the setpoint, with the output pinned at 100 %.
  for (let scan = 0; scan < 36_000; scan++) {
    pid.readSignal({ milliamps: toMilliamps(20, range) });
    pid.writeOutput();
  }
  // At the setpoint the error is zero, so the output is the integral term alone.
  pid.readSignal({ milliamps: toMilliamps(37, range) });
  pid.writeOutput();
  assert.ok(pid.snapshot.outputPercent < 1, `output ${pid.snapshot.outputPercent} %`);
});
