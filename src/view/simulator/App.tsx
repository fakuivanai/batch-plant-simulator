import type { JSX } from 'solid-js';
import { formatClock } from '../format.ts';
import { IoPanel } from './IoPanel.tsx';
import { Overview } from './Overview.tsx';
import { speeds, type Runtime } from './runtime.ts';

export function App(props: { runtime: Runtime }): JSX.Element {
  const runtime = props.runtime;
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
            {speeds.map((speed) => (
              <option value={speed}>{speed}×</option>
            ))}
          </select>
        </label>
      </header>
      <main class="workspace">
        <Overview view={runtime.view} />
        <IoPanel
          view={runtime.view}
          force={(changes) => {
            runtime.simulator.forceOutputs(changes);
            runtime.refresh();
          }}
        />
      </main>
    </div>
  );
}
