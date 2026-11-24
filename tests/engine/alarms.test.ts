import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operator } from '../../src/engine/actor.ts';
import { AlarmList, type AlarmCondition } from '../../src/engine/record/alarms.ts';
import type { JournalEvent } from '../../src/engine/record/journal.ts';

const failure: AlarmCondition = { module: 'XV-201', condition: 'failed to open', priority: 'MEDIUM' };

function list(): { alarms: AlarmList; events: JournalEvent[] } {
  const events: JournalEvent[] = [];
  return { alarms: new AlarmList({ record: (event) => events.push(event) }), events };
}

test('an alarm stays on the list until it has both cleared and been acknowledged, in either order', () => {
  const clearedFirst = list();
  clearedFirst.alarms.update([failure], 0);
  clearedFirst.alarms.update([], 100);
  assert.equal(clearedFirst.alarms.alarms.length, 1, 'cleared but not acknowledged');
  clearedFirst.alarms.acknowledge('XV-201 failed to open', operator('A'));
  assert.equal(clearedFirst.alarms.alarms.length, 0);

  const acknowledgedFirst = list();
  acknowledgedFirst.alarms.update([failure], 0);
  acknowledgedFirst.alarms.acknowledge('XV-201 failed to open', operator('A'));
  assert.equal(acknowledgedFirst.alarms.alarms.length, 1, 'acknowledged but still active');
  acknowledgedFirst.alarms.update([], 100);
  assert.equal(acknowledgedFirst.alarms.alarms.length, 0);
});

test('an alarm that returns before it was acknowledged is raised again', () => {
  const { alarms, events } = list();
  alarms.update([failure], 0);
  alarms.update([], 100);
  alarms.update([failure], 200);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['alarm-raised', 'alarm-cleared', 'alarm-raised'],
  );
  assert.equal(alarms.alarms[0]?.raisedAtMilliseconds, 200);
});
