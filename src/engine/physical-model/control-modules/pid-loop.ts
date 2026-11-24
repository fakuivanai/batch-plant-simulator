// A PID loop: one control module that reads a transmitter, compares it with a
// setpoint and drives a control valve. TIC-201 reads TT-201 and drives
// heating valve TV-201. (In the tag, I is "indicating" and C is "controller".)
//
// Its mode decides where the setpoint and the output come from:
//   MANUAL      the operator sets the output, the valve opening, directly;
//   AUTOMATIC   the controller computes the output, the operator sets the setpoint;
//   CASCADE     the controller computes the output, a phase sets the setpoint.
//
// The mode the operator or a phase asks for is the target mode. The mode the
// loop is actually in can differ: when its measurement goes BAD it can't
// control, so it sheds to MANUAL with the valve closed, and returns to the
// target mode once the measurement is good again.
//
// This loop uses the proportional and integral terms only. The derivative
// term is left out, as it usually is on slow temperature loops, where it
// would mostly amplify measurement noise.

import type { Actor } from '../../actor.ts';
import { fromMilliamps, toMilliamps, type AnalogSignal, type SignalRange } from '../../io.ts';
import type { AlarmCondition } from '../../record/alarms.ts';
import type { Recorder } from '../../record/journal.ts';
import { accepted, refused, type Result } from '../../result.ts';
import { stepSeconds } from '../../time.ts';
import type { InterlockId } from '../interlocks.ts';
import { mayChangeMode, mayCommand, type Mode } from '../mode.ts';
import { statusOfSignal, type MeasuredValue } from '../status.ts';

export interface PidLoopConfiguration {
  readonly tag: string;
  readonly description: string;
  readonly transmitterTag: string;
  readonly valveTag: string;
  readonly range: SignalRange;
  readonly unit: string;
  /** Kc: percent of valve opening per unit of error. */
  readonly gainPercentPerUnit: number;
  /** Ti: the time the integral term takes to repeat the proportional term's action. */
  readonly integralTimeSeconds: number;
  /** The range the setpoint may be set in, the setpoint limits. */
  readonly setpointLimits: SignalRange;
  /** How far the measurement may rise above the setpoint before the high deviation alarm. */
  readonly highDeviationLimit: number;
}

export interface PidLoopSnapshot {
  readonly tag: string;
  readonly description: string;
  readonly transmitterTag: string;
  readonly valveTag: string;
  readonly unit: string;
  readonly range: SignalRange;
  readonly setpointLimits: SignalRange;
  readonly targetMode: Mode;
  readonly actualMode: Mode;
  readonly processValue: MeasuredValue;
  readonly setpoint: number;
  readonly outputPercent: number;
  readonly interlocks: readonly InterlockId[];
}

/** The output when the loop can't control: TV-201 closed, so no heat goes in. */
const failSafeOutputPercent = 0;

export class PidLoop {
  readonly configuration: PidLoopConfiguration;
  readonly #recorder: Recorder;
  // The loop starts in manual with TV-201 closed; the HEAT phase puts it in cascade.
  #targetMode: Mode = 'MANUAL';
  #processValue: MeasuredValue = { value: 0, status: 'BAD' };
  #setpoint: number;
  #outputPercent = failSafeOutputPercent;
  /** The integral term, in percent of output. */
  #integralPercent = failSafeOutputPercent;
  #interlocks: readonly InterlockId[] = [];

  constructor(configuration: PidLoopConfiguration, recorder: Recorder) {
    this.configuration = configuration;
    this.#recorder = recorder;
    this.#setpoint = configuration.setpointLimits.lower;
  }

  get targetMode(): Mode {
    return this.#targetMode;
  }

  /** The mode the loop is really in, which a BAD measurement can force away from the target. */
  get actualMode(): Mode {
    const controlling = this.#targetMode === 'AUTOMATIC' || this.#targetMode === 'CASCADE';
    if (controlling && this.#processValue.status === 'BAD') return 'MANUAL';
    return this.#targetMode;
  }

  get processValue(): MeasuredValue {
    return this.#processValue;
  }

  get setpoint(): number {
    return this.#setpoint;
  }

  get interlocked(): boolean {
    return this.#interlocks.length > 0;
  }

  get highDeviation(): boolean {
    const controlling = this.actualMode === 'AUTOMATIC' || this.actualMode === 'CASCADE';
    return (
      controlling &&
      !this.interlocked &&
      this.#processValue.status === 'GOOD' &&
      this.#processValue.value - this.#setpoint > this.configuration.highDeviationLimit
    );
  }

  get snapshot(): PidLoopSnapshot {
    return {
      tag: this.configuration.tag,
      description: this.configuration.description,
      transmitterTag: this.configuration.transmitterTag,
      valveTag: this.configuration.valveTag,
      unit: this.configuration.unit,
      range: this.configuration.range,
      setpointLimits: this.configuration.setpointLimits,
      targetMode: this.#targetMode,
      actualMode: this.actualMode,
      processValue: this.#processValue,
      setpoint: this.#setpoint,
      outputPercent: this.#outputPercent,
      interlocks: this.#interlocks,
    };
  }

  readSignal(signal: AnalogSignal): void {
    this.#processValue =
      this.#targetMode === 'OUT_OF_SERVICE'
        ? { value: this.#processValue.value, status: 'BAD' }
        : { value: fromMilliamps(signal.milliamps, this.configuration.range), status: statusOfSignal(signal.milliamps) };
  }

  setInterlocks(interlocks: readonly InterlockId[]): void {
    this.#interlocks = interlocks;
  }

  setMode(mode: Mode, by: Actor, reason?: string): Result<'MODE_REFUSES_ACTOR'> {
    if (mode === this.#targetMode) return accepted;
    if (!mayChangeMode(this.#targetMode, mode, by)) return refused('MODE_REFUSES_ACTOR');
    this.#recorder.record({ kind: 'mode-changed', module: this.configuration.tag, from: this.#targetMode, to: mode, by }, reason);
    this.#targetMode = mode;
    return accepted;
  }

  /**
   * The operator sets the setpoint in automatic, a phase in cascade. In manual
   * the setpoint follows the measurement (see `writeOutput`), so there is none
   * to set.
   */
  setSetpoint(value: number, by: Actor, reason?: string): Result<'MODE_REFUSES_ACTOR' | 'OUT_OF_RANGE'> {
    if (this.#targetMode === 'MANUAL' || !mayCommand(this.#targetMode, by)) return refused('MODE_REFUSES_ACTOR');
    const limits = this.configuration.setpointLimits;
    if (!(value >= limits.lower && value <= limits.upper)) return refused('OUT_OF_RANGE');
    if (value !== this.#setpoint) {
      this.#recorder.record(
        { kind: 'setpoint-changed', module: this.configuration.tag, from: this.#setpoint, to: value, unit: this.configuration.unit, by },
        reason,
      );
      this.#setpoint = value;
    }
    return accepted;
  }

  /** In manual the operator sets the output directly. */
  setOutput(percent: number, by: Actor, reason?: string): Result<'MODE_REFUSES_ACTOR' | 'OUT_OF_RANGE'> {
    if (this.#targetMode !== 'MANUAL' || by.kind !== 'operator') return refused('MODE_REFUSES_ACTOR');
    if (!(percent >= 0 && percent <= 100)) return refused('OUT_OF_RANGE');
    if (percent !== this.#outputPercent) {
      this.#recorder.record(
        { kind: 'output-changed', module: this.configuration.tag, from: this.#outputPercent, to: percent, by },
        reason,
      );
      this.#outputPercent = percent;
    }
    return accepted;
  }

  /**
   * A phase that is done with the loop, or holding, hands it back to the
   * operator: in manual, at the output the phase leaves it, normally closed.
   * Only the program driving the loop in cascade can do this.
   */
  handBack(outputPercent: number, by: Actor): Result<'MODE_REFUSES_ACTOR'> {
    if (this.#targetMode !== 'CASCADE' || by.kind !== 'program') return refused('MODE_REFUSES_ACTOR');
    this.#recorder.record({ kind: 'mode-changed', module: this.configuration.tag, from: 'CASCADE', to: 'MANUAL', by });
    this.#targetMode = 'MANUAL';
    if (outputPercent !== this.#outputPercent) {
      this.#recorder.record({ kind: 'output-changed', module: this.configuration.tag, from: this.#outputPercent, to: outputPercent, by });
      this.#outputPercent = outputPercent;
    }
    return accepted;
  }

  /** Computes this scan's output. */
  writeOutput(): void {
    const mode = this.actualMode;
    const shed = mode !== this.#targetMode;
    if (mode === 'OUT_OF_SERVICE' || shed || this.interlocked) {
      this.#outputPercent = failSafeOutputPercent;
    } else if (mode === 'AUTOMATIC' || mode === 'CASCADE') {
      this.#control();
      return;
    }
    // In manual the setpoint follows the measurement, so that switching to
    // automatic starts with no error. While the loop isn't controlling, the
    // integral term tracks the output, so that control resumes from the
    // current valve opening instead of with a jump: a bumpless transfer. The
    // integral term stays within the output's range, so it can't carry a
    // stale, out-of-range value into control.
    if (mode === 'MANUAL' && !shed && this.#processValue.status === 'GOOD') this.#setpoint = this.#processValue.value;
    this.#integralPercent = Math.min(100, Math.max(0, this.#outputPercent - this.#proportionalPercent()));
  }

  /** The output signal to the valve. */
  get outputMilliamps(): number {
    return toMilliamps(this.#outputPercent, { lower: 0, upper: 100 });
  }

  get alarmConditions(): readonly AlarmCondition[] {
    const conditions: AlarmCondition[] = [];
    if (this.#targetMode !== 'OUT_OF_SERVICE' && this.#processValue.status === 'BAD') {
      conditions.push({ module: this.configuration.transmitterTag, condition: 'signal failure', priority: 'MEDIUM' });
    }
    // Only the high side has an alarm: while heating up the temperature is far
    // below its setpoint by design, and an alarm that fires on every batch
    // teaches people to ignore alarms.
    if (this.highDeviation) {
      conditions.push({ module: this.configuration.tag, condition: 'high deviation', priority: 'LOW' });
    }
    return conditions;
  }

  /** The heating loop is reverse acting: the output rises as the measurement falls below the setpoint. */
  #error(): number {
    return this.#setpoint - this.#processValue.value;
  }

  #proportionalPercent(): number {
    return this.configuration.gainPercentPerUnit * this.#error();
  }

  #control(): void {
    const { gainPercentPerUnit, integralTimeSeconds } = this.configuration;
    const integralStep = (gainPercentPerUnit * this.#error() * stepSeconds) / integralTimeSeconds;
    const unclamped = this.#proportionalPercent() + this.#integralPercent + integralStep;
    // Anti-windup: while the valve is pinned fully open or shut, the integral
    // stops accumulating in the direction that pushes it further, so the loop
    // doesn't overshoot by the time it takes to unwind.
    const saturatedHigh = unclamped > 100 && integralStep > 0;
    const saturatedLow = unclamped < 0 && integralStep < 0;
    if (!saturatedHigh && !saturatedLow) this.#integralPercent += integralStep;
    this.#outputPercent = Math.min(100, Math.max(0, this.#proportionalPercent() + this.#integralPercent));
  }
}
