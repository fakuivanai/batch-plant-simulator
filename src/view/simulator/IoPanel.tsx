// The I/O image as the control system sees it: raw field signals, before any
// control module has interpreted them, and the outputs the modules drive.

import type { JSX } from 'solid-js';
import type { SimulatorSnapshot } from '../../engine/simulator.ts';
import { formatNumber } from '../format.ts';

function Bit(props: { value: boolean }): JSX.Element {
  return <span class={props.value ? 'signal-on' : 'signal-off'}>{props.value ? '1' : '0'}</span>;
}

function Current(props: { milliamps: number }): JSX.Element {
  return <>{formatNumber(props.milliamps, 2)} mA</>;
}

export function IoPanel(props: { view: SimulatorSnapshot }): JSX.Element {
  const inputs = () => props.view.inputs;
  const outputs = () => props.view.outputs;
  return (
    <section class="panel">
      <h2>Field inputs</h2>
      <p class="hint">What the wires from the plant carry. The control modules turn these into states and values.</p>
      <table class="signals">
        <tbody>
          <tr><th>ZSO-201</th><td>XV-201 open limit switch</td><td><Bit value={inputs()['XV-201'].openLimitSwitch} /></td></tr>
          <tr><th>ZSC-201</th><td>XV-201 closed limit switch</td><td><Bit value={inputs()['XV-201'].closedLimitSwitch} /></td></tr>
          <tr><th>ZSO-202</th><td>XV-202 open limit switch</td><td><Bit value={inputs()['XV-202'].openLimitSwitch} /></td></tr>
          <tr><th>ZSC-202</th><td>XV-202 closed limit switch</td><td><Bit value={inputs()['XV-202'].closedLimitSwitch} /></td></tr>
          <tr><th>P-201</th><td>Pump run feedback</td><td><Bit value={inputs()['P-201'].running} /></td></tr>
          <tr><th>AG-201</th><td>Agitator run feedback</td><td><Bit value={inputs()['AG-201'].running} /></td></tr>
          <tr><th>LSHH-201</th><td>High-high level contact closed</td><td><Bit value={inputs()['LSHH-201'].contactClosed} /></td></tr>
          <tr><th>LT-201</th><td>Level, 4 to 20 mA for 0 to 1000 L</td><td><Current milliamps={inputs()['LT-201'].milliamps} /></td></tr>
          <tr><th>TT-201</th><td>Temperature, 4 to 20 mA for 0 to 150 °C</td><td><Current milliamps={inputs()['TT-201'].milliamps} /></td></tr>
        </tbody>
      </table>
      <h2>Field outputs</h2>
      <p class="hint">What the control system drives out to the plant.</p>
      <table class="signals">
        <tbody>
          <tr><th>XV-201</th><td>Inlet valve solenoid</td><td><Bit value={outputs()['XV-201'].energized} /></td></tr>
          <tr><th>XV-202</th><td>Outlet valve solenoid</td><td><Bit value={outputs()['XV-202'].energized} /></td></tr>
          <tr><th>P-201</th><td>Pump motor starter</td><td><Bit value={outputs()['P-201'].energized} /></td></tr>
          <tr><th>AG-201</th><td>Agitator drive run command</td><td><Bit value={outputs()['AG-201'].energized} /></td></tr>
          <tr><th>AG-201</th><td>Speed reference, 4 to 20 mA for 0 to 300 rpm</td><td><Current milliamps={outputs()['AG-201'].speedReferenceMilliamps} /></td></tr>
          <tr><th>TV-201</th><td>Heating valve, 4 mA closed to 20 mA open</td><td><Current milliamps={outputs()['TV-201'].milliamps} /></td></tr>
        </tbody>
      </table>
    </section>
  );
}
