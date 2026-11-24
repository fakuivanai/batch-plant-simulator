// The journal is the audit trail: every change to the control system, with
// who made it, what changed from what to what, when (in simulated time) and,
// for an operator's change, why. A batch's record is the part of the journal
// written while that batch was active. Entries are only ever appended.

import type { Actor } from '../actor.ts';
import type { Mode } from '../physical-model/mode.ts';
import type { PhaseName, PhaseTransitionCause } from '../procedural-model/phase.ts';
import type { ProceduralState } from '../procedural-model/state-machine.ts';

export type AlarmPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type JournalEvent =
  | { readonly kind: 'mode-changed'; readonly module: string; readonly from: Mode; readonly to: Mode; readonly by: Actor }
  | { readonly kind: 'device-commanded'; readonly module: string; readonly from: string; readonly to: string; readonly by: Actor }
  | {
      readonly kind: 'setpoint-changed';
      readonly module: string;
      readonly from: number;
      readonly to: number;
      readonly unit: string;
      readonly by: Actor;
    }
  | { readonly kind: 'output-changed'; readonly module: string; readonly from: number; readonly to: number; readonly by: Actor }
  | { readonly kind: 'failure-reset'; readonly module: string; readonly failure: string; readonly by: Actor }
  | { readonly kind: 'alarm-raised'; readonly alarm: string; readonly priority: AlarmPriority }
  | { readonly kind: 'alarm-cleared'; readonly alarm: string }
  | { readonly kind: 'alarm-acknowledged'; readonly alarm: string; readonly by: Actor }
  | {
      readonly kind: 'phase-state-changed';
      readonly phase: PhaseName;
      readonly from: ProceduralState;
      readonly to: ProceduralState;
      readonly cause: PhaseTransitionCause;
    }
  | { readonly kind: 'phase-parameters'; readonly phase: PhaseName; readonly parameters: Readonly<Record<string, number>>; readonly by: Actor };

export interface JournalEntry {
  readonly atMilliseconds: number;
  /** The batch that was active when the entry was written, if any. */
  readonly batchId: string | null;
  readonly event: JournalEvent;
  /** The operator's reason for a change, when one was given. */
  readonly reason: string | null;
}

/** What control modules and logic write their changes to. They don't know where the entries go. */
export interface Recorder {
  record(event: JournalEvent, reason?: string): void;
}

export class Journal implements Recorder {
  readonly #entries: JournalEntry[] = [];
  readonly #clock: () => number;
  readonly #activeBatch: () => string | null;

  constructor(clock: () => number, activeBatch: () => string | null) {
    this.#clock = clock;
    this.#activeBatch = activeBatch;
  }

  record(event: JournalEvent, reason?: string): void {
    this.#entries.push({ atMilliseconds: this.#clock(), batchId: this.#activeBatch(), event, reason: reason ?? null });
  }

  get entries(): readonly JournalEntry[] {
    return this.#entries;
  }
}
