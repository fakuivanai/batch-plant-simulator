import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromMilliamps, namurNe43, signalRanges } from '../../src/engine/io.ts';
import { Plant, plantParameters } from '../../src/engine/process/plant.ts';
import { millisecondsPerMinute, millisecondsPerSecond, stepSeconds, stepsIn } from '../../src/engine/time.ts';
import { outputsWith, restingOutputs } from '../support/field-outputs.ts';
import type { FieldOutputs } from '../../src/engine/io.ts';

function run(plant: Plant, outputs: FieldOutputs, milliseconds: number, eachStep?: () => void): void {
  for (let step = 0; step < stepsIn(milliseconds); step++) {
    plant.step(outputs);
    eachStep?.();
  }
}

const inletOpen = outputsWith({ 'XV-201': { energized: true } });

test('water is conserved: what is in the tank and what spilled equal what came in minus what went out', () => {
  const plant = new Plant(1);
  let inLiters = 0;
  let outLiters = 0;
  const account = () => {
    inLiters += plant.snapshot.inflowLitersPerSecond * stepSeconds;
    outLiters += plant.snapshot.outflowLitersPerSecond * stepSeconds;
  };
  run(plant, inletOpen, 12 * millisecondsPerMinute, account);
  assert.ok(plant.snapshot.spilledLiters > 0, 'the scenario overfills the tank');
  const transfer = outputsWith({ 'XV-202': { energized: true }, 'P-201': { energized: true } });
  run(plant, transfer, 8 * millisecondsPerMinute, account);
  assert.equal(plant.snapshot.volumeLiters, 0, 'the scenario empties the tank');
  const { volumeLiters, spilledLiters } = plant.snapshot;
  assert.ok(Math.abs(volumeLiters + spilledLiters - (inLiters - outLiters)) < 1e-6);
});

test('with the heating valve fully open, the contents settle at the steady state of the energy balance', () => {
  const plant = new Plant(1);
  run(plant, inletOpen, 5 * millisecondsPerMinute);
  run(plant, outputsWith({ 'TV-201': { milliamps: 20 } }), 6 * 60 * millisecondsPerMinute);
  const p = plantParameters;
  // At steady state the medium gives the jacket what the jacket gives the
  // contents, and the contents lose exactly that to the room.
  const medium = (p.heatingMediumMaximumFlowLitersPerMinute / 60) * 4186;
  const ratio = medium / p.jacketToContentsWattsPerKelvin + 1;
  const loss = p.contentsToAmbientWattsPerKelvin;
  const expected = (medium * p.heatingMediumSupplyCelsius + loss * p.ambientCelsius * ratio) / (medium + loss * ratio);
  assert.ok(Math.abs(plant.snapshot.contentsCelsius - expected) < 0.01, `${plant.snapshot.contentsCelsius} vs ${expected}`);
});

test('LT-201 and TT-201 report the contents on 4 to 20 mA, saturating at the edges of the NE 43 measurement band', () => {
  const plant = new Plant(1);
  for (let step = 0; step < 100; step++) {
    plant.step(restingOutputs);
    assert.ok(plant.inputs['LT-201'].milliamps >= namurNe43.lowestMeasurementMilliamps, 'an empty tank reads at or above 3.8 mA');
  }
  run(plant, inletOpen, 3 * millisecondsPerMinute);
  run(plant, restingOutputs, 2 * millisecondsPerMinute);
  const level = fromMilliamps(plant.inputs['LT-201'].milliamps, signalRanges['LT-201']);
  const temperature = fromMilliamps(plant.inputs['TT-201'].milliamps, signalRanges['TT-201']);
  assert.ok(Math.abs(level - plant.snapshot.volumeLiters) < 4 * plantParameters.levelNoiseLiters);
  assert.ok(Math.abs(temperature - plant.snapshot.contentsCelsius) < 0.5);
});

test('an on/off valve reports a limit switch only at the end of its stroke', () => {
  const plant = new Plant(1);
  const stroke = plantParameters.valveStrokeSeconds * millisecondsPerSecond;
  assert.deepEqual(plant.inputs['XV-201'], { openLimitSwitch: false, closedLimitSwitch: true });
  run(plant, inletOpen, stroke / 2);
  assert.deepEqual(plant.inputs['XV-201'], { openLimitSwitch: false, closedLimitSwitch: false });
  run(plant, inletOpen, stroke / 2);
  assert.deepEqual(plant.inputs['XV-201'], { openLimitSwitch: true, closedLimitSwitch: false });
  run(plant, restingOutputs, stroke);
  assert.deepEqual(plant.inputs['XV-201'], { openLimitSwitch: false, closedLimitSwitch: true });
});

test("a motor's run feedback follows its starter after the contact delay", () => {
  const plant = new Plant(1);
  const delay = plantParameters.motorFeedbackDelayMilliseconds;
  const pumpOn = outputsWith({ 'P-201': { energized: true } });
  run(plant, pumpOn, delay - 100);
  assert.equal(plant.inputs['P-201'].running, false);
  run(plant, pumpOn, 100);
  assert.equal(plant.inputs['P-201'].running, true);
  run(plant, restingOutputs, delay);
  assert.equal(plant.inputs['P-201'].running, false);
});

test('LSHH-201 opens its contact at the high-high level and not before', () => {
  const plant = new Plant(1);
  while (plant.snapshot.volumeLiters < plantParameters.highHighSwitchLiters) {
    assert.equal(plant.inputs['LSHH-201'].contactClosed, true);
    plant.step(inletOpen);
  }
  assert.equal(plant.inputs['LSHH-201'].contactClosed, false);
});

test('the same seed and the same outputs replay the same field inputs', () => {
  const script: [FieldOutputs, number][] = [
    [inletOpen, 5 * millisecondsPerMinute],
    [outputsWith({ 'TV-201': { milliamps: 14 }, 'AG-201': { energized: true, speedReferenceMilliamps: 12 } }), 10 * millisecondsPerMinute],
    [outputsWith({ 'XV-202': { energized: true }, 'P-201': { energized: true } }), 5 * millisecondsPerMinute],
  ];
  const first = new Plant(7);
  const second = new Plant(7);
  for (const [outputs, milliseconds] of script) {
    for (let step = 0; step < stepsIn(milliseconds); step++) {
      first.step(outputs);
      second.step(outputs);
      assert.deepStrictEqual(first.inputs, second.inputs);
    }
  }
});
