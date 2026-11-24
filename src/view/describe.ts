// Plain-language descriptions of journal entries, for the journal and the
// batch record.

import type { Actor } from '../engine/actor.ts';
import type { BatchTransitionCause } from '../engine/procedural-model/batch.ts';
import type { PhaseOwner, PhaseTransitionCause } from '../engine/procedural-model/phase.ts';
import type { JournalEvent } from '../engine/record/journal.ts';
import { formatNumber } from './format.ts';

export function describeActor(actor: Actor): string {
  switch (actor.kind) {
    case 'operator':
      return actor.name;
    case 'program':
      return `${actor.name} (program)`;
    case 'external':
      return `${actor.name} (outside system)`;
  }
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
    case 'phase-owner-changed':
      return `${event.phase} owner ${describeOwner(event.from)} → ${describeOwner(event.to)}`;
    case 'phase-parameters':
      return `${event.phase} parameters: ${describeParameters(event.parameters)}`;
    case 'batch-created':
      return `Batch ${event.batchId} created from recipe ${event.recipe} version ${event.version} (${event.product})`;
    case 'formula-value-set':
      return event.from === event.to
        ? `${event.batchId} formula ${event.parameter} = ${formatNumber(event.to, 1)} ${event.unit}`
        : `${event.batchId} formula ${event.parameter}: ${formatNumber(event.from, 1)} → ${formatNumber(event.to, 1)} ${event.unit}`;
    case 'batch-state-changed':
      return `Batch ${event.batchId} ${event.from} → ${event.to}${describeBatchCause(event.cause)}`;
    case 'procedure-step-started':
      return `${event.batchId} operation ${event.operation}: starting ${event.phase}`;
  }
}

/** Who made the change, or null for what the system did on its own, such as raising an alarm. */
export function eventActor(event: JournalEvent): Actor | null {
  if ('by' in event) return event.by;
  if ('cause' in event && event.cause.kind === 'command') return event.cause.by;
  return null;
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

function describeBatchCause(cause: BatchTransitionCause): string {
  switch (cause.kind) {
    case 'command':
      return ` on ${cause.command}`;
    case 'logic-done':
      return '';
    case 'paused-between-phases':
      return ' between phases';
    case 'phase-held':
      return `: ${cause.phase} held${cause.reason === null ? '' : ` (${cause.reason})`}`;
  }
}

export function describeOwner(owner: PhaseOwner): string {
  switch (owner.kind) {
    case 'operator':
      return 'operator';
    case 'batch':
      return `batch ${owner.batchId}`;
    case 'external':
      return 'outside batch engine';
  }
}
