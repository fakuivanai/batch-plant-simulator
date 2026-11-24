// A phase: the smallest piece of procedure that the equipment knows how to
// carry out, such as "charge water". In the ISA-88 procedural model, a recipe
// is a tree of procedure, unit procedures and operations, and its leaves are
// phases that run in the equipment. This file is the equipment phase: its
// state machine and the logic that runs in each state.
//
// A phase definition supplies logic for each state that runs logic (RUNNING,
// HOLDING, RESTARTING, STOPPING, ABORTING). Each state's logic is a sequence
// of named steps, like the steps of a sequential function chart (SFC): each
// scan the active step runs once, does its actions and says which step comes
// next, or that the state's logic is done.
//
// Next to the logic runs the failure monitor. While the phase works toward
// its goal, it checks the equipment each scan, and when something is wrong it
// puts the phase in HOLDING, recording why.

import type { Actor } from '../actor.ts';
import { program } from '../actor.ts';
import type { UnitT200 } from '../physical-model/unit.ts';
import type { Recorder } from '../record/journal.ts';
import { invariant } from '../invariant.ts';
import { accepted, refused, type Result } from '../result.ts';
import { stepMilliseconds } from '../time.ts';
import {
  isMonitored,
  logicDoneTransitions,
  stateAfterCommand,
  type LogicState,
  type ProceduralCommand,
  type ProceduralState,
} from './state-machine.ts';

export type PhaseName = 'CHARGE_WATER' | 'AGITATE' | 'HEAT' | 'TRANSFER';

/** What a step returns when its state's logic is finished. */
export const done = 'DONE';

export type StepFunction<Step extends string, Context> = (context: Context) => Step | typeof done;

export interface StateLogic<Step extends string, Context> {
  readonly firstStep: Step;
  readonly steps: { readonly [Name in Step]: StepFunction<Step, Context> };
}

/** A recipe parameter the phase takes when it starts. */
export interface ParameterDefinition {
  readonly description: string;
  readonly unit: string;
  readonly minimum: number;
  readonly maximum: number;
}

export type ParameterDefinitions<Parameters> = { readonly [Name in keyof Parameters]: ParameterDefinition };

/** What a step can see and use. */
export interface PhaseContext<Parameters> {
  readonly unit: UnitT200;
  readonly parameters: Parameters;
  /** The phase, as the actor its commands to the equipment are recorded under. */
  readonly actor: Actor;
  /** How long the active step has run. A RUNNING step's time is kept through a pause or a hold. */
  readonly stepMilliseconds: number;
  /** How long the RUNNING logic has run in total since the phase started. */
  readonly runningMilliseconds: number;
}

/** The step names of each state's logic. */
export type PhaseSteps = { readonly [State in LogicState]: string };

export interface PhaseDefinition<Parameters extends Record<string, number>, Steps extends PhaseSteps> {
  readonly name: PhaseName;
  readonly description: string;
  readonly parameters: ParameterDefinitions<Parameters>;
  readonly logic: { readonly [State in LogicState]: StateLogic<Steps[State], PhaseContext<Parameters>> };
  /** RUNNING steps where PAUSE may stop the phase. A phase without any runs to completion when paused. */
  readonly pausePoints: readonly Steps['RUNNING'][];
  /** Returns why the phase can't go on, or null when all is well. */
  readonly failureMonitor: (context: PhaseContext<Parameters>) => string | null;
}

/** Who may command a phase: the operator, or a batch that has taken it over. */
export type PhaseOwner = { readonly kind: 'operator' } | { readonly kind: 'batch'; readonly batchId: string };

export interface PhaseSnapshot {
  readonly name: PhaseName;
  readonly description: string;
  readonly state: ProceduralState;
  /** The active step of the state's logic, or of the RUNNING logic while paused or held. */
  readonly step: string | null;
  readonly parameters: Readonly<Record<string, number>> | null;
  readonly parameterDefinitions: Readonly<Record<string, ParameterDefinition>>;
  readonly owner: PhaseOwner;
  /** Why the failure monitor last held the phase. */
  readonly failure: string | null;
}

export type PhaseCommandRefusal = 'NOT_ACCEPTED_IN_STATE' | 'OWNED_BY_BATCH' | 'NOT_OWNER' | 'BAD_PARAMETERS';

interface StepPosition<Step extends string> {
  readonly step: Step;
  readonly milliseconds: number;
}

/**
 * The phase's state with what goes with it. A phase that isn't working has no
 * step and no parameters; a held one remembers where its RUNNING logic was.
 */
type PhaseStatus<Parameters, Steps extends PhaseSteps> =
  | { readonly state: 'IDLE' | 'COMPLETE' | 'STOPPED' | 'ABORTED' }
  | {
      readonly state: 'RUNNING' | 'PAUSING' | 'PAUSED';
      readonly parameters: Parameters;
      readonly running: StepPosition<Steps['RUNNING']>;
    }
  | {
      readonly state: 'HOLDING';
      readonly parameters: Parameters;
      readonly running: StepPosition<Steps['RUNNING']>;
      readonly active: StepPosition<Steps['HOLDING']>;
    }
  | { readonly state: 'HELD'; readonly parameters: Parameters; readonly running: StepPosition<Steps['RUNNING']> }
  | {
      readonly state: 'RESTARTING';
      readonly parameters: Parameters;
      readonly running: StepPosition<Steps['RUNNING']>;
      readonly active: StepPosition<Steps['RESTARTING']>;
    }
  | { readonly state: 'STOPPING'; readonly parameters: Parameters; readonly active: StepPosition<Steps['STOPPING']> }
  | { readonly state: 'ABORTING'; readonly parameters: Parameters; readonly active: StepPosition<Steps['ABORTING']> };

export type PhaseTransitionCause =
  | { readonly kind: 'command'; readonly command: ProceduralCommand; readonly by: Actor }
  | { readonly kind: 'logic-done' }
  | { readonly kind: 'paused-at-pause-point' }
  | { readonly kind: 'failure'; readonly reason: string };

/** A phase that can be commanded and scanned, whatever its parameters and steps. */
export interface EquipmentPhase {
  readonly name: PhaseName;
  readonly state: ProceduralState;
  readonly owner: PhaseOwner;
  readonly snapshot: PhaseSnapshot;
  command(command: ProceduralCommand, by: Actor, parameters?: Readonly<Record<string, number>>): Result<PhaseCommandRefusal>;
  setOwner(owner: PhaseOwner): void;
  scan(unit: UnitT200): void;
}

export class Phase<Parameters extends Record<string, number>, Steps extends PhaseSteps> implements EquipmentPhase {
  readonly definition: PhaseDefinition<Parameters, Steps>;
  readonly #recorder: Recorder;
  readonly #actor: Actor;
  #status: PhaseStatus<Parameters, Steps> = { state: 'IDLE' };
  #runningMilliseconds = 0;
  #owner: PhaseOwner = { kind: 'operator' };
  #failure: string | null = null;

  constructor(definition: PhaseDefinition<Parameters, Steps>, recorder: Recorder) {
    this.definition = definition;
    this.#recorder = recorder;
    this.#actor = program(definition.name);
  }

  get name(): PhaseName {
    return this.definition.name;
  }

  get state(): ProceduralState {
    return this.#status.state;
  }

  get owner(): PhaseOwner {
    return this.#owner;
  }

  setOwner(owner: PhaseOwner): void {
    this.#owner = owner;
  }

  get snapshot(): PhaseSnapshot {
    const status = this.#status;
    const step = 'active' in status ? status.active.step : 'running' in status ? status.running.step : null;
    return {
      name: this.definition.name,
      description: this.definition.description,
      state: status.state,
      step,
      parameters: 'parameters' in status ? status.parameters : null,
      parameterDefinitions: this.definition.parameters,
      owner: this.#owner,
      failure: this.#failure,
    };
  }

  /**
   * Commands from the operator or the owning batch. START takes the
   * parameters, checked here, at the edge, against the phase's definitions.
   */
  command(
    command: ProceduralCommand,
    by: Actor,
    parameters?: Readonly<Record<string, number>>,
  ): Result<PhaseCommandRefusal> {
    const owner = this.#owner;
    if (owner.kind === 'batch' && !(by.kind === 'program' && by.name === owner.batchId)) {
      return refused(by.kind === 'operator' ? 'OWNED_BY_BATCH' : 'NOT_OWNER');
    }
    if (owner.kind === 'operator' && by.kind !== 'operator') return refused('NOT_OWNER');
    const status = this.#status;
    const next = stateAfterCommand(status.state, command);
    if (next === null) return refused('NOT_ACCEPTED_IN_STATE');
    const cause: PhaseTransitionCause = { kind: 'command', command, by };
    if (command === 'START') {
      if (parameters === undefined || !this.#validParameters(parameters)) return refused('BAD_PARAMETERS');
      this.#runningMilliseconds = 0;
      this.#failure = null;
      this.#recorder.record({ kind: 'phase-parameters', phase: this.name, parameters: { ...parameters }, by });
      this.#enter({ state: 'RUNNING', parameters: { ...parameters }, running: this.#first('RUNNING') }, cause);
      return accepted;
    }
    if (command === 'RESET') {
      this.#enter({ state: 'IDLE' }, cause);
      return accepted;
    }
    // Every other command acts on a phase that is working, so it has its
    // parameters; the state table allows nothing else.
    invariant('parameters' in status, `${command} accepted in ${status.state}`);
    switch (next) {
      case 'RUNNING':
      case 'PAUSING':
        invariant('running' in status, `${command} from ${status.state}`);
        this.#enter({ state: next, parameters: status.parameters, running: status.running }, cause);
        return accepted;
      case 'HOLDING':
        invariant('running' in status, `HOLD from ${status.state}`);
        this.#hold(status.parameters, status.running, cause);
        return accepted;
      case 'RESTARTING':
        invariant('running' in status, `RESTART from ${status.state}`);
        this.#enter(
          { state: 'RESTARTING', parameters: status.parameters, running: status.running, active: this.#first('RESTARTING') },
          cause,
        );
        return accepted;
      case 'STOPPING':
        this.#enter({ state: 'STOPPING', parameters: status.parameters, active: this.#first('STOPPING') }, cause);
        return accepted;
      case 'ABORTING':
        this.#enter({ state: 'ABORTING', parameters: status.parameters, active: this.#first('ABORTING') }, cause);
        return accepted;
      case 'IDLE':
      case 'COMPLETE':
      case 'PAUSED':
      case 'HELD':
      case 'STOPPED':
      case 'ABORTED':
        // Only logic or RESET reach these states, never a command directly.
        throw new Error(`Invariant broken: ${command} leads straight to ${next}`);
    }
  }

  /** One scan: run the active state's logic, then the failure monitor. */
  scan(unit: UnitT200): void {
    const status = this.#status;
    switch (status.state) {
      case 'RUNNING':
      case 'PAUSING': {
        if (status.state === 'PAUSING' && this.definition.pausePoints.includes(status.running.step)) {
          this.#enter({ state: 'PAUSED', parameters: status.parameters, running: status.running }, { kind: 'paused-at-pause-point' });
          break;
        }
        const context = this.#context(unit, status.parameters, status.running.milliseconds);
        const next = this.definition.logic.RUNNING.steps[status.running.step](context);
        this.#runningMilliseconds += stepMilliseconds;
        if (next === done) {
          this.#enter({ state: 'COMPLETE' }, { kind: 'logic-done' });
        } else {
          this.#status = { ...status, running: this.#advance(status.running, next) };
        }
        break;
      }
      case 'HOLDING': {
        const next = this.definition.logic.HOLDING.steps[status.active.step](
          this.#context(unit, status.parameters, status.active.milliseconds),
        );
        if (next === done) this.#enter({ state: 'HELD', parameters: status.parameters, running: status.running }, { kind: 'logic-done' });
        else this.#status = { ...status, active: this.#advance(status.active, next) };
        break;
      }
      case 'RESTARTING': {
        const next = this.definition.logic.RESTARTING.steps[status.active.step](
          this.#context(unit, status.parameters, status.active.milliseconds),
        );
        if (next === done) this.#enter({ state: 'RUNNING', parameters: status.parameters, running: status.running }, { kind: 'logic-done' });
        else this.#status = { ...status, active: this.#advance(status.active, next) };
        break;
      }
      case 'STOPPING': {
        const next = this.definition.logic.STOPPING.steps[status.active.step](
          this.#context(unit, status.parameters, status.active.milliseconds),
        );
        if (next === done) this.#enter({ state: logicDoneTransitions.STOPPING }, { kind: 'logic-done' });
        else this.#status = { ...status, active: this.#advance(status.active, next) };
        break;
      }
      case 'ABORTING': {
        const next = this.definition.logic.ABORTING.steps[status.active.step](
          this.#context(unit, status.parameters, status.active.milliseconds),
        );
        if (next === done) this.#enter({ state: logicDoneTransitions.ABORTING }, { kind: 'logic-done' });
        else this.#status = { ...status, active: this.#advance(status.active, next) };
        break;
      }
      case 'PAUSED':
      case 'HELD':
      case 'IDLE':
      case 'COMPLETE':
      case 'STOPPED':
      case 'ABORTED':
        break;
    }
    this.#monitor(unit);
  }

  #monitor(unit: UnitT200): void {
    const status = this.#status;
    if (!isMonitored(status.state) || !('running' in status)) return;
    const reason = this.definition.failureMonitor(this.#context(unit, status.parameters, 0));
    if (reason === null) return;
    this.#failure = reason;
    this.#hold(status.parameters, status.running, { kind: 'failure', reason });
  }

  #hold(parameters: Parameters, running: StepPosition<Steps['RUNNING']>, cause: PhaseTransitionCause): void {
    this.#enter({ state: 'HOLDING', parameters, running, active: this.#first('HOLDING') }, cause);
  }

  #enter(status: PhaseStatus<Parameters, Steps>, cause: PhaseTransitionCause): void {
    this.#recorder.record({ kind: 'phase-state-changed', phase: this.name, from: this.#status.state, to: status.state, cause });
    this.#status = status;
  }

  #first<State extends LogicState>(state: State): StepPosition<Steps[State]> {
    return { step: this.definition.logic[state].firstStep, milliseconds: 0 };
  }

  #advance<Step extends string>(position: StepPosition<Step>, next: Step): StepPosition<Step> {
    return next === position.step
      ? { step: next, milliseconds: position.milliseconds + stepMilliseconds }
      : { step: next, milliseconds: 0 };
  }

  #context(unit: UnitT200, parameters: Parameters, milliseconds: number): PhaseContext<Parameters> {
    return {
      unit,
      parameters,
      actor: this.#actor,
      stepMilliseconds: milliseconds,
      runningMilliseconds: this.#runningMilliseconds,
    };
  }

  /** START's parameters must be exactly the defined ones, each a number within its limits. */
  #validParameters(parameters: Readonly<Record<string, number>>): parameters is Readonly<Record<string, number>> & Parameters {
    const definitions: Readonly<Record<string, ParameterDefinition>> = this.definition.parameters;
    const names = Object.keys(definitions);
    return (
      Object.keys(parameters).length === names.length &&
      names.every((name) => {
        const value = parameters[name];
        const definition = definitions[name];
        return value !== undefined && definition !== undefined && value >= definition.minimum && value <= definition.maximum;
      })
    );
  }
}
