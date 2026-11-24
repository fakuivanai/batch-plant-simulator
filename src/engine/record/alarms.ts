// Alarms. A control module reports the abnormal conditions it sees; the alarm
// list turns each one into an alarm that the operator has to acknowledge,
// after ISA-18.2: an alarm stays on the list until it has both cleared and
// been acknowledged. One cause raises one alarm. When an interlock trips
// because LSHH-201 tripped, only LSHH-201 alarms, so the operator sees the
// cause rather than a flood of consequences.

import { accepted, refused, type Result } from '../result.ts';
import type { Actor } from '../actor.ts';
import type { AlarmPriority, Recorder } from './journal.ts';

export interface AlarmCondition {
  readonly module: string;
  /** What is wrong, in a few words: "failed to open". */
  readonly condition: string;
  readonly priority: AlarmPriority;
}

export interface Alarm extends AlarmCondition {
  /** The module and the condition together, which is what the operator reads. */
  readonly id: string;
  readonly active: boolean;
  readonly acknowledged: boolean;
  readonly raisedAtMilliseconds: number;
}

export function alarmId(condition: AlarmCondition): string {
  return `${condition.module} ${condition.condition}`;
}

export class AlarmList {
  #alarms: Alarm[] = [];
  readonly #recorder: Recorder;

  constructor(recorder: Recorder) {
    this.#recorder = recorder;
  }

  get alarms(): readonly Alarm[] {
    return this.#alarms;
  }

  /** Brings the list up to date with the conditions the modules report this scan. */
  update(conditions: readonly AlarmCondition[], nowMilliseconds: number): void {
    const present = new Map(conditions.map((condition) => [alarmId(condition), condition]));
    const next: Alarm[] = [];
    for (const alarm of this.#alarms) {
      const stillActive = present.has(alarm.id);
      present.delete(alarm.id);
      if (alarm.active && !stillActive) this.#recorder.record({ kind: 'alarm-cleared', alarm: alarm.id });
      if (!alarm.active && stillActive) this.#recorder.record({ kind: 'alarm-raised', alarm: alarm.id, priority: alarm.priority });
      if (!stillActive && alarm.acknowledged) continue;
      const returned = !alarm.active && stillActive;
      next.push({
        ...alarm,
        active: stillActive,
        acknowledged: returned ? false : alarm.acknowledged,
        raisedAtMilliseconds: returned ? nowMilliseconds : alarm.raisedAtMilliseconds,
      });
    }
    for (const [id, condition] of present) {
      this.#recorder.record({ kind: 'alarm-raised', alarm: id, priority: condition.priority });
      next.push({ ...condition, id, active: true, acknowledged: false, raisedAtMilliseconds: nowMilliseconds });
    }
    this.#alarms = next;
  }

  acknowledge(id: string, by: Actor): Result<'NO_SUCH_ALARM' | 'ALREADY_ACKNOWLEDGED'> {
    const alarm = this.#alarms.find((candidate) => candidate.id === id);
    if (alarm === undefined) return refused('NO_SUCH_ALARM');
    if (alarm.acknowledged) return refused('ALREADY_ACKNOWLEDGED');
    this.#recorder.record({ kind: 'alarm-acknowledged', alarm: id, by });
    this.#alarms = alarm.active
      ? this.#alarms.map((candidate) => (candidate === alarm ? { ...alarm, acknowledged: true } : candidate))
      : this.#alarms.filter((candidate) => candidate !== alarm);
    return accepted;
  }
}
