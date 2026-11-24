// Operations that can be refused return their refusal as a value, so the
// caller has to look at it. Each operation lists only the refusals it can
// actually produce.

export type Result<Error extends string> = { readonly ok: true } | { readonly ok: false; readonly error: Error };

export const accepted = { ok: true } as const;

export function refused<Error extends string>(error: Error): Result<Error> {
  return { ok: false, error };
}
