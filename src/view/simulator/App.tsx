import { createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import { formatClock } from '../format.ts';
import { AlarmBanner } from './AlarmBanner.tsx';
import { BatchPanel } from './BatchPanel.tsx';
import { BatchRecordPanel } from './BatchRecordPanel.tsx';
import { Faceplate, type ModuleTag } from './Faceplates.tsx';
import { IoPanel } from './IoPanel.tsx';
import { JournalPanel } from './JournalPanel.tsx';
import { PhasesPanel } from './PhasesPanel.tsx';
import { SimulatorPanel } from './SimulatorPanel.tsx';
import { createOperatorSession } from './operator-session.ts';
import { Overview } from './Overview.tsx';
import { speeds, type Runtime } from './runtime.ts';

const tabs = ['Faceplate', 'Phases', 'Batch', 'Batch record', 'Journal', 'I/O', 'Simulator'] as const;
type Tab = (typeof tabs)[number];

export function App(props: { runtime: Runtime }): JSX.Element {
  const runtime = props.runtime;
  const session = createOperatorSession(runtime);
  const [selected, setSelected] = createSignal<ModuleTag | null>(null);
  const [tab, setTab] = createSignal<Tab>('Faceplate');
  const select = (tag: ModuleTag) => {
    setSelected(tag);
    setTab('Faceplate');
  };
  return (
    <div class="layout">
      <header class="bar">
        <h1>T-200 batch plant simulator</h1>
        <span class="clock" title="Simulated time since the start">
          {formatClock(runtime.view.timeMilliseconds)}
        </span>
        <button type="button" onClick={() => runtime.setRunning(!runtime.controls.running)}>
          {runtime.controls.running ? 'Pause simulation' : 'Run simulation'}
        </button>
        <label>
          Speed{' '}
          <select
            value={runtime.controls.speed}
            onChange={(event) => {
              const chosen = speeds.find((speed) => String(speed) === event.currentTarget.value);
              if (chosen !== undefined) runtime.setSpeed(chosen);
            }}
          >
            <For each={speeds}>{(speed) => <option value={speed}>{speed}×</option>}</For>
          </select>
        </label>
        <span class="spacer" />
        <label>
          Operator{' '}
          <input type="text" value={session.name()} onInput={(event) => session.setName(event.currentTarget.value)} />
        </label>
      </header>
      <AlarmBanner alarms={runtime.view.alarms} session={session} />
      <Show when={session.refusal()}>{(message) => <p class="refusal">{message()}</p>}</Show>
      <main class="workspace">
        <Overview view={runtime.view} selected={selected()} select={select} />
        <div class="side">
          <nav class="tabs" aria-label="Panels">
            <For each={tabs}>
              {(name) => (
                <button type="button" classList={{ active: tab() === name }} onClick={() => setTab(name)}>
                  {name}
                </button>
              )}
            </For>
          </nav>
          <Switch>
            <Match when={tab() === 'Faceplate'}>
              <Show
                when={selected()}
                fallback={
                  <section class="panel">
                    <p class="hint">Click a valve, the pump, the agitator or an instrument on the diagram to open its faceplate.</p>
                  </section>
                }
              >
                {(tag) => <Faceplate tag={tag()} unit={runtime.view.unit} session={session} />}
              </Show>
            </Match>
            <Match when={tab() === 'Phases'}>
              <PhasesPanel phases={runtime.view.phases} session={session} />
            </Match>
            <Match when={tab() === 'Batch'}>
              <BatchPanel batches={runtime.view.batches} phases={runtime.view.phases} session={session} />
            </Match>
            <Match when={tab() === 'Batch record'}>
              <BatchRecordPanel batches={runtime.view.batches} journal={runtime.view.journal} />
            </Match>
            <Match when={tab() === 'I/O'}>
              <IoPanel view={runtime.view} />
            </Match>
            <Match when={tab() === 'Simulator'}>
              <SimulatorPanel view={runtime.view} runtime={runtime} />
            </Match>
            <Match when={tab() === 'Journal'}>
              <JournalPanel entries={runtime.view.journal} />
            </Match>
          </Switch>
        </div>
      </main>
    </div>
  );
}
