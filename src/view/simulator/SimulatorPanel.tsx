// The simulator's own panel, outside the control system: what is really in
// the tank, next to what the instruments report, and the faults to inject.
// A real control room has no such panel; the control system only knows what
// its instruments tell it.

import { For, Show, type JSX } from 'solid-js';
import { faultKinds, faults } from '../../engine/process/faults.ts';
import type { SimulatorSnapshot } from '../../engine/simulator.ts';
import { formatClock, formatNumber } from '../format.ts';
import type { Runtime } from './runtime.ts';

export function SimulatorPanel(props: { view: SimulatorSnapshot; runtime: Runtime }): JSX.Element {
  const plant = () => props.view.plant;
  const unit = () => props.view.unit;
  const active = (kind: (typeof faultKinds)[number]) => props.view.activeFaults.includes(kind);
  const toggle = (kind: (typeof faultKinds)[number]) => {
    if (active(kind)) props.runtime.simulator.clearFault(kind);
    else props.runtime.simulator.injectFault(kind);
    props.runtime.refresh();
  };
  return (
    <section class="panel simulator-panel">
      <h2>Simulator</h2>
      <p class="hint">
        Outside the control system. The control system can't see this tab: it only knows what the instruments report.
      </p>
      <h3>The plant as it really is</h3>
      <table class="signals">
        <thead>
          <tr>
            <th />
            <th>Really</th>
            <th>Reported</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Water in the tank</td>
            <td>{formatNumber(plant().volumeLiters, 1)} L</td>
            <td>
              LT-201 {formatNumber(unit()['LT-201'].processValue.value, 1)} L {unit()['LT-201'].processValue.status}
            </td>
          </tr>
          <tr>
            <td>Contents temperature</td>
            <td>{formatNumber(plant().contentsCelsius, 2)} °C</td>
            <td>
              TT-201 {formatNumber(unit()['TIC-201'].processValue.value, 2)} °C {unit()['TIC-201'].processValue.status}
            </td>
          </tr>
          <tr>
            <td>Jacket temperature</td>
            <td>{formatNumber(plant().jacketCelsius, 1)} °C</td>
            <td class="muted">not measured</td>
          </tr>
          <tr>
            <td>Spilled</td>
            <td>{formatNumber(plant().spilledLiters, 1)} L</td>
            <td class="muted">not measured</td>
          </tr>
          <tr>
            <td>XV-201, XV-202, TV-201 open</td>
            <td>
              {formatNumber(plant().inletValvePosition * 100, 0)} %, {formatNumber(plant().outletValvePosition * 100, 0)} %,{' '}
              {formatNumber(plant().heatingValvePosition * 100, 0)} %
            </td>
            <td class="muted">limit switches only</td>
          </tr>
        </tbody>
      </table>
      <h3>Faults</h3>
      <For each={faultKinds}>
        {(kind) => (
          <article class="fault" classList={{ active: active(kind) }}>
            <header>
              <strong>{faults[kind].title}</strong>
              <button type="button" onClick={() => toggle(kind)}>
                {active(kind) ? 'Repair' : 'Inject'}
              </button>
            </header>
            <p>{faults[kind].description}</p>
            <p class="hint">What the control layer does: {faults[kind].controlResponse}</p>
          </article>
        )}
      </For>
      <Show when={props.view.faultLog.length > 0}>
        <h3>Fault log</h3>
        <ul class="fault-log">
          <For each={[...props.view.faultLog].reverse()}>
            {(entry) => (
              <li>
                {formatClock(entry.atMilliseconds)} {faults[entry.fault].title} {entry.action === 'injected' ? 'injected' : 'repaired'}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
