// Measurement noise from a seeded generator. The same seed gives the same
// noise, so a run replays exactly.
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';

export class NoiseSource {
  readonly #generator;

  constructor(seed: number) {
    this.#generator = xoroshiro128plus(seed);
  }

  /** A normally distributed sample with mean zero, by the Box-Muller transform. */
  gaussian(standardDeviation: number): number {
    // 1 - u keeps the logarithm's argument in (0, 1].
    const radius = Math.sqrt(-2 * Math.log(1 - uniformFloat64(this.#generator)));
    const angle = 2 * Math.PI * uniformFloat64(this.#generator);
    return standardDeviation * radius * Math.cos(angle);
  }
}
