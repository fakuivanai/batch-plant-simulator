// A discrete device: an on/off valve or a motor, with the feedback that
// confirms it did what it was told. This is the control module behind most of
// a batch plant's equipment.
//
// The device has an active state (open, running) and a passive one (closed,
// stopped), which is also where it goes without power. Each scan it drives its
// output from its setpoint and checks the feedback against the output. If the
// feedback still disagrees after the timeout, the device has failed: it raises
// an alarm, goes to its passive state and stays failed until someone resets
// it. A phase using the device sees the failure and holds.

import type { Actor } from '../../actor.ts';
import type { MotorFeedback, ValveLimitSwitches } from '../../io.ts';
import type { AlarmCondition } from '../../record/alarms.ts';
import type { Recorder } from '../../record/journal.ts';
import { accepted, refused, type Result } from '../../result.ts';
import { stepMilliseconds } from '../../time.ts';
import { mayChangeMode, mayCommand } from '../mode.ts';
import type { InterlockId } from '../interlocks.ts';

export type DiscreteDeviceKind = 'valve' | 'motor';

/**
 * An on/off device has no control law between setpoint and output, so it has
 * no automatic mode: the operator drives it in manual, the control program in
 * cascade.
 */
export type DiscreteDeviceMode = 'OUT_OF_SERVICE' | 'MANUAL' | 'CASCADE';

/** What the feedback says the device is doing. */
export type Feedback =
  | 'ACTIVE'
  | 'PASSIVE'
  /** A valve between its limit switches. */
  | 'TRAVELLING'
  /** Both limit switches at once, which only a wiring or switch fault can produce. */
  | 'CONFLICTING';

export type DeviceFailure = 'FAILED_TO_ACTIVATE' | 'FAILED_TO_DEACTIVATE';

export function valveFeedback(switches: ValveLimitSwitches): Feedback {
  if (switches.openLimitSwitch && switches.closedLimitSwitch) return 'CONFLICTING';
  if (switches.openLimitSwitch) return 'ACTIVE';
  if (switches.closedLimitSwitch) return 'PASSIVE';
  return 'TRAVELLING';
}

export function motorFeedback(feedback: MotorFeedback): Feedback {
  return feedback.running ? 'ACTIVE' : 'PASSIVE';
}

/** The words the operator sees for each state of each kind of device. */
export const deviceWords = {
  valve: { active: 'OPEN', passive: 'CLOSED', failedToActivate: 'failed to open', failedToDeactivate: 'failed to close' },
  motor: { active: 'RUNNING', passive: 'STOPPED', failedToActivate: 'failed to start', failedToDeactivate: 'failed to stop' },
} as const;

export interface DiscreteDeviceConfiguration {
  readonly tag: string;
  readonly description: string;
  readonly kind: DiscreteDeviceKind;
  /**
   * How long the feedback may disagree with the output before the device
   * counts as failed. It is set to a few times the device's normal response,
   * so a slow device still passes and a stuck one is caught soon after.
   */
  readonly feedbackTimeoutMilliseconds: number;
}

export interface DiscreteDeviceSnapshot {
  readonly tag: string;
  readonly description: string;
  readonly kind: DiscreteDeviceKind;
  readonly mode: DiscreteDeviceMode;
  /** Whether the device has been asked to be active. */
  readonly setpoint: boolean;
  /** Whether the output to the field is energized. */
  readonly output: boolean;
  readonly feedback: Feedback;
  readonly failure: DeviceFailure | null;
  readonly interlocks: readonly InterlockId[];
}

export type CommandRefusal =
  | 'MODE_REFUSES_ACTOR'
  /** A failed device has to be reset before it takes commands again. */
  | 'DEVICE_FAILED'
  | 'INTERLOCKED';

export class DiscreteDevice {
  readonly configuration: DiscreteDeviceConfiguration;
  protected readonly recorder: Recorder;
  #mode: DiscreteDeviceMode = 'CASCADE';
  #setpoint = false;
  #output = false;
  #feedback: Feedback = 'PASSIVE';
  #disagreementMilliseconds = 0;
  #failure: DeviceFailure | null = null;
  #interlocks: readonly InterlockId[] = [];

  constructor(configuration: DiscreteDeviceConfiguration, recorder: Recorder) {
    this.configuration = configuration;
    this.recorder = recorder;
  }

  get mode(): DiscreteDeviceMode {
    return this.#mode;
  }

  get failure(): DeviceFailure | null {
    return this.#failure;
  }

  get interlocked(): boolean {
    return this.#interlocks.length > 0;
  }

  /** Whether the feedback confirms the device active. */
  get confirmedActive(): boolean {
    return this.#feedback === 'ACTIVE';
  }

  /** Whether the feedback confirms the device passive. */
  get confirmedPassive(): boolean {
    return this.#feedback === 'PASSIVE';
  }

  get snapshot(): DiscreteDeviceSnapshot {
    return {
      tag: this.configuration.tag,
      description: this.configuration.description,
      kind: this.configuration.kind,
      mode: this.#mode,
      setpoint: this.#setpoint,
      output: this.#output,
      feedback: this.#feedback,
      failure: this.#failure,
      interlocks: this.#interlocks,
    };
  }

  readFeedback(feedback: Feedback): void {
    this.#feedback = feedback;
  }

  setInterlocks(interlocks: readonly InterlockId[]): void {
    this.#interlocks = interlocks;
  }

  setMode(mode: DiscreteDeviceMode, by: Actor, reason?: string): Result<'MODE_REFUSES_ACTOR'> {
    if (mode === this.#mode) return accepted;
    if (!mayChangeMode(this.#mode, mode, by)) return refused('MODE_REFUSES_ACTOR');
    this.recorder.record({ kind: 'mode-changed', module: this.configuration.tag, from: this.#mode, to: mode, by }, reason);
    this.#mode = mode;
    return accepted;
  }

  /** Asks the device to be active (open, run) or passive (close, stop). */
  command(active: boolean, by: Actor, reason?: string): Result<CommandRefusal> {
    if (!mayCommand(this.#mode, by)) return refused('MODE_REFUSES_ACTOR');
    if (this.#failure !== null) return refused('DEVICE_FAILED');
    if (active && this.interlocked) return refused('INTERLOCKED');
    if (active !== this.#setpoint) {
      const words = deviceWords[this.configuration.kind];
      const name = (value: boolean) => (value ? words.active : words.passive);
      this.recorder.record(
        { kind: 'device-commanded', module: this.configuration.tag, from: name(this.#setpoint), to: name(active), by },
        reason,
      );
      this.#setpoint = active;
    }
    return accepted;
  }

  resetFailure(by: Actor, reason?: string): Result<'NOT_FAILED'> {
    if (this.#failure === null) return refused('NOT_FAILED');
    this.recorder.record({ kind: 'failure-reset', module: this.configuration.tag, failure: this.#failureWords(this.#failure), by }, reason);
    this.#failure = null;
    this.#disagreementMilliseconds = 0;
    return accepted;
  }

  /** Drives the output for this scan and checks the feedback against it. */
  writeOutput(): void {
    if (this.#mode === 'OUT_OF_SERVICE') {
      // Out of service the module doesn't run: no output, no checks.
      this.#output = false;
      this.#disagreementMilliseconds = 0;
      return;
    }
    // An interlock also drops the request, so the device doesn't start again
    // on its own once the interlock clears.
    if (this.interlocked) this.#setpoint = false;
    this.#output = this.#failure === null && this.#setpoint;
    const expected: Feedback = this.#output ? 'ACTIVE' : 'PASSIVE';
    if (this.#feedback === expected) {
      this.#disagreementMilliseconds = 0;
      return;
    }
    this.#disagreementMilliseconds += stepMilliseconds;
    if (this.#failure === null && this.#disagreementMilliseconds > this.configuration.feedbackTimeoutMilliseconds) {
      this.#failure = this.#output ? 'FAILED_TO_ACTIVATE' : 'FAILED_TO_DEACTIVATE';
      this.#setpoint = false;
      this.#output = false;
    }
  }

  /** The output signal to the field. */
  get output(): boolean {
    return this.#output;
  }

  get alarmConditions(): readonly AlarmCondition[] {
    if (this.#failure === null) return [];
    return [{ module: this.configuration.tag, condition: this.#failureWords(this.#failure), priority: 'MEDIUM' }];
  }

  #failureWords(failure: DeviceFailure): string {
    const words = deviceWords[this.configuration.kind];
    return failure === 'FAILED_TO_ACTIVATE' ? words.failedToActivate : words.failedToDeactivate;
  }
}
