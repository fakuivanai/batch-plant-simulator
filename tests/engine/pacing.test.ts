import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pacer } from '../../src/engine/pacing.ts';
import { stepMilliseconds } from '../../src/engine/time.ts';

test('a pacer turns wall time at a speed into whole steps, carrying the remainder to the next call', () => {
  const pacer = new Pacer(1000);
  assert.equal(pacer.steps(1.5 * stepMilliseconds, 1), 1);
  assert.equal(pacer.steps(0.5 * stepMilliseconds, 1), 1);
  assert.equal(pacer.steps(stepMilliseconds, 10), 10);
});

test('a pacer that falls behind runs at most its maximum and forgets the rest', () => {
  const pacer = new Pacer(5);
  assert.equal(pacer.steps(100 * stepMilliseconds, 1), 5);
  assert.equal(pacer.steps(0, 1), 0);
});
