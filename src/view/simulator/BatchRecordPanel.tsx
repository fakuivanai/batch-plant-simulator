// The batch record: everything recorded while a batch was active, from its
// creation to its end. In a regulated plant this electronic batch record is
// what quality reviews before the lot is released, which is why every entry
// says who did what, when, from what to what, and why.

import { createSignal, For, Show, type JSX } from 'solid-js';
import type { BatchSnapshot } from '../../engine/procedural-model/batch.ts';
import type { JournalEntry } from '../../engine/record/journal.ts';
import { formatClock, formatNumber } from '../format.ts';
import { JournalTable } from './JournalPanel.tsx';
import { stateClass } from './PhasesPanel.tsx';

/** Hands the viewer the record as a JSON file. */
function download(batch: BatchSnapshot, entries: readonly JournalEntry[]): void {
  const json = JSON.stringify({ batch, entries }, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `batch-record-${batch.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function BatchRecordPanel(props: { batches: readonly BatchSnapshot[]; journal: readonly JournalEntry[] }): JSX.Element {
  const [chosen, setChosen] = createSignal<string | null>(null);
  const batch = () => props.batches.find((candidate) => candidate.id === chosen()) ?? props.batches.at(-1) ?? null;
  const entries = (id: string) => props.journal.filter((entry) => entry.batchId === id);
  return (
    <section class="panel">
      <h2>Batch record</h2>
      <Show when={batch()} fallback={<p class="hint">No batch yet. Create one on the Batch tab.</p>}>
        {(shown) => (
          <>
            <label>
              Batch{' '}
              <select value={shown().id} onChange={(event) => setChosen(event.currentTarget.value)}>
                <For each={props.batches}>{(candidate) => <option value={candidate.id}>{candidate.id}</option>}</For>
              </select>
            </label>{' '}
            <button type="button" onClick={() => download(shown(), entries(shown().id))}>
              Download as JSON
            </button>
            <dl class="readout">
              <dt>Batch</dt>
              <dd>
                {shown().id} <span class={`state ${stateClass(shown().state)}`}>{shown().state}</span>
              </dd>
              <dt>Recipe</dt>
              <dd>
                {shown().recipe.id} version {shown().recipe.version}, {shown().recipe.product}
              </dd>
              <dt>Created</dt>
              <dd>{formatClock(shown().createdAtMilliseconds)}</dd>
              <dt>Started</dt>
              <dd>{shown().startedAtMilliseconds === null ? '-' : formatClock(shown().startedAtMilliseconds ?? 0)}</dd>
              <dt>Ended</dt>
              <dd>{shown().endedAtMilliseconds === null ? '-' : formatClock(shown().endedAtMilliseconds ?? 0)}</dd>
              <dt>Formula</dt>
              <dd>
                {shown()
                  .formula.map((value) => `${value.description} ${formatNumber(value.value, 1)} ${value.unit}`)
                  .join(', ')}
              </dd>
            </dl>
            <JournalTable entries={entries(shown().id)} />
          </>
        )}
      </Show>
    </section>
  );
}
