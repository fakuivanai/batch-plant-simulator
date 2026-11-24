// Interlocks protect the equipment and the product whatever anyone asks for.
// While an interlock is active it holds its device in the safe state, in
// manual as in cascade. It is not an alarm: the condition that trips it
// raises the alarm, once.
//
// Each interlock trips on its condition or on a measurement it can't trust,
// so a failed transmitter stops the heating instead of letting it run blind.

/** The interlocks of unit T-200, named by what trips them. */
export type InterlockId =
  /** Closes XV-201: the tank is about to overflow. */
  | 'LSHH-201 high-high level'
  /** Stops P-201: pumping against a closed valve would overheat the pump. */
  | 'XV-202 not open'
  /** Stops AG-201 and closes TV-201: the impeller and the jacket need to be covered. */
  | 'Level below minimum'
  /** Closes TV-201: the contents are too hot. */
  | 'TT-201 high-high temperature';

/**
 * The level that covers the impeller and the bottom of the jacket. Below it
 * an agitator would splash or run dry, and the jacket would heat a bare wall.
 */
export const minimumLevelLiters = 100;

/**
 * The temperature at which heating trips: well above any setpoint the recipe
 * allows (50 °C), below where the contents would be damaged. In a real plant
 * this trip would use its own sensor, as LSHH-201 does for level, so that one
 * failed transmitter can't disable both control and protection.
 */
export const highHighTemperatureCelsius = 60;
