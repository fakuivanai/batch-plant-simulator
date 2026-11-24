// The faults that can be injected into the plant. Each one lives on the field
// side of the I/O image: the control layer can only notice it through what
// the instruments report, as in a real plant. Each fault has a test that pins
// what the control layer does about it.

export const faultKinds = [
  'inlet-valve-fails-to-open',
  'pump-fails-to-start',
  'level-transmitter-stuck',
  'heating-medium-overheated',
  'temperature-transmitter-failed',
] as const;

export type FaultKind = (typeof faultKinds)[number];

export const faults: Record<FaultKind, { readonly title: string; readonly description: string }> = {
  'inlet-valve-fails-to-open': {
    title: 'XV-201 fails to open',
    description: "The inlet valve's actuator no longer moves it toward open, as with a seized stem or no instrument air. It still closes.",
  },
  'pump-fails-to-start': {
    title: 'P-201 fails to start',
    description: "The transfer pump's motor doesn't start when its starter is energized, as with a tripped overload relay.",
  },
  'level-transmitter-stuck': {
    title: 'LT-201 stuck',
    description:
      'The level transmitter keeps sending the value it had when the fault started, as a GOOD signal. Nothing in the signal shows the fault.',
  },
  'heating-medium-overheated': {
    title: 'Heater overshoot',
    description:
      "The heating medium arrives at 200 °C instead of 90 °C, as when its supply's own temperature control fails. The temperature loop, tuned for 90 °C, overshoots its setpoint.",
  },
  'temperature-transmitter-failed': {
    title: 'TT-201 failed',
    description: 'The temperature transmitter drives its output to 3.5 mA, the NAMUR NE 43 signal for a failed instrument.',
  },
};
