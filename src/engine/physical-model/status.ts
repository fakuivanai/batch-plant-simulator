// Every measured value carries a status that says how far it can be trusted.
// Logic that uses a value checks its status first: a BAD temperature must not
// drive a heater. The three levels match the quality of an OPC UA value.

import { namurNe43 } from '../io.ts';

export type Status =
  /** The value is a measurement and can be used. */
  | 'GOOD'
  /** The value may be off, for example a transmitter saturated past its range. */
  | 'UNCERTAIN'
  /** The value means nothing: the instrument failed, or its module is out of service. */
  | 'BAD';

export interface MeasuredValue {
  readonly value: number;
  readonly status: Status;
}

/** A 4 to 20 mA signal's status, by the signal levels of NAMUR NE 43. */
export function statusOfSignal(milliamps: number): Status {
  if (milliamps <= namurNe43.lowFailureMilliamps || milliamps >= namurNe43.highFailureMilliamps) return 'BAD';
  if (milliamps < namurNe43.lowestMeasurementMilliamps || milliamps > namurNe43.highestMeasurementMilliamps) {
    return 'UNCERTAIN';
  }
  return 'GOOD';
}
