import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusOfSignal } from '../../src/engine/physical-model/status.ts';

test('a 4 to 20 mA signal is GOOD in the NE 43 measurement band, UNCERTAIN just outside it and BAD at the failure levels', () => {
  const cases: [number, string][] = [
    [0, 'BAD'],
    [3.6, 'BAD'],
    [3.7, 'UNCERTAIN'],
    [3.8, 'GOOD'],
    [12, 'GOOD'],
    [20.5, 'GOOD'],
    [20.8, 'UNCERTAIN'],
    [21, 'BAD'],
    [24, 'BAD'],
  ];
  for (const [milliamps, status] of cases) assert.equal(statusOfSignal(milliamps), status, `${milliamps} mA`);
});
