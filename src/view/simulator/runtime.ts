// Where the simulation the page shows runs. Either the page runs it itself,
// turning wall-clock time into fixed steps, or it attaches to a server that
// runs it (see attach.ts). The views only see this interface.

import { createStore, reconcile } from 'solid-js/store';
import { Pacer } from '../../engine/pacing.ts';
import type { FaultKind } from '../../engine/process/faults.ts';
import type { Result } from '../../engine/result.ts';
import { Simulator, type OperatorCommand, type OperatorRefusal, type SimulatorSnapshot } from '../../engine/simulator.ts';

/** How many simulated seconds pass per wall-clock second, when the page runs the simulation. */
export const speeds = [1, 10, 60, 300] as const;
export type Speed = (typeof speeds)[number];

/** At most this many steps per frame: 200 s of simulated time, enough for 300× at 60 frames per second. */
const maximumStepsPerFrame = 2000;

export type Clock =
  /** The page runs the simulation and owns its clock. */
  | {
      readonly kind: 'local';
      readonly running: boolean;
      readonly speed: Speed;
      readonly setRunning: (running: boolean) => void;
      readonly setSpeed: (speed: Speed) => void;
    }
  /** A server runs the simulation; the page shows it. */
  | { readonly kind: 'server'; readonly speed: number; readonly connected: boolean };

export interface Runtime {
  readonly view: SimulatorSnapshot;
  readonly clock: Clock;
  operate(operatorName: string, command: OperatorCommand, reason: string | undefined): Promise<Result<OperatorRefusal>>;
  setFault(fault: FaultKind, active: boolean): Promise<void>;
}

export function startLocalRuntime(seed: number): Runtime {
  const simulator = new Simulator(seed);
  const [view, setView] = createStore<SimulatorSnapshot>(simulator.snapshot());
  const [controls, setControls] = createStore<{ running: boolean; speed: Speed }>({ running: true, speed: 10 });
  const pacer = new Pacer(maximumStepsPerFrame);
  let previousFrame: number | null = null;

  const refresh = () => setView(reconcile(simulator.snapshot()));

  const frame = (now: number) => {
    if (controls.running && previousFrame !== null) {
      const steps = pacer.steps(now - previousFrame, controls.speed);
      for (let step = 0; step < steps; step++) simulator.step();
      if (steps > 0) refresh();
    }
    previousFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    view,
    clock: {
      kind: 'local',
      get running() {
        return controls.running;
      },
      get speed() {
        return controls.speed;
      },
      setRunning: (running) => setControls('running', running),
      setSpeed: (speed) => setControls('speed', speed),
    },
    operate: async (operatorName, command, reason) => {
      const result = simulator.operate(operatorName, command, reason);
      refresh();
      return result;
    },
    setFault: async (fault, active) => {
      if (active) simulator.injectFault(fault);
      else simulator.clearFault(fault);
      refresh();
    },
  };
}
