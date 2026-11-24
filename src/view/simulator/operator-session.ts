// The person at the operator station: their name, which every command carries
// into the journal, and the outcome of their last command.

import { createSignal, type Accessor } from 'solid-js';
import { refusalMessages, type OperatorCommand } from '../../engine/simulator.ts';
import type { Runtime } from './runtime.ts';

const nameStorageKey = 'batch-plant-simulator.operator-name';

/** Browser storage can be missing or refuse access; the name then just isn't remembered. */
function readStoredName(): string {
  try {
    return window.localStorage.getItem(nameStorageKey) ?? 'Operator 1';
  } catch {
    return 'Operator 1';
  }
}

function storeName(name: string): void {
  try {
    window.localStorage.setItem(nameStorageKey, name);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export interface OperatorSession {
  readonly name: Accessor<string>;
  setName(name: string): void;
  /** The last refusal, shown until the next command. */
  readonly refusal: Accessor<string | null>;
  /** Sends a command as this operator. Resolves to whether it was accepted. */
  operate(command: OperatorCommand, reason?: string): Promise<boolean>;
}

export function createOperatorSession(runtime: Runtime): OperatorSession {
  const [name, setName] = createSignal(readStoredName());
  const [refusal, setRefusal] = createSignal<string | null>(null);
  return {
    name,
    setName: (value) => {
      setName(value);
      storeName(value);
    },
    refusal,
    operate: async (command, reason) => {
      const result = await runtime.operate(name(), command, reason);
      setRefusal(result.ok ? null : refusalMessages[result.error]);
      return result.ok;
    },
  };
}
