// A batch: one run of the procedure, making one lot of product, from a
// control recipe (the master recipe with this batch's formula values).
//
// The batch's procedure runs the same ISA-88 state machine as a phase. Its
// own logic is coordination: start each phase with its parameters, wait for
// it to complete, reset it and go on to the next. Commands to the batch go
// down to the phase that is active: holding the batch holds that phase. And a
// phase that holds on its own, because its failure monitor found something
// wrong, holds the batch.
//
// While the batch runs it owns the unit's phases: the operator commands the
// batch, not the phases. This is the simplest form of what ISA-88 calls
// allocation, the batch acquiring the unit it needs.

import type { Actor } from '../actor.ts';
import { program } from '../actor.ts';
import { invariant } from '../invariant.ts';
import type { Recorder } from '../record/journal.ts';
import { accepted, refused, type Result } from '../result.ts';
import type { EquipmentPhase, PhaseName } from './phase.ts';
import { boundParameters, procedureSteps, type MasterRecipe, type ProcedureStep } from './recipe.ts';
import { isFinal, stateAfterCommand, type ProceduralCommand, type ProceduralState } from './state-machine.ts';

export type BatchTransitionCause =
  | { readonly kind: 'command'; readonly command: ProceduralCommand; readonly by: Actor }
  | { readonly kind: 'logic-done' }
  | { readonly kind: 'paused-between-phases' }
  | { readonly kind: 'phase-held'; readonly phase: PhaseName; readonly reason: string | null };

export type BatchCommandRefusal =
  | 'NOT_ACCEPTED_IN_STATE'
  /** A batch makes one lot; it is never reset and run again. */
  | 'BATCH_RUNS_ONCE'
  /** Stopping or aborting a batch is a deviation, so it needs a reason. */
  | 'REASON_REQUIRED'
  /** Another user of the unit's phases, or a phase not back in IDLE. */
  | 'EQUIPMENT_NOT_AVAILABLE';

export type FormulaChangeRefusal = 'BAD_FORMULA' | 'REASON_REQUIRED' | 'PARAMETER_ALREADY_USED' | 'BATCH_ENDED';

export interface FormulaValue {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly value: number;
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface BatchStepSnapshot {
  readonly unitProcedure: string;
  readonly operation: string;
  readonly phase: PhaseName;
  readonly parameters: Readonly<Record<string, number>>;
  readonly progress: 'DONE' | 'ACTIVE' | 'WAITING';
}

export interface BatchSnapshot {
  readonly id: string;
  readonly recipe: { readonly id: string; readonly version: number; readonly product: string; readonly procedure: string };
  readonly state: ProceduralState;
  readonly formula: readonly FormulaValue[];
  readonly steps: readonly BatchStepSnapshot[];
  readonly createdAtMilliseconds: number;
  readonly startedAtMilliseconds: number | null;
  readonly endedAtMilliseconds: number | null;
}

type ActiveState = Exclude<ProceduralState, 'IDLE' | 'COMPLETE' | 'STOPPED' | 'ABORTED'>;

/** Where the batch is: before its start, at a step of the procedure, or finished. */
type BatchStatus =
  | { readonly state: 'IDLE' }
  | { readonly state: ActiveState; readonly step: number }
  | { readonly state: 'COMPLETE' | 'STOPPED' | 'ABORTED' };

export class Batch<FormulaName extends string> {
  readonly id: string;
  readonly recipe: MasterRecipe<FormulaName>;
  readonly #steps: readonly ProcedureStep<FormulaName>[];
  readonly #phases: Readonly<Record<PhaseName, EquipmentPhase>>;
  readonly #recorder: Recorder;
  readonly #clock: () => number;
  readonly #actor: Actor;
  #formula: Record<FormulaName, number>;
  #status: BatchStatus = { state: 'IDLE' };
  readonly #createdAtMilliseconds: number;
  #startedAtMilliseconds: number | null = null;
  #endedAtMilliseconds: number | null = null;

  /** Use `createBatch`, which validates the formula first. */
  constructor(
    id: string,
    recipe: MasterRecipe<FormulaName>,
    formula: Record<FormulaName, number>,
    phases: Readonly<Record<PhaseName, EquipmentPhase>>,
    recorder: Recorder,
    clock: () => number,
  ) {
    this.id = id;
    this.recipe = recipe;
    this.#steps = procedureSteps(recipe);
    this.#formula = formula;
    this.#phases = phases;
    this.#recorder = recorder;
    this.#clock = clock;
    this.#actor = program(id);
    this.#createdAtMilliseconds = clock();
  }

  get state(): ProceduralState {
    return this.#status.state;
  }

  get ended(): boolean {
    return isFinal(this.#status.state);
  }

  get snapshot(): BatchSnapshot {
    const status = this.#status;
    const current = 'step' in status ? status.step : null;
    const progress = (index: number): BatchStepSnapshot['progress'] => {
      if (status.state === 'COMPLETE') return 'DONE';
      if (current === null) return 'WAITING';
      if (index < current) return 'DONE';
      return index === current ? 'ACTIVE' : 'WAITING';
    };
    return {
      id: this.id,
      recipe: { id: this.recipe.id, version: this.recipe.version, product: this.recipe.product, procedure: this.recipe.procedure.name },
      state: status.state,
      formula: this.#formulaValues(),
      steps: this.#steps.map((step, index) => ({
        unitProcedure: step.unitProcedure,
        operation: step.operation,
        phase: step.phase.phase,
        parameters: boundParameters(step.phase, this.#formula),
        progress: progress(index),
      })),
      createdAtMilliseconds: this.#createdAtMilliseconds,
      startedAtMilliseconds: this.#startedAtMilliseconds,
      endedAtMilliseconds: this.#endedAtMilliseconds,
    };
  }

  command(command: ProceduralCommand, by: Actor, reason?: string): Result<BatchCommandRefusal> {
    if (command === 'RESET') return refused('BATCH_RUNS_ONCE');
    const status = this.#status;
    const next = stateAfterCommand(status.state, command);
    if (next === null) return refused('NOT_ACCEPTED_IN_STATE');
    if ((command === 'STOP' || command === 'ABORT') && reason === undefined) return refused('REASON_REQUIRED');
    const cause: BatchTransitionCause = { kind: 'command', command, by };
    if (command === 'START') {
      const phases = Object.values(this.#phases);
      if (!phases.every((phase) => phase.state === 'IDLE' && phase.owner.kind === 'operator')) {
        return refused('EQUIPMENT_NOT_AVAILABLE');
      }
      for (const phase of phases) phase.setOwner({ kind: 'batch', batchId: this.id });
      this.#startedAtMilliseconds = this.#clock();
      this.#enter({ state: 'RUNNING', step: 0 }, cause, reason);
      return accepted;
    }
    // The other commands act on a batch in progress; the state table allows nothing else.
    invariant('step' in status, `${command} accepted in ${status.state}`);
    invariant(next !== 'IDLE' && !isFinal(next), `${command} leads straight to ${next}`);
    this.#enter({ state: next, step: status.step }, cause, reason);
    return accepted;
  }

  /** Changes a formula value before the phase that uses it has started. */
  changeFormula(name: string, value: number, by: Actor, reason: string | undefined): Result<FormulaChangeRefusal> {
    if (this.ended) return refused('BATCH_ENDED');
    const parameter = this.#formulaName(name);
    if (parameter === null) return refused('BAD_FORMULA');
    const definition = this.recipe.formula[parameter];
    if (!(value >= definition.minimum && value <= definition.maximum)) return refused('BAD_FORMULA');
    if (reason === undefined) return refused('REASON_REQUIRED');
    if (this.#steps.some((step, index) => this.#uses(step, parameter) && this.#started(index))) return refused('PARAMETER_ALREADY_USED');
    this.#recorder.record(
      { kind: 'formula-value-set', batchId: this.id, parameter, from: this.#formula[parameter], to: value, unit: definition.unit, by },
      reason,
    );
    this.#formula = { ...this.#formula, [parameter]: value };
    return accepted;
  }

  /** Records the control recipe's formula at creation, against the master recipe's defaults. */
  recordCreation(by: Actor, reason: string | undefined): void {
    this.#recorder.record({
      kind: 'batch-created',
      batchId: this.id,
      recipe: this.recipe.id,
      version: this.recipe.version,
      product: this.recipe.product,
      by,
    });
    for (const value of this.#formulaValues()) {
      this.#recorder.record(
        { kind: 'formula-value-set', batchId: this.id, parameter: value.name, from: value.defaultValue, to: value.value, unit: value.unit, by },
        value.value === value.defaultValue ? undefined : reason,
      );
    }
  }

  /** One scan of the procedure's logic, before the phases scan. */
  scan(): void {
    const status = this.#status;
    switch (status.state) {
      case 'RUNNING':
      case 'PAUSING':
        this.#run(status.step, status.state === 'PAUSING');
        return;
      case 'HOLDING': {
        const phase = this.#phaseAt(status.step);
        if (phase.state === 'COMPLETE') {
          this.#finishPhase(status.step, 'HELD');
          return;
        }
        if (stateAfterCommand(phase.state, 'HOLD') !== null) phase.command('HOLD', this.#actor);
        if (phase.state === 'HELD' || phase.state === 'IDLE') this.#enter({ state: 'HELD', step: status.step }, { kind: 'logic-done' });
        return;
      }
      case 'RESTARTING': {
        const phase = this.#phaseAt(status.step);
        if (phase.state === 'HELD') phase.command('RESTART', this.#actor);
        // A restart that meets the same problem holds the phase again, and with it the batch.
        if (phase.state === 'HOLDING') {
          this.#enter({ state: 'HOLDING', step: status.step }, { kind: 'phase-held', phase: phase.name, reason: phase.snapshot.failure });
          return;
        }
        if (phase.state === 'RUNNING' || phase.state === 'IDLE') {
          this.#enter({ state: 'RUNNING', step: status.step }, { kind: 'logic-done' });
        }
        return;
      }
      case 'STOPPING':
      case 'ABORTING': {
        const command = status.state === 'STOPPING' ? 'STOP' : 'ABORT';
        const phase = this.#phaseAt(status.step);
        if (stateAfterCommand(phase.state, command) !== null) phase.command(command, this.#actor);
        if (phase.state === 'IDLE' || isFinal(phase.state)) {
          this.#enter({ state: status.state === 'STOPPING' ? 'STOPPED' : 'ABORTED' }, { kind: 'logic-done' });
        }
        return;
      }
      case 'IDLE':
      case 'PAUSED':
      case 'HELD':
      case 'COMPLETE':
      case 'STOPPED':
      case 'ABORTED':
        return;
    }
  }

  /** RUNNING and PAUSING: start each phase, wait for it, go on to the next. PAUSING stops at the next boundary. */
  #run(step: number, pausing: boolean): void {
    const phase = this.#phaseAt(step);
    switch (phase.state) {
      case 'IDLE': {
        if (pausing) {
          this.#enter({ state: 'PAUSED', step }, { kind: 'paused-between-phases' });
          return;
        }
        const recipeStep = this.#stepAt(step);
        this.#recorder.record({
          kind: 'procedure-step-started',
          batchId: this.id,
          unitProcedure: recipeStep.unitProcedure,
          operation: recipeStep.operation,
          phase: recipeStep.phase.phase,
        });
        const started = phase.command('START', this.#actor, boundParameters(recipeStep.phase, this.#formula));
        invariant(started.ok, `${phase.name} refused START from its batch`);
        return;
      }
      case 'COMPLETE':
        this.#finishPhase(step, pausing ? 'PAUSED' : 'RUNNING');
        return;
      case 'HOLDING':
      case 'HELD':
        this.#enter({ state: 'HOLDING', step }, { kind: 'phase-held', phase: phase.name, reason: phase.snapshot.failure });
        return;
      case 'RUNNING':
      case 'PAUSING':
      case 'PAUSED':
      case 'RESTARTING':
      case 'STOPPING':
      case 'STOPPED':
      case 'ABORTING':
      case 'ABORTED':
        // Only the batch commands its phases, so a phase it runs can't stop or
        // abort on its own; while it works, the batch waits.
        return;
    }
  }

  /** Resets a completed phase and moves to the next step, or completes the batch after the last. */
  #finishPhase(step: number, then: 'RUNNING' | 'PAUSED' | 'HELD'): void {
    this.#phaseAt(step).command('RESET', this.#actor);
    if (step + 1 >= this.#steps.length) {
      this.#enter({ state: 'COMPLETE' }, { kind: 'logic-done' });
      return;
    }
    if (then === 'RUNNING') this.#status = { state: 'RUNNING', step: step + 1 };
    else this.#enter({ state: then, step: step + 1 }, then === 'PAUSED' ? { kind: 'paused-between-phases' } : { kind: 'logic-done' });
  }

  #enter(status: BatchStatus, cause: BatchTransitionCause, reason?: string): void {
    this.#recorder.record({ kind: 'batch-state-changed', batchId: this.id, from: this.#status.state, to: status.state, cause }, reason);
    // Releasing the phases is still part of the batch, so it happens, and is
    // recorded, before the batch counts as ended.
    if (isFinal(status.state)) this.#release();
    this.#status = status;
  }

  /** At the end the phases go back to IDLE and to the operator. */
  #release(): void {
    this.#endedAtMilliseconds = this.#clock();
    for (const phase of Object.values(this.#phases)) {
      if (isFinal(phase.state)) phase.command('RESET', this.#actor);
      phase.setOwner({ kind: 'operator' });
    }
  }

  #stepAt(index: number): ProcedureStep<FormulaName> {
    const step = this.#steps[index];
    invariant(step !== undefined, `no procedure step ${index}`);
    return step;
  }

  #phaseAt(index: number): EquipmentPhase {
    return this.#phases[this.#stepAt(index).phase.phase];
  }

  #uses(step: ProcedureStep<FormulaName>, parameter: FormulaName): boolean {
    const bindings: Readonly<Record<string, FormulaName>> = step.phase.parameters;
    return Object.values(bindings).includes(parameter);
  }

  /** Whether the procedure has started the phase of a step: it is past the step, or at it with the phase out of IDLE. */
  #started(index: number): boolean {
    const status = this.#status;
    if (!('step' in status)) return status.state !== 'IDLE';
    return index < status.step || (index === status.step && this.#phaseAt(index).state !== 'IDLE');
  }

  #formulaName(name: string): FormulaName | null {
    return isFormulaName(this.recipe, name) ? name : null;
  }

  #formulaValues(): FormulaValue[] {
    const definitions: Readonly<Record<string, { readonly description: string; readonly unit: string; readonly defaultValue: number; readonly minimum: number; readonly maximum: number }>> =
      this.recipe.formula;
    const values: Readonly<Record<string, number>> = this.#formula;
    return Object.entries(definitions).flatMap(([name, definition]) => {
      const value = values[name];
      return value === undefined ? [] : [{ name, ...definition, value }];
    });
  }
}

function isFormulaName<FormulaName extends string>(recipe: MasterRecipe<FormulaName>, name: string): name is FormulaName {
  return Object.hasOwn(recipe.formula, name);
}

/**
 * Makes a batch from a master recipe and the formula values asked for: every
 * value the recipe's formula lists, within its limits. A value that differs
 * from the recipe's default needs a reason. This is where outside input is
 * checked.
 */
export function createBatch<FormulaName extends string>(
  id: string,
  recipe: MasterRecipe<FormulaName>,
  values: Readonly<Record<string, number>>,
  reason: string | undefined,
  phases: Readonly<Record<PhaseName, EquipmentPhase>>,
  recorder: Recorder,
  clock: () => number,
): Batch<FormulaName> | 'BAD_FORMULA' | 'REASON_REQUIRED' {
  const definitions: Readonly<Record<string, { readonly defaultValue: number; readonly minimum: number; readonly maximum: number }>> =
    recipe.formula;
  const names = Object.keys(definitions);
  if (Object.keys(values).length !== names.length) return 'BAD_FORMULA';
  let changed = false;
  for (const name of names) {
    const value = values[name];
    const definition = definitions[name];
    if (value === undefined || definition === undefined) return 'BAD_FORMULA';
    if (!(value >= definition.minimum && value <= definition.maximum)) return 'BAD_FORMULA';
    if (value !== definition.defaultValue) changed = true;
  }
  if (changed && reason === undefined) return 'REASON_REQUIRED';
  if (!isFormula(recipe, values)) return 'BAD_FORMULA';
  return new Batch(id, recipe, { ...values }, phases, recorder, clock);
}

function isFormula<FormulaName extends string>(
  recipe: MasterRecipe<FormulaName>,
  values: Readonly<Record<string, number>>,
): values is Readonly<Record<string, number>> & Record<FormulaName, number> {
  return Object.keys(recipe.formula).every((name) => typeof values[name] === 'number');
}
