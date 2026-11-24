// Checks the phases' failure monitors share: whether a control module the
// phase uses can still serve it. Each returns why not, or null.

import type { DiscreteDevice } from '../../physical-model/control-modules/discrete-device.ts';
import type { PidLoop } from '../../physical-model/control-modules/pid-loop.ts';
import type { MeasuredValue } from '../../physical-model/status.ts';

/** A device the phase drives must be working, in cascade (so the phase is the one driving it) and not interlocked. */
export function deviceProblem(device: DiscreteDevice): string | null {
  const tag = device.configuration.tag;
  if (device.failure !== null) return `${tag} failed`;
  if (device.mode !== 'CASCADE') return `${tag} is not in cascade`;
  if (device.interlocked) return `${tag} is interlocked: ${device.snapshot.interlocks.join(', ')}`;
  return null;
}

/** A measurement the phase decides on must be GOOD. */
export function measurementProblem(tag: string, value: MeasuredValue): string | null {
  return value.status === 'GOOD' ? null : `${tag} is ${value.status}`;
}

/** A loop the phase drives must be controlling in cascade, not interlocked, and within its deviation limit. */
export function loopProblem(loop: PidLoop): string | null {
  const tag = loop.configuration.tag;
  if (loop.targetMode !== 'CASCADE') return `${tag} is not in cascade`;
  if (loop.actualMode !== 'CASCADE') return `${tag} has shed to ${loop.actualMode}: ${loop.configuration.transmitterTag} is ${loop.processValue.status}`;
  if (loop.interlocked) return `${tag} is interlocked: ${loop.snapshot.interlocks.join(', ')}`;
  if (loop.highDeviation) return `${tag} high deviation: ${loop.processValue.value.toFixed(1)} ${loop.configuration.unit} against a setpoint of ${loop.setpoint}`;
  return null;
}

export function firstProblem(...problems: readonly (string | null)[]): string | null {
  return problems.find((problem) => problem !== null) ?? null;
}
