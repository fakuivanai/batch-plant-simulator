// Plain-language descriptions of journal entries, for the journal and the
// batch record.

import type { Actor } from '../engine/actor.ts';
import type { PhaseTransitionCause } from '../engine/procedural-model/phase.ts';
import type { JournalEvent } from '../engine/record/journal.ts';
import { formatNumber } from './format.ts';

export function describeActor(actor: Actor): string {
  return actor.kind === 'operator' ? actor.name : `${actor.name} (program)`;
}

/** What happened, without who did it. */
export function describeEvent(event: JournalEvent): string {
  switch (event.kind) {
    case 'mode-changed':
      return `${event.module} mode ${event.from} → ${event.to}`;
    case 'device-commanded':
      return `${event.module} commanded ${event.from} → ${event.to}`;
    case 'setpoint-changed':
      return `${event.module} setpoint ${formatNumber(event.from, 1)} → ${formatNumber(event.to, 1)} ${event.unit}`;
    case 'output-changed':
      return `${event.module} output ${formatNumber(event.from, 1)} → ${formatNumber(event.to, 1)} %`;
    case 'failure-reset':
      return `${event.module} failure reset (${event.failure})`;
    case 'alarm-raised':
      return `Alarm ${event.priority}: ${event.alarm}`;
    case 'alarm-cleared':
      return `Alarm cleared: ${event.alarm}`;
    case 'alarm-acknowledged':
      return `Alarm acknowledged: ${event.alarm}`;
    case 'phase-state-changed':
      return `${event.phase} ${event.from} → ${event.to}${describeCause(event.cause)}`;
    case 'phase-parameters':
      return `${event.phase} parameters: ${describeParameters(event.parameters)}`;
  }
}

/** Who made the change, or nothing for what the system recorded on its own, such as an alarm. */
export function eventActor(event: JournalEvent): Actor | null {
  return 'by' in event ? event.by : null;
}

function describeCause(cause: PhaseTransitionCause): string {
  switch (cause.kind) {
    case 'command':
      return ` on ${cause.command}`;
    case 'logic-done':
      return '';
    case 'paused-at-pause-point':
      return ' at a pause point';
    case 'failure':
      return `: ${cause.reason}`;
  }
}

function describeParameters(parameters: Readonly<Record<string, number>>): string {
  const entries = Object.entries(parameters);
  return entries.length === 0 ? 'none' : entries.map(([name, value]) => `${name} = ${formatNumber(value, 1)}`).join(', ');
}
