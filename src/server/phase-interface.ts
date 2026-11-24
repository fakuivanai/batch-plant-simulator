// The phase interface an outside batch engine uses over OPC UA. A batch
// engine drives the equipment's phases through a handful of values per
// phase, the way it would drive phase logic in a PLC:
//
//   Command          the engine writes a command number
//   CommandResult    why the last command was refused, or empty
//   State            the phase reports its state, as a name and a number
//   Parameters/...   the engine writes these before START
//   Watchdog         the engine writes a new value about once a second
//   WatchdogEcho     the phase writes back the last value it saw
//
// The numbers follow the numbering batch engines commonly use for this kind
// of interface. ISA-88 names the states and commands but doesn't number them.

import type { ProceduralCommand, ProceduralState } from '../engine/procedural-model/state-machine.ts';

/** 0 means no command: writing it does nothing. */
export const commandNumbers: Readonly<Record<ProceduralCommand, number>> = {
  START: 1,
  PAUSE: 2,
  RESUME: 3,
  HOLD: 4,
  RESTART: 5,
  STOP: 6,
  RESET: 7,
  ABORT: 8,
};

/**
 * 0 is an unknown state, and 5 (resetting) is left out: in this model a reset
 * takes a phase straight back to IDLE.
 */
export const stateNumbers: Readonly<Record<ProceduralState, number>> = {
  IDLE: 1,
  RUNNING: 2,
  COMPLETE: 3,
  RESTARTING: 4,
  PAUSING: 6,
  PAUSED: 7,
  HOLDING: 8,
  HELD: 9,
  STOPPING: 10,
  STOPPED: 11,
  ABORTING: 12,
  ABORTED: 13,
};

export const noCommand = 0;

/** The command a number stands for, or null for no command, or undefined when the number means nothing. */
export function commandOfNumber(number: number): ProceduralCommand | null | undefined {
  if (number === noCommand) return null;
  const entry = Object.entries(commandNumbers).find(([, value]) => value === number);
  if (entry === undefined) return undefined;
  const [name] = entry;
  return isCommand(name) ? name : undefined;
}

function isCommand(name: string): name is ProceduralCommand {
  return Object.hasOwn(commandNumbers, name);
}
