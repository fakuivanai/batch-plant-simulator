// Simulated time. The model never reads the wall clock: it advances by a fixed
// step whenever its owner calls it, so a test can replay a batch exactly. Time
// is counted in whole milliseconds, which add up without rounding drift.

/** The length of one step. Every part of the model advances by this much at a time. */
export const stepMilliseconds = 100;

/** The same step in seconds, for the physics. */
export const stepSeconds = stepMilliseconds / 1000;

export const millisecondsPerSecond = 1000;
export const millisecondsPerMinute = 60 * millisecondsPerSecond;

/** The number of steps that make up a stretch of simulated time. */
export function stepsIn(milliseconds: number): number {
  return Math.round(milliseconds / stepMilliseconds);
}
