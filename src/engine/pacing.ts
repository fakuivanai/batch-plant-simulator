// Turns elapsed wall-clock time into a whole number of fixed steps. The engine
// never reads a clock: whoever runs it (the page, the server) measures the
// time that passed and asks a pacer how many steps that makes.

import { stepMilliseconds } from './time.ts';

export class Pacer {
  /**
   * A call never asks for more steps than this, so a slow machine or a page
   * coming back from the background falls behind instead of freezing.
   */
  readonly #maximumSteps: number;
  #owedMilliseconds = 0;

  constructor(maximumSteps: number) {
    this.#maximumSteps = maximumSteps;
  }

  /** How many steps to run for `elapsedMilliseconds` of wall time at `speed` simulated seconds per second. */
  steps(elapsedMilliseconds: number, speed: number): number {
    this.#owedMilliseconds += elapsedMilliseconds * speed;
    const steps = Math.min(Math.floor(this.#owedMilliseconds / stepMilliseconds), this.#maximumSteps);
    // Falling behind drops the debt rather than trying to catch up later.
    this.#owedMilliseconds = steps === this.#maximumSteps ? 0 : this.#owedMilliseconds - steps * stepMilliseconds;
    return steps;
  }
}
