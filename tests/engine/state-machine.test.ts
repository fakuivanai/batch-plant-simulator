import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  logicDoneTransitions,
  proceduralCommands,
  proceduralStates,
  stateAfterCommand,
} from '../../src/engine/procedural-model/state-machine.ts';

// The ISA-88 state model, written out again here from the standard's figure,
// so that the table in the code is checked against an independent copy.
const expected: Record<string, Record<string, string>> = {
  IDLE: { START: 'RUNNING' },
  RUNNING: { PAUSE: 'PAUSING', HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  PAUSING: { HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  PAUSED: { RESUME: 'RUNNING', HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  HOLDING: { STOP: 'STOPPING', ABORT: 'ABORTING' },
  HELD: { RESTART: 'RESTARTING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  RESTARTING: { HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  STOPPING: { ABORT: 'ABORTING' },
  ABORTING: {},
  COMPLETE: { RESET: 'IDLE' },
  STOPPED: { RESET: 'IDLE' },
  ABORTED: { RESET: 'IDLE' },
};

test('each state accepts exactly the commands of the ISA-88 state model, leading where the model says', () => {
  for (const state of proceduralStates) {
    for (const command of proceduralCommands) {
      assert.equal(stateAfterCommand(state, command), expected[state]?.[command] ?? null, `${command} in ${state}`);
    }
  }
});

test('each state that runs logic goes where the ISA-88 model says once its logic is done', () => {
  assert.deepEqual(logicDoneTransitions, {
    RUNNING: 'COMPLETE',
    HOLDING: 'HELD',
    RESTARTING: 'RUNNING',
    STOPPING: 'STOPPED',
    ABORTING: 'ABORTED',
  });
});
