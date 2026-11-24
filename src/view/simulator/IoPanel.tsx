// The I/O image as the control system sees it: raw field signals, before any
// control module has interpreted them. Until there is a control layer, the
// outputs here are forced by hand.

import type { JSX } from 'solid-js';
import { fromMilliamps, signalRanges } from '../../engine/io.ts';
import type { FieldOutputs } from '../../engine/io.ts';
import type { SimulatorSnapshot } from '../../engine/simulator.ts';
import { formatNumber } from '../format.ts';

function OnOff(props: { value: boolean }): JSX.Element {
  return <span class={props.value ? 'signal-on' : 'signal-off'}>{props.value ? '1' : '0'}</span>;
}

export function IoPanel(props: { view: SimulatorSnapshot; force: (changes: Partial<FieldOutputs>) => void }): JSX.Element {
  const inputs = () => props.view.inputs;
  const outputs = () => props.view.outputs;
  const milliamps = (value: number) => `${formatNumber(value, 2)} mA`;
  return (
    <section class="panel">
      <h2>Field inputs</h2>
      <table class="signals">
        <tbody>
          <tr><th>ZSO-201</th><td>XV-201 open limit switch</td><td><OnOff value={inputs()['XV-201'].openLimitSwitch} /></td></tr>
          <tr><th>ZSC-201</th><td>XV-201 closed limit switch</td><td><OnOff value={inputs()['XV-201'].closedLimitSwitch} /></td></tr>
          <tr><th>ZSO-202</th><td>XV-202 open limit switch</td><td><OnOff value={inputs()['XV-202'].openLimitSwitch} /></td></tr>
          <tr><th>ZSC-202</th><td>XV-202 closed limit switch</td><td><OnOff value={inputs()['XV-202'].closedLimitSwitch} /></td></tr>
          <tr><th>P-201</th><td>Pump run feedback</td><td><OnOff value={inputs()['P-201'].running} /></td></tr>
          <tr><th>AG-201</th><td>Agitator run feedback</td><td><OnOff value={inputs()['AG-201'].running} /></td></tr>
          <tr><th>LSHH-201</th><td>High-high level contact closed</td><td><OnOff value={inputs()['LSHH-201'].contactClosed} /></td></tr>
          <tr><th>LT-201</th><td>Level</td><td>{milliamps(inputs()['LT-201'].milliamps)}</td></tr>
          <tr><th>TT-201</th><td>Temperature</td><td>{milliamps(inputs()['TT-201'].milliamps)}</td></tr>
        </tbody>
      </table>

      <h2>Field outputs</h2>
      <p class="hint">No control system drives the plant yet, so these are forced by hand.</p>
      <table class="signals">
        <tbody>
          {(['XV-201', 'XV-202', 'P-201'] as const).map((tag) => (
            <tr>
              <th>{tag}</th>
              <td>{tag.startsWith('XV') ? 'Solenoid' : 'Motor starter'}</td>
              <td>
                <input
                  type="checkbox"
                  checked={outputs()[tag].energized}
                  onChange={(event) => props.force({ [tag]: { energized: event.currentTarget.checked } })}
                />
              </td>
            </tr>
          ))}
          <tr>
            <th>AG-201</th>
            <td>Drive run command</td>
            <td>
              <input
                type="checkbox"
                checked={outputs()['AG-201'].energized}
                onChange={(event) =>
                  props.force({ 'AG-201': { ...outputs()['AG-201'], energized: event.currentTarget.checked } })
                }
              />
            </td>
          </tr>
          <tr>
            <th>AG-201</th>
            <td>
              Speed reference, {formatNumber(fromMilliamps(outputs()['AG-201'].speedReferenceMilliamps, signalRanges['AG-201']), 0)} rpm
            </td>
            <td>
              <input
                type="range" min="4" max="20" step="0.1"
                value={outputs()['AG-201'].speedReferenceMilliamps}
                onInput={(event) =>
                  props.force({ 'AG-201': { ...outputs()['AG-201'], speedReferenceMilliamps: Number(event.currentTarget.value) } })
                }
              />
            </td>
          </tr>
          <tr>
            <th>TV-201</th>
            <td>Heating valve, {milliamps(outputs()['TV-201'].milliamps)}</td>
            <td>
              <input
                type="range" min="4" max="20" step="0.1"
                value={outputs()['TV-201'].milliamps}
                onInput={(event) => props.force({ 'TV-201': { milliamps: Number(event.currentTarget.value) } })}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
