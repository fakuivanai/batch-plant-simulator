// Simulated time. The model never reads the wall clock: it advances by a fixed
// step whenever its owner calls it, so a test can replay a batch exactly.

/** The length of one step of the simulation. Every part of the model advances by this much at a time. */
export const stepMilliseconds = 100;
