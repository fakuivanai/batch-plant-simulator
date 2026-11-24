import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proceduralCommands, proceduralStates } from '../../src/engine/procedural-model/state-machine.ts';
import { commandNumbers, commandOfNumber, noCommand, stateNumbers } from '../../src/server/phase-interface.ts';

test('every command and every state has its own number, and every command number reads back as its command', () => {
  const commandValues = proceduralCommands.map((command) => commandNumbers[command]);
  assert.equal(new Set([...commandValues, noCommand]).size, commandValues.length + 1);
  assert.equal(new Set(proceduralStates.map((state) => stateNumbers[state])).size, proceduralStates.length);
  for (const command of proceduralCommands) assert.equal(commandOfNumber(commandNumbers[command]), command);
  assert.equal(commandOfNumber(noCommand), null);
  assert.equal(commandOfNumber(99), undefined);
});
