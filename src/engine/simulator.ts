// The whole simulation: the plant, and the control system that drives it
// through the I/O image. Its owner calls `step` to advance one fixed step;
// nothing here reads the wall clock.
//
// The operator acts through `operate`, which takes typed commands and refuses
// with a reason. That is the edge where outside input enters: the page today,
// OPC UA clients in the next stage.

import { operator } from './actor.ts';
import type { FieldInputs, FieldOutputs } from './io.ts';
import type { AnalogInputMode } from './physical-model/control-modules/analog-input.ts';
import type { DiscreteDeviceMode } from './physical-model/control-modules/discrete-device.ts';
import type { Mode } from './physical-model/mode.ts';
import { UnitT200, type DiscreteDeviceTag, type UnitSnapshot } from './physical-model/unit.ts';
import type { FaultKind } from './process/faults.ts';
import { Plant, type PlantSnapshot } from './process/plant.ts';
import { AlarmList, type Alarm } from './record/alarms.ts';
import { Journal, type JournalEntry } from './record/journal.ts';
import { refused, type Result } from './result.ts';
import { stepMilliseconds } from './time.ts';

export type OperatorCommand =
  | { readonly kind: 'set-device-mode'; readonly module: DiscreteDeviceTag; readonly mode: DiscreteDeviceMode }
  | { readonly kind: 'command-device'; readonly module: DiscreteDeviceTag; readonly active: boolean }
  | { readonly kind: 'reset-device-failure'; readonly module: DiscreteDeviceTag }
  | { readonly kind: 'set-agitator-speed'; readonly rpm: number }
  | { readonly kind: 'set-level-mode'; readonly mode: AnalogInputMode }
  | { readonly kind: 'set-loop-mode'; readonly mode: Mode }
  | { readonly kind: 'set-loop-setpoint'; readonly value: number }
  | { readonly kind: 'set-loop-output'; readonly percent: number }
  | { readonly kind: 'acknowledge-alarm'; readonly alarm: string };

export type OperatorRefusal =
  | 'NO_OPERATOR_NAME'
  | 'MODE_REFUSES_ACTOR'
  | 'DEVICE_FAILED'
  | 'INTERLOCKED'
  | 'NOT_FAILED'
  | 'OUT_OF_RANGE'
  | 'NO_SUCH_ALARM'
  | 'ALREADY_ACKNOWLEDGED';

export const refusalMessages: Record<OperatorRefusal, string> = {
  NO_OPERATOR_NAME: 'Enter your name first: every change is recorded with who made it.',
  MODE_REFUSES_ACTOR: "The module's mode doesn't let you do that. Put it in manual (or automatic) first.",
  DEVICE_FAILED: 'The device has failed. Reset the failure first.',
  INTERLOCKED: 'An interlock holds the device in its safe state.',
  NOT_FAILED: 'There is no failure to reset.',
  OUT_OF_RANGE: 'The value is outside the allowed range.',
  NO_SUCH_ALARM: 'That alarm is no longer on the list.',
  ALREADY_ACKNOWLEDGED: 'That alarm is already acknowledged.',
};

/** A fault injected or cleared. Kept apart from the journal: the control system can't know about it. */
export interface FaultLogEntry {
  readonly atMilliseconds: number;
  readonly fault: FaultKind;
  readonly action: 'injected' | 'cleared';
}

export interface SimulatorSnapshot {
  readonly timeMilliseconds: number;
  readonly plant: PlantSnapshot;
  readonly activeFaults: readonly FaultKind[];
  readonly faultLog: readonly FaultLogEntry[];
  readonly inputs: FieldInputs;
  readonly outputs: FieldOutputs;
  readonly unit: UnitSnapshot;
  readonly alarms: readonly Alarm[];
  readonly journal: readonly JournalEntry[];
}

export class Simulator {
  readonly #plant: Plant;
  readonly #journal: Journal;
  readonly #alarms: AlarmList;
  readonly #unit: UnitT200;
  readonly #faultLog: FaultLogEntry[] = [];
  #timeMilliseconds = 0;
  #outputs: FieldOutputs;

  constructor(seed: number) {
    this.#plant = new Plant(seed);
    this.#journal = new Journal(
      () => this.#timeMilliseconds,
      () => null,
    );
    this.#alarms = new AlarmList(this.#journal);
    this.#unit = new UnitT200(this.#journal);
    this.#outputs = this.#scan();
  }

  get timeMilliseconds(): number {
    return this.#timeMilliseconds;
  }

  /** The unit, for the control logic and for tests. Operators go through `operate`. */
  get unit(): UnitT200 {
    return this.#unit;
  }

  step(): void {
    this.#plant.step(this.#outputs);
    this.#timeMilliseconds += stepMilliseconds;
    this.#outputs = this.#scan();
  }

  /** One scan of the control system: read the inputs, run the logic, write the outputs. */
  #scan(): FieldOutputs {
    this.#unit.readInputs(this.#plant.inputs);
    const outputs = this.#unit.writeOutputs();
    this.#alarms.update(this.#unit.alarmConditions, this.#timeMilliseconds);
    return outputs;
  }

  operate(operatorName: string, command: OperatorCommand, reason?: string): Result<OperatorRefusal> {
    const name = operatorName.trim();
    if (name === '') return refused('NO_OPERATOR_NAME');
    const by = operator(name);
    const why = reason?.trim() || undefined;
    switch (command.kind) {
      case 'set-device-mode':
        return this.#unit.discreteDevice(command.module).setMode(command.mode, by, why);
      case 'command-device':
        return this.#unit.discreteDevice(command.module).command(command.active, by, why);
      case 'reset-device-failure':
        return this.#unit.discreteDevice(command.module).resetFailure(by, why);
      case 'set-agitator-speed':
        return this.#unit.agitator.setSpeed(command.rpm, by, why);
      case 'set-level-mode':
        return this.#unit.level.setMode(command.mode, by, why);
      case 'set-loop-mode':
        return this.#unit.temperature.setMode(command.mode, by, why);
      case 'set-loop-setpoint':
        return this.#unit.temperature.setSetpoint(command.value, by, why);
      case 'set-loop-output':
        return this.#unit.temperature.setOutput(command.percent, by, why);
      case 'acknowledge-alarm':
        return this.#alarms.acknowledge(command.alarm, by);
    }
  }

  injectFault(fault: FaultKind): void {
    this.#plant.inject(fault);
    this.#faultLog.push({ atMilliseconds: this.#timeMilliseconds, fault, action: 'injected' });
  }

  clearFault(fault: FaultKind): void {
    this.#plant.clear(fault);
    this.#faultLog.push({ atMilliseconds: this.#timeMilliseconds, fault, action: 'cleared' });
  }

  snapshot(): SimulatorSnapshot {
    return {
      timeMilliseconds: this.#timeMilliseconds,
      plant: this.#plant.snapshot,
      activeFaults: this.#plant.activeFaults,
      faultLog: [...this.#faultLog],
      inputs: this.#plant.inputs,
      outputs: this.#outputs,
      unit: this.#unit.snapshot,
      alarms: this.#alarms.alarms,
      journal: [...this.#journal.entries],
    };
  }
}
