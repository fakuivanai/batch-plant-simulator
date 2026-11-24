// A control module's mode says who may drive it. The modes come from
// function-block practice (IEC 61804 and the fieldbus function blocks), which
// control systems use for their modules; ISA-88 itself only gives equipment an
// automatic and a manual mode.

import type { Actor } from '../actor.ts';

export type Mode =
  /** Taken out of operation, for maintenance. Outputs go to their safe state and measurements read BAD. */
  | 'OUT_OF_SERVICE'
  /** The operator drives the output directly. */
  | 'MANUAL'
  /** The module computes its output from a setpoint that the operator sets. */
  | 'AUTOMATIC'
  /** Like automatic, but the setpoint comes from the control program: a phase or an equipment module. */
  | 'CASCADE';

/** Whether the actor may write a setpoint or command in this mode. */
export function mayCommand(mode: Mode, actor: Actor): boolean {
  switch (mode) {
    case 'OUT_OF_SERVICE':
      return false;
    case 'MANUAL':
    case 'AUTOMATIC':
      return actor.kind === 'operator';
    case 'CASCADE':
      return actor.kind === 'program';
  }
}

/**
 * A program may take a module into cascade, but only from manual or automatic:
 * it can't put a module in service that a person took out of service, nor take
 * one out.
 */
export function mayChangeMode(from: Mode, to: Mode, actor: Actor): boolean {
  if (actor.kind === 'operator') return true;
  return to === 'CASCADE' && from !== 'OUT_OF_SERVICE';
}
