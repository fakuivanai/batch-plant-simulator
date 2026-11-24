// A motor on a variable-speed drive, such as agitator AG-201: a discrete
// device for running and stopping, plus a speed setpoint sent to the drive.

import type { Actor } from '../../actor.ts';
import { toMilliamps, type SignalRange } from '../../io.ts';
import type { Recorder } from '../../record/journal.ts';
import { accepted, refused, type Result } from '../../result.ts';
import { mayCommand } from '../mode.ts';
import { DiscreteDevice, type DiscreteDeviceConfiguration, type DiscreteDeviceSnapshot } from './discrete-device.ts';

export interface VariableSpeedDriveSnapshot extends DiscreteDeviceSnapshot {
  readonly speedSetpointRpm: number;
  readonly speedRange: SignalRange;
}

export class VariableSpeedDrive extends DiscreteDevice {
  readonly #speedRange: SignalRange;
  #speedSetpointRpm = 0;

  constructor(configuration: DiscreteDeviceConfiguration & { readonly speedRange: SignalRange }, recorder: Recorder) {
    super(configuration, recorder);
    this.#speedRange = configuration.speedRange;
  }

  override get snapshot(): VariableSpeedDriveSnapshot {
    return { ...super.snapshot, speedSetpointRpm: this.#speedSetpointRpm, speedRange: this.#speedRange };
  }

  setSpeed(rpm: number, by: Actor, reason?: string): Result<'MODE_REFUSES_ACTOR' | 'OUT_OF_RANGE'> {
    if (!mayCommand(this.mode, by)) return refused('MODE_REFUSES_ACTOR');
    if (!(rpm >= this.#speedRange.lower && rpm <= this.#speedRange.upper)) return refused('OUT_OF_RANGE');
    if (rpm !== this.#speedSetpointRpm) {
      this.recorder.record(
        { kind: 'setpoint-changed', module: this.configuration.tag, from: this.#speedSetpointRpm, to: rpm, unit: 'rpm', by },
        reason,
      );
      this.#speedSetpointRpm = rpm;
    }
    return accepted;
  }

  get speedReferenceMilliamps(): number {
    return toMilliamps(this.#speedSetpointRpm, this.#speedRange);
  }
}
