// What the page and the server say to each other when the page shows a
// simulation running on the server. Plain HTTP on the same machine:
//
//   GET  /api/events     a stream of server-sent events, one per update
//   POST /api/operate    an operator command, answered with its result
//   POST /api/faults     inject or repair a fault
//
// Each update carries the snapshot without the journal, plus the journal
// entries the page hasn't had yet, since the journal only ever grows.

import type { JournalEntry } from '../engine/record/journal.ts';
import type { FaultKind } from '../engine/process/faults.ts';
import type { OperatorCommand, OperatorRefusal, SimulatorSnapshot } from '../engine/simulator.ts';
import type { Result } from '../engine/result.ts';

/** Bumped whenever the messages change, so a page and a server from different builds notice. */
export const protocolVersion = 1;

export const paths = {
  events: '/api/events',
  operate: '/api/operate',
  faults: '/api/faults',
} as const;

export interface Update {
  readonly protocol: typeof protocolVersion;
  readonly speed: number;
  readonly snapshot: Omit<SimulatorSnapshot, 'journal'>;
  /** Journal entries from index `from` on. `from` is 0 on the first update of a connection. */
  readonly journal: { readonly from: number; readonly entries: readonly JournalEntry[] };
}

export interface OperateRequest {
  readonly operatorName: string;
  readonly command: OperatorCommand;
  readonly reason?: string;
}

export type OperateResponse = Result<OperatorRefusal>;

export interface FaultRequest {
  readonly fault: FaultKind;
  readonly active: boolean;
}

/**
 * Reads an update from the server. The page and the server are served
 * together from one build and share these types, so the version is the one
 * thing worth checking: a mismatch means a stale page or server.
 */
export function parseUpdate(text: string): Update {
  const message: unknown = JSON.parse(text);
  if (!isUpdate(message)) throw new Error('The server speaks a different version of the protocol. Reload the page.');
  return message;
}

function isUpdate(message: unknown): message is Update {
  return typeof message === 'object' && message !== null && 'protocol' in message && message.protocol === protocolVersion;
}
