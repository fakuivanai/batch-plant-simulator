// A failed invariant is a programming error, not bad input: the program
// stops at the first one instead of carrying on in a state nobody designed
// for. Outside input is validated where it enters and refused as a value.

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invariant broken: ${message}`);
}
