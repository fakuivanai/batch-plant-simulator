// How the simulator works: the concepts, in the order the code builds them,
// with exercises to try on the simulator. The tables of states, steps, faults
// and formula values are read from the engine, so they can't drift from it.

import { For, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { signalRanges } from '../../engine/io.ts';
import { highHighTemperatureCelsius, minimumLevelLiters } from '../../engine/physical-model/interlocks.ts';
import { faultKinds, faults } from '../../engine/process/faults.ts';
import type { PhaseDefinition, PhaseSteps } from '../../engine/procedural-model/phase.ts';
import { agitate } from '../../engine/procedural-model/phases/agitate.ts';
import { chargeWater } from '../../engine/procedural-model/phases/charge-water.ts';
import { heat } from '../../engine/procedural-model/phases/heat.ts';
import { transfer } from '../../engine/procedural-model/phases/transfer.ts';
import { bufferPreparation } from '../../engine/procedural-model/recipe.ts';
import { logicStates } from '../../engine/procedural-model/state-machine.ts';
import { stepMilliseconds } from '../../engine/time.ts';
import { commandNumbers, stateNumbers } from '../../server/phase-interface.ts';
import { pageFile } from '../pages.ts';
import { StateDiagram } from '../StateDiagram.tsx';
import { StateTable } from '../simulator/PhasesPanel.tsx';

function PhaseSteps<Parameters extends Record<string, number>, Steps extends PhaseSteps>(props: {
  phase: PhaseDefinition<Parameters, Steps>;
}): JSX.Element {
  const pausePoints: readonly string[] = props.phase.pausePoints;
  return (
    <>
      <h4>{props.phase.name}</h4>
      <p>{props.phase.description}</p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>State</th>
            <th>Steps, in order</th>
          </tr>
        </thead>
        <tbody>
          <For each={logicStates}>
            {(state) => (
              <tr>
                <th>{state}</th>
                <td>
                  {Object.keys(props.phase.logic[state].steps)
                    .map((step) => (state === 'RUNNING' && pausePoints.includes(step) ? `${step} (pause point)` : step))
                    .join(' → ')}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </>
  );
}

function Documentation(): JSX.Element {
  return (
    <main class="document">
      <p>
        <a href={pageFile('simulator')}>Back to the simulator</a> · <a href={pageFile('limitations')}>Limitations of the model</a>
      </p>
      <h1>How the batch plant simulator works</h1>
      <p>
        This simulator is a first contact with batch control as ISA-88 (IEC 61512) describes it. It has one jacketed tank,
        T-200, a control system that runs it, and a recipe that makes batches of a buffer. Each part below is a layer of
        the simulator, from the physics up to the batch record, and each ends with something to try.
      </p>

      <h2 id="layers">The layers</h2>
      <ol>
        <li>
          <strong>The plant</strong>: water, heat, valves and motors, as physics. It knows nothing about control.
        </li>
        <li>
          <strong>The I/O image</strong>: the signals on the wires between the plant and the control system. Limit switches,
          run feedback, 4 to 20 mA currents. The control system sees the plant only through these.
        </li>
        <li>
          <strong>Basic control</strong>: control modules, one per device or loop, which turn signals into states and values,
          and requests into outputs.
        </li>
        <li>
          <strong>Equipment control</strong>: an equipment module that coordinates a few control modules.
        </li>
        <li>
          <strong>Procedural control</strong>: phases, which carry out one processing step each, and the batch, which runs
          the recipe's procedure by running phases.
        </li>
        <li>
          <strong>Records</strong>: the alarm list and the journal, the audit trail that every change goes into.
        </li>
      </ol>
      <p>
        Time is simulated: every part advances by a fixed step of {stepMilliseconds} ms whenever the page asks it to, never
        by the wall clock. The speed menu only changes how many steps run per second. That is also why the same commands
        at the same simulated times always produce the same result, which the tests rely on.
      </p>

      <h2 id="plant">The plant and its tags</h2>
      <p>
        The overview is a piping and instrumentation diagram (P&amp;ID). Every instrument and device has a tag after
        ISA-5.1: the first letter is what is measured or controlled (L level, T temperature, Z position), the next ones what
        the instrument does (T transmitter, S switch, V valve, I indicating, C controller), and the number is the loop.
      </p>
      <table class="doc-table">
        <tbody>
          <tr><th>XV-201</th><td>Water inlet valve, on/off, with limit switches ZSO-201 (open) and ZSC-201 (closed)</td></tr>
          <tr><th>XV-202</th><td>Outlet valve, on/off, with limit switches ZSO-202 and ZSC-202</td></tr>
          <tr><th>P-201</th><td>Transfer pump, with run feedback from its motor starter</td></tr>
          <tr><th>AG-201</th><td>Agitator on a variable-speed drive, 0 to {signalRanges['AG-201'].upper} rpm</td></tr>
          <tr><th>LT-201</th><td>Level transmitter, 0 to {signalRanges['LT-201'].upper} L</td></tr>
          <tr><th>LSHH-201</th><td>High-high level switch, a separate instrument from LT-201</td></tr>
          <tr><th>TT-201</th><td>Temperature transmitter, 0 to {signalRanges['TT-201'].upper} °C</td></tr>
          <tr><th>TV-201</th><td>Heating-medium control valve on the jacket</td></tr>
          <tr><th>TIC-201</th><td>The temperature control loop: reads TT-201, drives TV-201</td></tr>
        </tbody>
      </table>
      <p>
        The overview follows the high-performance HMI idea of ISA-101: grey when all is normal, colour only for what needs
        attention. A filled symbol is open or running; an outline is closed or stopped.
      </p>
      <p class="try">
        <strong>Try it.</strong> Open the I/O tab and watch the raw signals: a valve's two limit switches, and the transmitters
        as currents in mA. Everything the control system knows comes from that list.
      </p>

      <h2 id="control-modules">Control modules</h2>
      <h3>Modes</h3>
      <p>A control module's mode says who may drive it.</p>
      <ul>
        <li><strong>OOS</strong>, out of service: taken out of operation for maintenance. Outputs go safe, measurements read BAD.</li>
        <li><strong>MAN</strong>, manual: the operator drives the output.</li>
        <li><strong>AUTO</strong>, automatic: the module computes its output from a setpoint the operator sets.</li>
        <li><strong>CAS</strong>, cascade: like automatic, but the setpoint comes from the control program, here a phase.</li>
      </ul>
      <p>
        These modes come from function-block practice (IEC 61804 and the fieldbus function blocks), which control systems use
        for their modules; ISA-88 itself only gives equipment an automatic and a manual mode. An on/off valve has nothing to
        compute between setpoint and output, so here it has no AUTO: the operator drives it in MAN, a phase in CAS.
      </p>
      <p>
        The mode someone asks for is the <em>target</em> mode. The mode the module is in is the <em>actual</em> mode, and the
        two can differ: when TT-201 goes BAD, TIC-201 can't control, so it <em>sheds</em> to MAN with the valve closed, and
        returns to its target mode once the measurement is good again.
      </p>
      <h3>Value status</h3>
      <p>
        Every measured value carries a status: GOOD, UNCERTAIN or BAD. Logic checks the status before it uses a value. A
        transmitter's status comes from its signal level, by NAMUR recommendation NE 43: 3.8 to 20.5 mA is a measurement,
        3.6 mA or below and 21 mA or above mean the transmitter itself has failed.
      </p>
      <h3>Discrete devices and their feedback</h3>
      <p>
        A valve or a motor is told to be active (open, running) or passive (closed, stopped), and its feedback says whether
        it did. If the feedback still disagrees after a timeout (10 s for a valve, 3 s for a motor), the device has
        failed: it raises an alarm, goes passive and stays failed until someone resets it on its faceplate.
      </p>
      <h3>The PID loop</h3>
      <p>
        TIC-201 compares TT-201 with its setpoint and opens TV-201 as much as needed. It uses the proportional and integral
        terms. Switching it from MAN to AUTO doesn't move the valve (a bumpless transfer), and while the valve is pinned fully
        open the integral term stops growing (anti-windup), so the temperature doesn't overshoot by the time it takes to
        unwind.
      </p>
      <h3>Interlocks and alarms</h3>
      <p>
        Interlocks protect the equipment whatever anyone asks for. They hold a device in its safe state in every mode, and
        they also drop its request, so it doesn't start again on its own once the interlock clears.
      </p>
      <ul>
        <li>LSHH-201 tripped closes XV-201, before the tank overflows.</li>
        <li>XV-202 not confirmed open stops P-201, which would otherwise pump against a closed valve.</li>
        <li>Level below {minimumLevelLiters} L stops AG-201 and closes TV-201: the impeller and the jacket need to be covered.</li>
        <li>TT-201 at {highHighTemperatureCelsius} °C or above closes TV-201.</li>
      </ul>
      <p>
        An interlock that depends on a measurement also trips when it can't trust that measurement: a BAD level stops the
        agitator. Alarms follow ISA-18.2: an alarm stays on the list until it has both cleared and been acknowledged, and one
        cause raises one alarm. When LSHH-201 trips, only LSHH-201 alarms, not every device it stops.
      </p>
      <p class="try">
        <strong>Try it.</strong> Click AG-201, put it in MAN and press Start with the tank empty: the interlock refuses. Then
        click XV-201, put it in MAN, open it, and watch the level rise and LT-201's faceplate follow.
      </p>

      <h2 id="physical-model">The ISA-88 physical model</h2>
      <p>
        ISA-88 arranges equipment in levels: enterprise, site, area, process cell, unit, equipment module, control module. The
        simulator has one unit and what is in it.
      </p>
      <ul>
        <li>
          <strong>Unit T-200</strong>: equipment that carries out major processing activities on one batch at a time.
          <ul>
            <li>
              <strong>Equipment module Transfer</strong>: XV-202 and P-201 working as one. It opens the valve before it starts
              the pump, and stops the pump before it closes the valve. A phase only says start or stop.
            </li>
            <li>
              <strong>Control modules</strong>: XV-201, AG-201, LT-201, LSHH-201 and TIC-201 directly in the unit, XV-202 and
              P-201 inside the equipment module.
            </li>
          </ul>
        </li>
      </ul>

      <h2 id="phases">Phases and their state machine</h2>
      <p>
        A phase is the smallest step the equipment knows how to do: charge water, agitate, heat, transfer. Every phase runs
        the same state machine. Shaded states run logic of their own; the others wait for a command.
      </p>
      <StateDiagram />
      <ul>
        <li><strong>Start</strong> begins the phase; <strong>Reset</strong> takes a finished one back to IDLE.</li>
        <li><strong>Pause</strong> asks it to stop at its next pause point and wait; <strong>Resume</strong> continues.</li>
        <li>
          <strong>Hold</strong> brings the equipment to a safe pause it can resume from; <strong>Restart</strong> resumes it.
        </li>
        <li><strong>Stop</strong> ends it in an orderly way. <strong>Abort</strong> gets it safe as fast as possible.</li>
      </ul>
      <p>The same machine as a table, which is how the code holds it:</p>
      <StateTable />
      <p>
        Each state's logic is a sequence of named steps, like the steps of a sequential function chart (SFC). Each scan the
        active step runs once and says which step comes next. The steps of the four phases:
      </p>
      <PhaseSteps phase={chargeWater} />
      <PhaseSteps phase={agitate} />
      <PhaseSteps phase={heat} />
      <PhaseSteps phase={transfer} />
      <p>
        Next to the logic runs the <em>failure monitor</em>. While a phase works toward its goal it checks the equipment each
        scan: a device that failed, left cascade or got interlocked, or a measurement that isn't GOOD, holds the phase, and the
        reason goes into the journal.
      </p>
      <p class="try">
        <strong>Try it.</strong> With water in the tank, start AGITATE from the Phases tab. Pause it during MIX: the agitator
        keeps running but the mixing clock stops. Then hold it, and restart it. Put AG-201 in MAN while it runs, and see the
        failure monitor hold the phase.
      </p>

      <h2 id="recipe">Recipes and batches</h2>
      <p>
        ISA-88's central idea is to keep <em>what to make</em>, the recipe, apart from <em>how the equipment does it</em>, the
        phases. The master recipe {bufferPreparation.id} version {bufferPreparation.version} makes {bufferPreparation.product}.
        Its formula lists the values a batch can vary:
      </p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>Formula value</th>
            <th>Default</th>
            <th>Limits</th>
          </tr>
        </thead>
        <tbody>
          <For each={Object.values(bufferPreparation.formula)}>
            {(value) => (
              <tr>
                <td>{value.description}</td>
                <td>
                  {value.defaultValue} {value.unit}
                </td>
                <td>
                  {value.minimum} to {value.maximum} {value.unit}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p>
        Its procedure is the ISA-88 procedural tree: the procedure ({bufferPreparation.procedure.name}) is made of unit
        procedures (the work in one unit), made of operations (major steps: charge, mix, heat, discharge), made of phases.
        Creating a batch copies the master recipe into a control recipe with that batch's formula values.
      </p>
      <p>
        The batch's procedure runs the same state machine as a phase. It starts each phase with its parameters, waits for it,
        resets it and goes on. Commands to the batch go down to the active phase, and a phase that holds on a failure holds the
        batch. While a batch runs it owns the phases: the operator commands the batch. Pausing a batch lets the running phase
        finish and waits before the next one.
      </p>
      <p class="try">
        <strong>Try it.</strong> On the Batch tab, create a batch with the defaults and start it, at 60× or 300× speed. Watch the
        procedure tree. Hold the batch during HEAT and see HEAT hold; restart it.
      </p>

      <h2 id="record">The batch record and the audit trail</h2>
      <p>
        Every change to the control system goes into the journal: who made it, what changed from what to what, when (in
        simulated time) and, for an operator's change, why. Some changes need a reason: formula values off the recipe's
        defaults, formula changes, stopping or aborting a batch. The batch record is the part of the journal written while the
        batch was active.
      </p>
      <p>
        In a regulated plant this electronic batch record is what quality reviews before a lot is released, and the rules for
        it, such as US 21 CFR Part 11 and EU GMP Annex 11, ask for exactly this: attributable, time-stamped, unchangeable
        entries. The simulator only records an operator's name, without signing in or electronic signatures.
      </p>
      <p class="try">
        <strong>Try it.</strong> After a batch, open the Batch record tab. Every phase state change is there with its cause,
        and every formula value with its old and new value. Download it as JSON.
      </p>


      <h2 id="opc-ua">Connecting other software over OPC UA</h2>
      <p>
        OPC UA is the common language control systems, batch systems and HMIs use to read and write each other's values. A
        server publishes a tree of named values, the <em>address space</em>; a client browses the tree, reads values,
        subscribes to changes and writes where it is allowed. Every value comes with a status code and a timestamp.
      </p>
      <p>
        <code>pnpm serve</code> runs the simulation on your machine, in real time, and publishes unit T-200 as an OPC UA server
        at <code>opc.tcp://localhost:4840</code>. It also serves these pages at <code>http://localhost:8080/</code>, where the
        simulator page shows the server's simulation, so you can watch and operate the plant while other software drives it.
        The server listens only on this machine, with no encryption and no sign-in.
      </p>
      <h3>The address space</h3>
      <p>
        The tree follows the ISA-88 physical model: <code>T-200</code>, then <code>IO</code> (the raw signals),{' '}
        <code>ControlModules</code>, <code>EquipmentModules</code>, <code>Phases</code> and <code>Batch</code>. Node ids are
        the path, for example <code>ns=1;s=T-200.ControlModules.LT-201.PV</code>. A measured value carries its status as its
        OPC UA status code: GOOD is <code>Good</code>, UNCERTAIN is <code>Uncertain</code>, and BAD is{' '}
        <code>BadSensorFailure</code> for a failed instrument or <code>BadOutOfService</code> for a module out of service.
      </p>
      <h3>A batch engine driving the phases</h3>
      <p>
        A batch engine in other software can run its own recipes on this plant's phases, the way a batch system drives phase
        logic in a controller. First the operator hands each phase to it, with the button on the Phases tab; until then the
        phase refuses its commands. Then, for each phase, the engine:
      </p>
      <ol>
        <li>
          writes the parameters under <code>Parameters</code>;
        </li>
        <li>
          writes a command number to <code>Command</code>, and reads the state from <code>State</code> and{' '}
          <code>StateNumber</code>;
        </li>
        <li>
          writes a new value to <code>Watchdog</code> about once a second, which the phase echoes on <code>WatchdogEcho</code>.
        </li>
      </ol>
      <p>
        A refused command comes back as a Bad status code on the write, with the reason in <code>CommandResult</code>. If the
        watchdog stops changing for 10 s while the phase works, the phase holds: the engine has lost contact, and nobody would
        be in charge. The numbers are the ones batch engines commonly use for this kind of interface; ISA-88 names the
        commands and states but doesn't number them.
      </p>
      <div class="number-tables">
        <table class="doc-table">
          <thead>
            <tr>
              <th>Command</th>
              <th>Number</th>
            </tr>
          </thead>
          <tbody>
            <For each={Object.entries(commandNumbers)}>
              {([command, number]) => (
                <tr>
                  <td>{command}</td>
                  <td>{number}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <table class="doc-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Number</th>
            </tr>
          </thead>
          <tbody>
            <For each={Object.entries(stateNumbers)}>
              {([state, number]) => (
                <tr>
                  <td>{state}</td>
                  <td>{number}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <p class="try">
        <strong>Try it.</strong> Run <code>pnpm serve</code>, open <code>http://localhost:8080/</code> and hand CHARGE_WATER to
        the batch engine. With any OPC UA client, write 300 to <code>Parameters.targetVolumeLiters</code> and 1 (START) to{' '}
        <code>Command</code>. The page shows the phase running and the journal shows who started it. Stop writing the watchdog
        and watch the phase hold 10 s later.
      </p>

      <h2 id="faults">Faults</h2>
      <p>
        The Simulator tab sits outside the control system: it shows the plant as it really is next to what the instruments
        report, and injects faults. A fault lives on the plant's side of the I/O image, so the control system can only notice
        it the way a real one would. Each fault has a test that pins what the control layer does about it.
      </p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>Fault</th>
            <th>What it does</th>
            <th>What the control layer does</th>
          </tr>
        </thead>
        <tbody>
          <For each={faultKinds}>
            {(kind) => (
              <tr>
                <th>{faults[kind].title}</th>
                <td>{faults[kind].description}</td>
                <td>{faults[kind].controlResponse}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p class="try">
        <strong>Try it.</strong> Start a batch and make LT-201 stick while it charges. The level keeps rising while LT-201 reads
        the same value with a GOOD status: nothing in the signal shows the fault. This is why LSHH-201 is a separate instrument.
      </p>
    </main>
  );
}

const root = document.getElementById('app');
if (root === null) throw new Error('The page template has no #app element.');
render(() => <Documentation />, root);
