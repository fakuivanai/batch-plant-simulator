import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agitate } from '../../src/engine/procedural-model/phases/agitate.ts';
import { chargeWater } from '../../src/engine/procedural-model/phases/charge-water.ts';
import { heat } from '../../src/engine/procedural-model/phases/heat.ts';
import { transfer } from '../../src/engine/procedural-model/phases/transfer.ts';
import type { ParameterDefinition, PhaseName } from '../../src/engine/procedural-model/phase.ts';
import { bufferPreparation, procedureSteps } from '../../src/engine/procedural-model/recipe.ts';

const phaseParameters: Record<PhaseName, Readonly<Record<string, ParameterDefinition>>> = {
  CHARGE_WATER: chargeWater.parameters,
  AGITATE: agitate.parameters,
  HEAT: heat.parameters,
  TRANSFER: transfer.parameters,
};

test("every formula value a recipe binds to a phase parameter has the parameter's unit and fits within its limits", () => {
  for (const step of procedureSteps(bufferPreparation)) {
    const bindings: Readonly<Record<string, string>> = step.phase.parameters;
    for (const [parameter, formulaName] of Object.entries(bindings)) {
      const target = phaseParameters[step.phase.phase][parameter];
      const source = Object.entries(bufferPreparation.formula).find(([name]) => name === formulaName)?.[1];
      assert.ok(target !== undefined && source !== undefined, `${step.phase.phase}.${parameter}`);
      assert.equal(source.unit, target.unit, `${formulaName} feeds ${step.phase.phase}.${parameter}`);
      assert.ok(source.minimum >= target.minimum && source.maximum <= target.maximum, `${formulaName} within ${step.phase.phase}.${parameter}`);
      assert.ok(source.defaultValue >= source.minimum && source.defaultValue <= source.maximum, `${formulaName} default`);
    }
  }
});
