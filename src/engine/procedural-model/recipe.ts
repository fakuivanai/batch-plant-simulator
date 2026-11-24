// The recipe: what to make, kept apart from how the equipment does it. That
// separation is ISA-88's core idea: the phases above know how to charge,
// agitate, heat and transfer; the recipe says in which order, and with which
// values.
//
// A master recipe is the approved template for a product. Its formula lists
// the values a batch can vary, with defaults and limits. Its procedure is the
// ISA-88 procedural tree: a procedure, made of unit procedures (the work in
// one unit), made of operations (major steps), made of phases. Running the
// master recipe for one batch makes a control recipe: a copy with that
// batch's formula values.

import type { AgitateParameters } from './phases/agitate.ts';
import type { ChargeWaterParameters } from './phases/charge-water.ts';
import type { HeatParameters } from './phases/heat.ts';
import type { TransferParameters } from './phases/transfer.ts';

export interface FormulaParameter {
  readonly description: string;
  readonly unit: string;
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
}

/** Each phase's parameter names, so a recipe can only bind parameters the phase takes. */
interface PhaseParameterNames {
  readonly CHARGE_WATER: keyof ChargeWaterParameters;
  readonly AGITATE: keyof AgitateParameters;
  readonly HEAT: keyof HeatParameters;
  readonly TRANSFER: keyof TransferParameters;
}

/**
 * A phase in the recipe: which equipment phase to run, and which formula
 * value feeds each of its parameters. Every parameter must be bound.
 */
export type RecipePhase<FormulaName extends string> = {
  readonly [Name in keyof PhaseParameterNames]: {
    readonly phase: Name;
    readonly parameters: { readonly [Parameter in PhaseParameterNames[Name]]: FormulaName };
  };
}[keyof PhaseParameterNames];

export interface Operation<FormulaName extends string> {
  readonly name: string;
  readonly phases: readonly RecipePhase<FormulaName>[];
}

export interface UnitProcedure<FormulaName extends string> {
  readonly name: string;
  readonly unit: 'T-200';
  readonly operations: readonly Operation<FormulaName>[];
}

export interface MasterRecipe<FormulaName extends string> {
  readonly id: string;
  readonly version: number;
  readonly product: string;
  readonly formula: { readonly [Name in FormulaName]: FormulaParameter };
  readonly procedure: {
    readonly name: string;
    readonly unitProcedures: readonly UnitProcedure<FormulaName>[];
  };
}

type BufferFormula = 'waterVolume' | 'agitatorSpeed' | 'mixTime' | 'temperature' | 'soakTime';

/** The one product this plant makes: a buffer, prepared in T-200 and sent on. */
export const bufferPreparation: MasterRecipe<BufferFormula> = {
  id: 'BUFFER-A',
  version: 1,
  product: 'Buffer A',
  formula: {
    waterVolume: { description: 'Water', unit: 'L', defaultValue: 500, minimum: 200, maximum: 800 },
    agitatorSpeed: { description: 'Agitator speed', unit: 'rpm', defaultValue: 200, minimum: 100, maximum: 300 },
    mixTime: { description: 'Mixing time', unit: 'min', defaultValue: 15, minimum: 1, maximum: 30 },
    temperature: { description: 'Temperature', unit: '°C', defaultValue: 37, minimum: 25, maximum: 50 },
    soakTime: { description: 'Soak time', unit: 'min', defaultValue: 10, minimum: 0, maximum: 30 },
  },
  procedure: {
    name: 'Make buffer A',
    unitProcedures: [
      {
        name: 'Prepare in T-200',
        unit: 'T-200',
        operations: [
          { name: 'Charge', phases: [{ phase: 'CHARGE_WATER', parameters: { targetVolumeLiters: 'waterVolume' } }] },
          { name: 'Mix', phases: [{ phase: 'AGITATE', parameters: { speedRpm: 'agitatorSpeed', durationMinutes: 'mixTime' } }] },
          { name: 'Heat', phases: [{ phase: 'HEAT', parameters: { setpointCelsius: 'temperature', soakMinutes: 'soakTime' } }] },
          { name: 'Discharge', phases: [{ phase: 'TRANSFER', parameters: {} }] },
        ],
      },
    ],
  },
};

/** One phase of the procedure, with where it sits in the tree. Phases run one after another. */
export interface ProcedureStep<FormulaName extends string> {
  readonly unitProcedure: string;
  readonly operation: string;
  readonly phase: RecipePhase<FormulaName>;
}

export function procedureSteps<FormulaName extends string>(recipe: MasterRecipe<FormulaName>): readonly ProcedureStep<FormulaName>[] {
  return recipe.procedure.unitProcedures.flatMap((unitProcedure) =>
    unitProcedure.operations.flatMap((operation) =>
      operation.phases.map((phase) => ({ unitProcedure: unitProcedure.name, operation: operation.name, phase })),
    ),
  );
}

/** The formula values a phase step's parameters take. */
export function boundParameters<FormulaName extends string>(
  phase: RecipePhase<FormulaName>,
  formula: Readonly<Record<FormulaName, number>>,
): Readonly<Record<string, number>> {
  const bindings: Readonly<Record<string, FormulaName>> = phase.parameters;
  return Object.fromEntries(Object.entries(bindings).map(([parameter, formulaName]) => [parameter, formula[formulaName]]));
}
