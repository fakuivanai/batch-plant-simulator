import type { FieldOutputs } from '../../src/engine/io.ts';

/** Every output de-energized and every analog output at 4 mA: the plant's resting state. */
export const restingOutputs: FieldOutputs = {
  'XV-201': { energized: false },
  'XV-202': { energized: false },
  'P-201': { energized: false },
  'AG-201': { energized: false, speedReferenceMilliamps: 4 },
  'TV-201': { milliamps: 4 },
};

export function outputsWith(changes: Partial<FieldOutputs>): FieldOutputs {
  return { ...restingOutputs, ...changes };
}
