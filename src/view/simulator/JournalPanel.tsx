// The journal: the audit trail of every change, newest first.

import { createSignal, For, type JSX } from 'solid-js';
import type { JournalEntry } from '../../engine/record/journal.ts';
import { describeActor, describeEvent, eventActor } from '../describe.ts';
import { formatClock } from '../format.ts';

export function JournalTable(props: { entries: readonly JournalEntry[] }): JSX.Element {
  return (
    <table class="journal">
      <thead>
        <tr>
          <th>Time</th>
          <th>What</th>
          <th>Who</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.entries}>
          {(entry) => {
            const actor = eventActor(entry.event);
            return (
              <tr>
                <td class="time">{formatClock(entry.atMilliseconds)}</td>
                <td>{describeEvent(entry.event)}</td>
                <td>{actor === null ? 'system' : describeActor(actor)}</td>
                <td>{entry.reason ?? ''}</td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  );
}

export function JournalPanel(props: { entries: readonly JournalEntry[] }): JSX.Element {
  const [operatorOnly, setOperatorOnly] = createSignal(false);
  const shown = () =>
    [...props.entries].reverse().filter((entry) => !operatorOnly() || eventActor(entry.event)?.kind === 'operator');
  return (
    <section class="panel">
      <h2>Journal</h2>
      <p class="hint">Every change to the control system: who made it, what changed, when, and why.</p>
      <label>
        <input type="checkbox" checked={operatorOnly()} onChange={(event) => setOperatorOnly(event.currentTarget.checked)} /> Operator
        actions only
      </label>
      <JournalTable entries={shown()} />
    </section>
  );
}
