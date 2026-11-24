// An analog input: a transmitter's 4 to 20 mA signal turned into a value in
// engineering units, with a status. Level transmitter LT-201 is one.

import type { Actor } from '../../actor.ts';
import { fromMilliamps, type AnalogSignal, type SignalRange } from '../../io.ts';
import type { AlarmCondition } from '../../record/alarms.ts';
import type { Recorder } from '../../record/journal.ts';
import { accepted, refused, type Result } from '../../result.ts';
import { mayChangeMode } from '../mode.ts';
import { statusOfSignal, type MeasuredValue } from '../status.ts';

/** An input has nothing to drive, so its only modes are in service (automatic) and out of service. */
export type AnalogInputMode = 'OUT_OF_SERVICE' | 'AUTOMATIC';

export interface AnalogInputConfiguration {
  readonly tag: string;
  readonly description: string;
  readonly range: SignalRange;
  readonly unit: string;
}

export interface AnalogInputSnapshot {
  readonly tag: string;
  readonly description: string;
  readonly unit: string;
  readonly range: SignalRange;
  readonly mode: AnalogInputMode;
  readonly processValue: MeasuredValue;
  readonly signalMilliamps: number;
}

export class AnalogInput {
  readonly configuration: AnalogInputConfiguration;
  readonly #recorder: Recorder;
  #mode: AnalogInputMode = 'AUTOMATIC';
  #signalMilliamps = 4;
  #processValue: MeasuredValue = { value: 0, status: 'BAD' };

  constructor(configuration: AnalogInputConfiguration, recorder: Recorder) {
    this.configuration = configuration;
    this.#recorder = recorder;
  }

  /** The process value, PV: the measurement and its status. */
  get processValue(): MeasuredValue {
    return this.#processValue;
  }

  get snapshot(): AnalogInputSnapshot {
    return {
      tag: this.configuration.tag,
      description: this.configuration.description,
      unit: this.configuration.unit,
      range: this.configuration.range,
      mode: this.#mode,
      processValue: this.#processValue,
      signalMilliamps: this.#signalMilliamps,
    };
  }

  readSignal(signal: AnalogSignal): void {
    this.#signalMilliamps = signal.milliamps;
    this.#processValue =
      this.#mode === 'OUT_OF_SERVICE'
        ? { value: this.#processValue.value, status: 'BAD' }
        : { value: fromMilliamps(signal.milliamps, this.configuration.range), status: statusOfSignal(signal.milliamps) };
  }

  setMode(mode: AnalogInputMode, by: Actor, reason?: string): Result<'MODE_REFUSES_ACTOR'> {
    if (mode === this.#mode) return accepted;
    if (!mayChangeMode(this.#mode, mode, by)) return refused('MODE_REFUSES_ACTOR');
    this.#recorder.record({ kind: 'mode-changed', module: this.configuration.tag, from: this.#mode, to: mode, by }, reason);
    this.#mode = mode;
    return accepted;
  }

  get alarmConditions(): readonly AlarmCondition[] {
    // Out of service is a deliberate state, so its BAD value raises no alarm.
    if (this.#mode === 'OUT_OF_SERVICE' || this.#processValue.status !== 'BAD') return [];
    return [{ module: this.configuration.tag, condition: 'signal failure', priority: 'MEDIUM' }];
  }
}
