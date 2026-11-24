// What the model leaves out or simplifies, so nobody mistakes a teaching
// choice for how a real plant or control system behaves.

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { plantParameters } from '../../engine/process/plant.ts';
import { stepMilliseconds } from '../../engine/time.ts';
import { pageFile } from '../pages.ts';

function Limitations(): JSX.Element {
  return (
    <main class="document">
      <p>
        <a href={pageFile('simulator')}>Back to the simulator</a> · <a href={pageFile('documentation')}>How it works</a>
      </p>
      <h1>Limitations of the model</h1>
      <p>
        The simulator is built to explain batch control, not to predict a real plant. Its numbers are plausible for a small
        tank, chosen so a batch takes under an hour of simulated time, and taken from no particular plant.
      </p>

      <h2>The plant</h2>
      <ul>
        <li>
          The tank and the jacket are each one well-mixed volume, integrated by explicit Euler steps of {stepMilliseconds} ms.
          Every time constant is seconds to hours, far longer than the step.
        </li>
        <li>
          Heat transfer doesn't depend on the agitator or on how much of the jacket is covered. The vessel's own heat capacity
          is lumped into the contents.
        </li>
        <li>
          There is no cooling. An overshoot fades only through the tank's losses to the room, over hours, which is why the
          heater overshoot fault ends the batch's progress until the contents cool.
        </li>
        <li>
          LT-201 reports the volume in liters directly. A real level transmitter measures a height or a pressure, and the
          volume comes from the tank's dimensions.
        </li>
        <li>
          Flows are linear in the valve opening, and TV-201 moves to its position at once. The on/off valves take{' '}
          {plantParameters.valveStrokeSeconds} s to stroke. The pump gives a fixed flow and runs the tank to empty without
          losing suction.
        </li>
        <li>Noise is a seeded Gaussian on the two transmitters. Nothing else in the plant is random.</li>
      </ul>

      <h2>The control system</h2>
      <ul>
        <li>
          Control modules have four modes. Real function blocks have more, such as initialization manual (IMAN), local
          override (LO) and remote cascade (RCAS), and a phase there often writes setpoints and outputs directly instead of
          through modes.
        </li>
        <li>
          The PID loop has no derivative term, no setpoint ramp and no output rate limit. It was tuned on the model, not with a
          tuning method on a real response.
        </li>
        <li>
          Interlocks and alarms have no deadband or delay, and alarms can't be shelved or suppressed. The high-high temperature
          trip uses TT-201, the same sensor as control; a real plant would give it its own sensor.
        </li>
        <li>Discrete devices don't detect a change nobody commanded until it outlasts their feedback timeout.</li>
      </ul>

      <h2>The batch side</h2>
      <ul>
        <li>
          One unit, one recipe, one batch at a time. A batch takes all the unit's phases when it starts; there is no
          arbitration between batches or units.
        </li>
        <li>
          The procedure runs its phases one after another. Operations and unit procedures have no states of their own, and
          there are no parallel branches, transitions on conditions or manual instructions for the operator.
        </li>
        <li>
          Pausing a batch waits at the next boundary between phases. The standard leaves where a procedure may pause to the
          recipe; real systems vary.
        </li>
        <li>A batch runs once and is never reset. Batches and the journal live only as long as the page is open.</li>
        <li>
          The audit trail records an operator's name as typed, with no sign-in, no electronic signature and no second person
          to verify. A real electronic batch record under 21 CFR Part 11 or EU GMP Annex 11 needs all of those.
        </li>
      </ul>
    </main>
  );
}

const root = document.getElementById('app');
if (root === null) throw new Error('The page template has no #app element.');
render(() => <Limitations />, root);
