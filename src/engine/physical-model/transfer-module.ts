// The transfer equipment module: outlet valve XV-202 and transfer pump P-201
// working as one. In the ISA-88 physical model an equipment module groups
// control modules that carry out a minor activity together, and it can hold
// the logic that coordinates them. That logic is equipment control: it knows
// how the equipment has to move, not what the recipe wants.
//
// Here it is the order of things. Starting, the valve opens first and the
// pump starts only once the valve is confirmed open. Stopping, the pump stops
// first and the valve closes once the pump is confirmed stopped. A phase just
// asks the module to start or stop and doesn't need to know the order.

import { program } from '../actor.ts';
import type { DiscreteDevice } from './control-modules/discrete-device.ts';

export type TransferState =
  | 'STOPPED'
  | 'OPENING_VALVE'
  | 'STARTING_PUMP'
  | 'RUNNING'
  | 'STOPPING_PUMP'
  | 'CLOSING_VALVE'
  /** Abort: pump off and valve shut at once, without waiting on each other. */
  | 'SHUTTING_DOWN'
  /** A device failed or left cascade. Both devices are commanded off until STOP. */
  | 'FAILED';

export interface TransferModuleSnapshot {
  readonly name: string;
  readonly state: TransferState;
  readonly failure: string | null;
}

export class TransferModule {
  readonly name = 'Transfer';
  readonly #valve: DiscreteDevice;
  readonly #pump: DiscreteDevice;
  #state: TransferState = 'STOPPED';
  #failure: string | null = null;
  /** The module commands its devices itself, so the journal shows it as the actor. */
  readonly #actor = program('Transfer module');

  constructor(valve: DiscreteDevice, pump: DiscreteDevice) {
    this.#valve = valve;
    this.#pump = pump;
  }

  get state(): TransferState {
    return this.#state;
  }

  get failure(): string | null {
    return this.#failure;
  }

  get snapshot(): TransferModuleSnapshot {
    return { name: this.name, state: this.#state, failure: this.#failure };
  }

  /** Takes both devices into cascade and starts the transfer. */
  start(): void {
    this.#valve.setMode('CASCADE', this.#actor);
    this.#pump.setMode('CASCADE', this.#actor);
    this.#failure = null;
    if (this.#state === 'STOPPED' || this.#state === 'FAILED') this.#state = 'OPENING_VALVE';
  }

  /** Stops in order: pump first, then valve. */
  stop(): void {
    switch (this.#state) {
      case 'OPENING_VALVE':
      case 'STARTING_PUMP':
      case 'RUNNING':
      case 'FAILED':
        this.#state = 'STOPPING_PUMP';
        return;
      case 'STOPPED':
      case 'STOPPING_PUMP':
      case 'CLOSING_VALVE':
      case 'SHUTTING_DOWN':
        // Already stopping or stopped; asking again changes nothing.
        return;
    }
  }

  /** Shuts both down at once. */
  abort(): void {
    if (this.#state !== 'STOPPED') this.#state = 'SHUTTING_DOWN';
  }

  /** One scan of the module's logic, between the modules reading inputs and writing outputs. */
  scan(): void {
    const by = this.#actor;
    switch (this.#state) {
      case 'STOPPED':
        return;
      case 'OPENING_VALVE':
        this.#valve.command(true, by);
        if (this.#valve.confirmedActive) this.#state = 'STARTING_PUMP';
        break;
      case 'STARTING_PUMP':
        this.#valve.command(true, by);
        this.#pump.command(true, by);
        if (this.#pump.confirmedActive) this.#state = 'RUNNING';
        break;
      case 'RUNNING':
        this.#valve.command(true, by);
        this.#pump.command(true, by);
        break;
      case 'STOPPING_PUMP':
        this.#pump.command(false, by);
        if (this.#pump.confirmedPassive) this.#state = 'CLOSING_VALVE';
        return;
      case 'CLOSING_VALVE':
        this.#pump.command(false, by);
        this.#valve.command(false, by);
        if (this.#valve.confirmedPassive) this.#state = 'STOPPED';
        return;
      case 'SHUTTING_DOWN':
        this.#pump.command(false, by);
        this.#valve.command(false, by);
        if (this.#pump.confirmedPassive && this.#valve.confirmedPassive) this.#state = 'STOPPED';
        return;
      case 'FAILED':
        this.#pump.command(false, by);
        this.#valve.command(false, by);
        return;
    }
    // While starting or running, a device that fails or leaves cascade stops
    // the module, and so does an interlock on a device it needs running.
    const pumpNeeded = this.#state === 'STARTING_PUMP' || this.#state === 'RUNNING';
    const problem =
      this.#deviceProblem(this.#valve, true) ?? this.#deviceProblem(this.#pump, pumpNeeded);
    if (problem !== null) {
      this.#failure = problem;
      this.#state = 'FAILED';
    }
  }

  #deviceProblem(device: DiscreteDevice, needed: boolean): string | null {
    const tag = device.configuration.tag;
    if (device.failure !== null) return `${tag} failed`;
    if (device.mode !== 'CASCADE') return `${tag} is not in cascade`;
    if (needed && device.interlocked) return `${tag} is interlocked`;
    return null;
  }
}
