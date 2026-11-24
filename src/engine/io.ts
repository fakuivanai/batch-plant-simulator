// The I/O image: the signals that pass between the plant and the control
// system, as the wires on a marshalling cabinet would carry them. The control
// layer reaches the plant through these and nothing else, so it sees only what
// a real control system would see. In stage 2 the same image is what outside
// software reads and writes over OPC UA.
//
// Tags follow ISA-5.1: the first letters say what is measured or controlled
// (L level, T temperature, Z position), the next what the instrument does
// (T transmitter, S switch, V valve), and the number is the loop: 201 for
// tank T-200's first loop of each kind.

/** Signals from the field into the control system. */
export interface FieldInputs {
  /** Inlet valve XV-201's limit switches, ZSO-201 (fully open) and ZSC-201 (fully closed). */
  readonly 'XV-201': ValveLimitSwitches;
  /** Outlet valve XV-202's limit switches, ZSO-202 and ZSC-202. */
  readonly 'XV-202': ValveLimitSwitches;
  /** Transfer pump P-201's run feedback, an auxiliary contact on its motor starter. */
  readonly 'P-201': MotorFeedback;
  /** Agitator AG-201's run feedback from its drive. */
  readonly 'AG-201': MotorFeedback;
  /** Level transmitter LT-201, 4 to 20 mA for 0 to 1000 L. */
  readonly 'LT-201': AnalogSignal;
  /** Temperature transmitter TT-201, 4 to 20 mA for 0 to 150 °C. */
  readonly 'TT-201': AnalogSignal;
  /** High-high level switch LSHH-201, a separate instrument from LT-201. */
  readonly 'LSHH-201': FailSafeContact;
}

/** Signals from the control system out to the field. */
export interface FieldOutputs {
  /** XV-201's solenoid. Energized opens the valve; without power or air it closes. */
  readonly 'XV-201': OnOffOutput;
  readonly 'XV-202': OnOffOutput;
  /** P-201's motor starter. */
  readonly 'P-201': OnOffOutput;
  /** AG-201's drive: a run command and a speed reference, 4 to 20 mA for 0 to 300 rpm. */
  readonly 'AG-201': OnOffOutput & { readonly speedReferenceMilliamps: number };
  /** Heating-medium control valve TV-201, 4 mA closed to 20 mA fully open. */
  readonly 'TV-201': AnalogSignal;
}

export interface ValveLimitSwitches {
  readonly openLimitSwitch: boolean;
  readonly closedLimitSwitch: boolean;
}

export interface MotorFeedback {
  readonly running: boolean;
}

export interface OnOffOutput {
  readonly energized: boolean;
}

export interface AnalogSignal {
  readonly milliamps: number;
}

/**
 * A switch wired fail-safe: its contact is closed while everything is normal,
 * and opens on a trip. A broken wire then looks like a trip, never like "all
 * clear".
 */
export interface FailSafeContact {
  readonly contactClosed: boolean;
}

/** The engineering range a 4 to 20 mA signal spans. */
export interface SignalRange {
  readonly lower: number;
  readonly upper: number;
}

const zeroMilliamps = 4;
const spanMilliamps = 16;

export function toMilliamps(value: number, range: SignalRange): number {
  return zeroMilliamps + (spanMilliamps * (value - range.lower)) / (range.upper - range.lower);
}

export function fromMilliamps(milliamps: number, range: SignalRange): number {
  return range.lower + ((milliamps - zeroMilliamps) * (range.upper - range.lower)) / spanMilliamps;
}

/**
 * The signal levels of NAMUR recommendation NE 43, which most process
 * transmitters follow. Between 3.8 and 20.5 mA the signal is a measurement
 * (slightly past 4 or 20 mA means the process is outside the range). At 3.6 mA
 * or below, or 21 mA or above, the transmitter is reporting its own failure.
 */
export const namurNe43 = {
  lowestMeasurementMilliamps: 3.8,
  highestMeasurementMilliamps: 20.5,
  lowFailureMilliamps: 3.6,
  highFailureMilliamps: 21,
} as const;

/**
 * The engineering range each analog signal spans. In a real plant the
 * transmitter and the control system are configured separately and have to
 * agree; here both sides read this one table.
 */
export const signalRanges = {
  /** LT-201 reports the tank's contents in liters. */
  'LT-201': { lower: 0, upper: 1000 },
  /** TT-201 reports the contents' temperature in °C. */
  'TT-201': { lower: 0, upper: 150 },
  /** AG-201's speed reference in rpm. */
  'AG-201': { lower: 0, upper: 300 },
} as const satisfies Record<string, SignalRange>;
