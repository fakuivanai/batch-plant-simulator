// The ISA-88 state machine drawn as a diagram. The states come from the
// engine; the layout and the arrows are drawn by hand from the table in
// src/engine/procedural-model/state-machine.ts, so a change there needs a
// change here.

import { For, type JSX } from 'solid-js';
import { proceduralStates, type ProceduralState } from '../engine/procedural-model/state-machine.ts';

const width = 110;
const height = 30;

const positions: Record<ProceduralState, readonly [number, number]> = {
  IDLE: [70, 40],
  RUNNING: [230, 40],
  COMPLETE: [570, 40],
  PAUSING: [230, 110],
  PAUSED: [400, 110],
  HOLDING: [230, 180],
  HELD: [400, 180],
  RESTARTING: [400, 250],
  STOPPING: [230, 330],
  STOPPED: [400, 330],
  ABORTING: [230, 390],
  ABORTED: [400, 390],
};

/** States that run logic of their own (PAUSING runs the RUNNING logic up to a pause point). */
const acting: ReadonlySet<ProceduralState> = new Set(['RUNNING', 'PAUSING', 'HOLDING', 'RESTARTING', 'STOPPING', 'ABORTING']);

/** Arrows as polylines, each with its label and where the label sits. */
const arrows: readonly { readonly points: string; readonly label: string; readonly at: readonly [number, number] }[] = [
  { points: '125,40 175,40', label: 'Start', at: [150, 32] },
  { points: '285,40 515,40', label: 'done', at: [470, 32] },
  { points: '230,55 230,95', label: 'Pause', at: [236, 79] },
  { points: '285,110 345,110', label: 'pause point', at: [289, 102] },
  { points: '175,48 160,48 160,180 175,180', label: 'Hold', at: [130, 120] },
  { points: '285,180 345,180', label: 'done', at: [315, 172] },
  { points: '400,195 400,235', label: 'Restart', at: [406, 219] },
  { points: '455,250 480,250 480,75 270,75 270,55', label: 'done', at: [450, 165] },
  { points: '400,95 400,75', label: 'Resume', at: [406, 89] },
  { points: '230,270 230,315', label: 'Stop', at: [236, 296] },
  { points: '285,330 345,330', label: 'done', at: [315, 322] },
  { points: '230,345 230,375', label: 'Abort', at: [236, 364] },
  { points: '150,250 120,250 120,390 175,390', label: 'Abort', at: [90, 320] },
  { points: '285,390 345,390', label: 'done', at: [315, 382] },
];

export function StateDiagram(props: { current?: readonly ProceduralState[] }): JSX.Element {
  return (
    <svg class="state-diagram" viewBox="0 0 640 430" role="img" aria-label="The ISA-88 state machine of a procedural element">
      <defs>
        <marker id="arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 Z" class="arrowhead" />
        </marker>
      </defs>
      <rect class="frame" x="150" y="18" width="345" height="252" rx="8" />
      <text class="frame-label" x="490" y="264">
        Stop and Abort from any state in this frame
      </text>
      <For each={arrows}>
        {(arrow) => (
          <>
            <polyline class="arrow" points={arrow.points} marker-end="url(#arrowhead)" />
            <text class="arrow-label" x={arrow.at[0]} y={arrow.at[1]}>
              {arrow.label}
            </text>
          </>
        )}
      </For>
      <For each={proceduralStates}>
        {(state) => {
          const [x, y] = positions[state];
          return (
            <g class="state-node" classList={{ acting: acting.has(state), current: props.current?.includes(state) ?? false }}>
              <rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx="6" />
              <text x={x} y={y + 4}>
                {state}
              </text>
            </g>
          );
        }}
      </For>
      <text class="arrow-label" x="470" y="356">
        COMPLETE, STOPPED and ABORTED
      </text>
      <text class="arrow-label" x="470" y="370">
        go back to IDLE on Reset.
      </text>
    </svg>
  );
}
