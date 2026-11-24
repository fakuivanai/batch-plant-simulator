// The whole simulation: the plant, and the control system that drives it
// through the I/O image. Its owner calls `step` to advance one fixed step;
// nothing here reads the wall clock.
//
// The operator acts through `operate`, which takes typed commands and refuses
// with a reason. That is the edge where outside input enters: the page today,
// OPC UA clients in the next stage.

import { operator, type Actor } from './actor.ts';
import type { FieldInputs, FieldOutputs } from './io.ts';
import type { AnalogInputMode } from './physical-model/control-modules/analog-input.ts';
import type { DiscreteDeviceMode } from './physical-model/control-modules/discrete-device.ts';
import type { Mode } from './physical-model/mode.ts';
import { UnitT200, type DiscreteDeviceTag, type UnitSnapshot } from './physical-model/unit.ts';
import type { FaultKind } from './process/faults.ts';
import { Plant, type PlantSnapshot } from './process/plant.ts';
import { createBatch, type Batch, type BatchCommandRefusal, type BatchSnapshot, type FormulaChangeRefusal } from './procedural-model/batch.ts';
import { Phase, type EquipmentPhase, type PhaseCommandRefusal, type PhaseName, type PhaseSnapshot } from './procedural-model/phase.ts';
import { agitate } from './procedural-model/phases/agitate.ts';
import { chargeWater } from './procedural-model/phases/charge-water.ts';
import { heat } from './procedural-model/phases/heat.ts';
import { transfer } from './procedural-model/phases/transfer.ts';
import { bufferPreparation } from './procedural-model/recipe.ts';
import type { ProceduralCommand } from './procedural-model/state-machine.ts';
import { AlarmList, type Alarm } from './record/alarms.ts';
import { Journal, type JournalEntry } from './record/journal.ts';
import { accepted, refused, type Result } from './result.ts';
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
  | { readonly kind: 'acknowledge-alarm'; readonly alarm: string }
  | {
      readonly kind: 'phase-command';
      readonly phase: PhaseName;
      readonly command: ProceduralCommand;
      /** START's parameters, by name. */
      readonly parameters?: Readonly<Record<string, number>>;
    }
  | { readonly kind: 'create-batch'; readonly formula: Readonly<Record<string, number>> }
  | { readonly kind: 'batch-command'; readonly command: ProceduralCommand }
  | { readonly kind: 'change-formula-value'; readonly parameter: string; readonly value: number };

export type OperatorRefusal =
  | 'NO_OPERATOR_NAME'
  | 'MODE_REFUSES_ACTOR'
  | 'DEVICE_FAILED'
  | 'INTERLOCKED'
  | 'NOT_FAILED'
  | 'OUT_OF_RANGE'
  | 'NO_SUCH_ALARM'
  | 'ALREADY_ACKNOWLEDGED'
  | PhaseCommandRefusal
  | BatchCommandRefusal
  | FormulaChangeRefusal
  | 'BATCH_ALREADY_ACTIVE'
  | 'NO_ACTIVE_BATCH';

export const refusalMessages: Record<OperatorRefusal, string> = {
  NO_OPERATOR_NAME: 'Enter your name first: every change is recorded with who made it.',
  MODE_REFUSES_ACTOR: "The module's mode doesn't let you do that. Put it in manual (or automatic) first.",
  DEVICE_FAILED: 'The device has failed. Reset the failure first.',
  INTERLOCKED: 'An interlock holds the device in its safe state.',
  NOT_FAILED: 'There is no failure to reset.',
  OUT_OF_RANGE: 'The value is outside the allowed range.',
  NO_SUCH_ALARM: 'That alarm is no longer on the list.',
  ALREADY_ACKNOWLEDGED: 'That alarm is already acknowledged.',
  NOT_ACCEPTED_IN_STATE: "The phase's state doesn't accept that command.",
  OWNED_BY_BATCH: 'A batch owns the phase. Command the batch instead.',
  NOT_OWNER: 'Only the owner of the phase can command it.',
  BAD_PARAMETERS: 'Every parameter needs a value within its limits.',
  BATCH_RUNS_ONCE: 'A batch makes one lot and is never reset. Create a new batch instead.',
  REASON_REQUIRED: 'This change needs a reason: it is recorded in the batch record.',
  EQUIPMENT_NOT_AVAILABLE: 'Every phase has to be IDLE and free before a batch can start.',
  BAD_FORMULA: 'Every formula value needs a number within its limits.',
  PARAMETER_ALREADY_USED: 'The phase that uses this value has already started.',
  BATCH_ENDED: 'The batch has ended.',
  BATCH_ALREADY_ACTIVE: 'A batch is already active on T-200. It has to end before another is created.',
  NO_ACTIVE_BATCH: 'There is no active batch.',
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
  readonly phases: Readonly<Record<PhaseName, PhaseSnapshot>>;
  /** Every batch made so far, oldest first. At most the last one is active. */
  readonly batches: readonly BatchSnapshot[];
  readonly alarms: readonly Alarm[];
  readonly journal: readonly JournalEntry[];
}

export class Simulator {
  readonly #plant: Plant;
  readonly #journal: Journal;
  readonly #alarms: AlarmList;
  readonly #unit: UnitT200;
  readonly #phases: Readonly<Record<PhaseName, EquipmentPhase>>;
  readonly #faultLog: FaultLogEntry[] = [];
  readonly #batches: Batch<string>[] = [];
  #timeMilliseconds = 0;
  #outputs: FieldOutputs;

  constructor(seed: number) {
    this.#plant = new Plant(seed);
    this.#journal = new Journal(
      () => this.#timeMilliseconds,
      () => this.#activeBatch()?.id ?? null,
    );
    this.#alarms = new AlarmList(this.#journal);
    this.#unit = new UnitT200(this.#journal);
    this.#phases = {
      CHARGE_WATER: new Phase(chargeWater, this.#journal),
      AGITATE: new Phase(agitate, this.#journal),
      HEAT: new Phase(heat, this.#journal),
      TRANSFER: new Phase(transfer, this.#journal),
    };
    this.#outputs = this.#scan();
  }

  get timeMilliseconds(): number {
    return this.#timeMilliseconds;
  }

  /** The unit, for the control logic and for tests. Operators go through `operate`. */
  get unit(): UnitT200 {
    return this.#unit;
  }

  /** A phase, for tests. Operators go through `operate`. */
  phase(name: PhaseName): EquipmentPhase {
    return this.#phases[name];
  }

  step(): void {
    this.#plant.step(this.#outputs);
    this.#timeMilliseconds += stepMilliseconds;
    this.#outputs = this.#scan();
  }

  /** One scan of the control system: read the inputs, run the logic, write the outputs. */
  #scan(): FieldOutputs {
    this.#unit.readInputs(this.#plant.inputs);
    this.#activeBatch()?.scan();
    for (const phase of Object.values(this.#phases)) phase.scan(this.#unit);
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
      case 'phase-command':
        return this.#phases[command.phase].command(command.command, by, command.parameters);
      case 'create-batch':
        return this.#createBatch(command.formula, by, why);
      case 'batch-command':
        return this.#activeBatch()?.command(command.command, by, why) ?? refused('NO_ACTIVE_BATCH');
      case 'change-formula-value':
        return this.#activeBatch()?.changeFormula(command.parameter, command.value, by, why) ?? refused('NO_ACTIVE_BATCH');
    }
  }

  /** The batch that has been created and hasn't ended, if any. */
  #activeBatch(): Batch<string> | null {
    const last = this.#batches.at(-1);
    return last === undefined || last.ended ? null : last;
  }

  #createBatch(formula: Readonly<Record<string, number>>, by: Actor, reason: string | undefined): Result<OperatorRefusal> {
    if (this.#activeBatch() !== null) return refused('BATCH_ALREADY_ACTIVE');
    const id = `B-${String(this.#batches.length + 1).padStart(4, '0')}`;
    const batch = createBatch(id, bufferPreparation, formula, reason, this.#phases, this.#journal, () => this.#timeMilliseconds);
    if (typeof batch === 'string') return refused(batch);
    this.#batches.push(batch);
    batch.recordCreation(by, reason);
    return accepted;
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
      phases: {
        CHARGE_WATER: this.#phases.CHARGE_WATER.snapshot,
        AGITATE: this.#phases.AGITATE.snapshot,
        HEAT: this.#phases.HEAT.snapshot,
        TRANSFER: this.#phases.TRANSFER.snapshot,
      },
      batches: this.#batches.map((batch) => batch.snapshot),
      alarms: this.#alarms.alarms,
      journal: [...this.#journal.entries],
    };
  }
}
