// A level switch used for protection, such as LSHH-201. It is a separate
// instrument from the level transmitter, so a transmitter that fails or sticks
// can't also blind the protection.

import type { FailSafeContact } from '../../io.ts';
import type { AlarmCondition } from '../../record/alarms.ts';

export interface LevelSwitchSnapshot {
  readonly tag: string;
  readonly description: string;
  readonly tripped: boolean;
}

export class LevelSwitch {
  readonly tag: string;
  readonly description: string;
  #tripped = false;

  constructor(tag: string, description: string) {
    this.tag = tag;
    this.description = description;
  }

  /** A fail-safe contact trips when it opens, whether from a high level or a broken wire. */
  readContact(contact: FailSafeContact): void {
    this.#tripped = !contact.contactClosed;
  }

  get tripped(): boolean {
    return this.#tripped;
  }

  get snapshot(): LevelSwitchSnapshot {
    return { tag: this.tag, description: this.description, tripped: this.#tripped };
  }

  get alarmConditions(): readonly AlarmCondition[] {
    return this.#tripped ? [{ module: this.tag, condition: 'high-high level', priority: 'HIGH' }] : [];
  }
}
