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

/** What a fault does in the plant, and what the control layer does about it (the tests pin the latter). */
export interface FaultDescription {
  readonly title: string;
  readonly description: string;
  readonly controlResponse: string;
}

export const faults: Record<FaultKind, FaultDescription> = {
  'inlet-valve-fails-to-open': {
    title: 'XV-201 fails to open',
    description: "The inlet valve's actuator no longer moves it toward open, as with a seized stem or no instrument air. It still closes.",
    controlResponse:
      'XV-201 gets no open feedback within 10 s and fails with an alarm. CHARGE_WATER holds, and the batch with it. Repair, reset the failure on the faceplate, then restart.',
  },
  'pump-fails-to-start': {
    title: 'P-201 fails to start',
    description: "The transfer pump's motor doesn't start when its starter is energized, as with a tripped overload relay.",
    controlResponse:
      'P-201 gets no run feedback within 3 s and fails with an alarm. The transfer module stops and closes XV-202, and TRANSFER holds. Repair, reset the failure, then restart.',
  },
  'level-transmitter-stuck': {
    title: 'LT-201 stuck',
    description:
      'The level transmitter keeps sending the value it had when the fault started, as a GOOD signal. Nothing in the signal shows the fault.',
    controlResponse:
      'Nothing sees the fault directly. CHARGE_WATER holds when the charge takes too long, or LSHH-201, a separate switch, trips its interlock and closes XV-201 before the tank overflows.',
  },
  'heating-medium-overheated': {
    title: 'Heater overshoot',
    description:
      "The heating medium arrives at 200 °C instead of 90 °C, as when its supply's own temperature control fails. The temperature loop, tuned for 90 °C, overshoots its setpoint.",
    controlResponse:
      'The temperature overshoots past the high deviation limit. TIC-201 alarms, HEAT holds and closes TV-201. The tank has no cooling, so it can only restart once the contents have cooled back within the limit.',
  },
  'temperature-transmitter-failed': {
    title: 'TT-201 failed',
    description: 'The temperature transmitter drives its output to 3.5 mA, the NAMUR NE 43 signal for a failed instrument.',
    controlResponse:
      'TT-201 reads BAD. TIC-201 sheds to manual with TV-201 closed, the heating interlock trips, and HEAT holds. A restart holds again until the transmitter is repaired.',
  },
};
