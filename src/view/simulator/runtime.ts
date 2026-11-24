// Turns wall-clock time into fixed steps of the simulation. This is the only
// place that reads the wall clock: the engine only ever sees "advance one step".

import { createStore, reconcile } from 'solid-js/store';
import { Simulator, type SimulatorSnapshot } from '../../engine/simulator.ts';
import { stepMilliseconds } from '../../engine/time.ts';

/** How many simulated seconds pass per wall-clock second. */
export const speeds = [1, 10, 60, 300] as const;
export type Speed = (typeof speeds)[number];

/**
 * A frame never runs more steps than this, so a slow machine or a tab that
 * comes back from the background falls behind instead of freezing.
 */
const maximumStepsPerFrame = 2000;

export interface Runtime {
  readonly simulator: Simulator;
  readonly view: SimulatorSnapshot;
  readonly controls: { readonly running: boolean; readonly speed: Speed };
  setRunning(running: boolean): void;
  setSpeed(speed: Speed): void;
  /** Re-reads the simulator after the user changes something in it. */
  refresh(): void;
}

export function startRuntime(seed: number): Runtime {
  const simulator = new Simulator(seed);
  const [view, setView] = createStore<SimulatorSnapshot>(simulator.snapshot());
  const [controls, setControls] = createStore<{ running: boolean; speed: Speed }>({ running: true, speed: 10 });
  let previousFrame: number | null = null;
  let owedMilliseconds = 0;

  const refresh = () => setView(reconcile(simulator.snapshot()));

  const frame = (now: number) => {
    if (controls.running && previousFrame !== null) {
      owedMilliseconds += (now - previousFrame) * controls.speed;
      const steps = Math.min(Math.floor(owedMilliseconds / stepMilliseconds), maximumStepsPerFrame);
      for (let step = 0; step < steps; step++) simulator.step();
      owedMilliseconds = steps === maximumStepsPerFrame ? 0 : owedMilliseconds - steps * stepMilliseconds;
      if (steps > 0) refresh();
    }
    previousFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    simulator,
    view,
    controls,
    setRunning: (running) => setControls('running', running),
    setSpeed: (speed) => setControls('speed', speed),
    refresh,
  };
}
