// Who did something. Every change to the control system is made by an actor,
// and the audit trail records which one.

export type Actor =
  /** A person at the operator station. */
  | { readonly kind: 'operator'; readonly name: string }
  /** Control logic: a phase, an equipment module or a batch. */
  | { readonly kind: 'program'; readonly name: string };

export function operator(name: string): Actor {
  return { kind: 'operator', name };
}

export function program(name: string): Actor {
  return { kind: 'program', name };
}
