// The whole simulation: the plant, and whatever drives its outputs. Its owner
// calls `step` to advance one fixed step; nothing here reads the wall clock.

import type { FieldInputs, FieldOutputs } from './io.ts';
import { Plant, type PlantSnapshot } from './process/plant.ts';
import { stepMilliseconds } from './time.ts';

export interface SimulatorSnapshot {
  readonly timeMilliseconds: number;
  readonly plant: PlantSnapshot;
  readonly inputs: FieldInputs;
  readonly outputs: FieldOutputs;
}

export class Simulator {
  readonly #plant: Plant;
  #timeMilliseconds = 0;
  /** With no control system yet, the outputs are whatever the user forces them to. */
  #outputs: FieldOutputs = {
    'XV-201': { energized: false },
    'XV-202': { energized: false },
    'P-201': { energized: false },
    'AG-201': { energized: false, speedReferenceMilliamps: 4 },
    'TV-201': { milliamps: 4 },
  };

  constructor(seed: number) {
    this.#plant = new Plant(seed);
  }

  step(): void {
    this.#plant.step(this.#outputs);
    this.#timeMilliseconds += stepMilliseconds;
  }

  forceOutputs(changes: Partial<FieldOutputs>): void {
    this.#outputs = { ...this.#outputs, ...changes };
  }

  snapshot(): SimulatorSnapshot {
    return {
      timeMilliseconds: this.#timeMilliseconds,
      plant: this.#plant.snapshot,
      inputs: this.#plant.inputs,
      outputs: this.#outputs,
    };
  }
}
