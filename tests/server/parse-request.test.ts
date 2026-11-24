import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OperatorCommand } from '../../src/engine/simulator.ts';
import { parseFaultRequest, parseOperateRequest } from '../../src/server/parse-request.ts';

const everyKind: readonly OperatorCommand[] = [
  { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' },
  { kind: 'command-device', module: 'P-201', active: true },
  { kind: 'reset-device-failure', module: 'AG-201' },
  { kind: 'set-agitator-speed', rpm: 150 },
  { kind: 'set-level-mode', mode: 'OUT_OF_SERVICE' },
  { kind: 'set-loop-mode', mode: 'CASCADE' },
  { kind: 'set-loop-setpoint', value: 37 },
  { kind: 'set-loop-output', percent: 40 },
  { kind: 'acknowledge-alarm', alarm: 'XV-201 failed to open' },
  { kind: 'phase-command', phase: 'HEAT', command: 'START', parameters: { setpointCelsius: 37, soakMinutes: 5 } },
  { kind: 'phase-command', phase: 'HEAT', command: 'HOLD' },
  { kind: 'set-phase-owner', phase: 'TRANSFER', owner: 'external' },
  { kind: 'create-batch', formula: { waterVolume: 500 } },
  { kind: 'batch-command', command: 'ABORT' },
  { kind: 'change-formula-value', parameter: 'temperature', value: 32 },
];

function overTheWire(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body));
}

test('every kind of operator command comes through the wire as itself', () => {
  for (const command of everyKind) {
    const body = overTheWire({ operatorName: 'A', command, reason: 'Because' });
    assert.deepEqual(parseOperateRequest(body), { operatorName: 'A', command, reason: 'Because' }, command.kind);
  }
});

test('a body that is not a well-formed command is rejected', () => {
  const malformed: readonly unknown[] = [
    null,
    'set-device-mode',
    { command: { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' } },
    { operatorName: 'A', command: { kind: 'open-everything' } },
    { operatorName: 'A', command: { kind: 'set-device-mode', module: 'XV-999', mode: 'MANUAL' } },
    { operatorName: 'A', command: { kind: 'set-device-mode', module: 'XV-201', mode: 'AUTOMATIC' } },
    { operatorName: 'A', command: { kind: 'command-device', module: 'XV-201', active: 'yes' } },
    { operatorName: 'A', command: { kind: 'set-loop-setpoint', value: '37' } },
    { operatorName: 'A', command: { kind: 'create-batch', formula: { waterVolume: 'lots' } } },
    { operatorName: 'A', command: { kind: 'batch-command', command: 'DESTROY' } },
    { operatorName: 'A', command: { kind: 'set-loop-mode', mode: 'MANUAL' }, reason: 7 },
  ];
  for (const body of malformed) assert.equal(parseOperateRequest(body), null, JSON.stringify(body));
});

test('a number left empty arrives as null and becomes NaN, for the engine to refuse like any value out of limits', () => {
  const parsed = parseOperateRequest(overTheWire({ operatorName: 'A', command: { kind: 'set-loop-setpoint', value: Number.NaN } }));
  assert.ok(parsed !== null && parsed.command.kind === 'set-loop-setpoint' && Number.isNaN(parsed.command.value));
});

test('a fault request names a fault the plant has and says whether it is active', () => {
  assert.deepEqual(parseFaultRequest({ fault: 'pump-fails-to-start', active: true }), { fault: 'pump-fails-to-start', active: true });
  assert.equal(parseFaultRequest({ fault: 'meteor-strike', active: true }), null);
  assert.equal(parseFaultRequest({ fault: 'pump-fails-to-start', active: 1 }), null);
});
