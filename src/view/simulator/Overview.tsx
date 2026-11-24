// The overview of T-200: a piping and instrumentation diagram with live
// values. It follows the high-performance HMI idea of ISA-101: grey by
// default, with colour kept for what needs attention. A filled device symbol
// means open or running, an outline means closed or stopped.

import { Show, type JSX } from 'solid-js';
import { fromMilliamps, signalRanges } from '../../engine/io.ts';
import type { SimulatorSnapshot } from '../../engine/simulator.ts';
import { formatNumber } from '../format.ts';

const tank = { left: 260, right: 420, top: 90, bottom: 330 } as const;
const tankHeight = tank.bottom - tank.top;

type DeviceState = 'on' | 'off' | 'moving';

function Valve(props: { x: number; y: number; state: DeviceState; tag: string; control?: boolean }): JSX.Element {
  const size = 12;
  return (
    <g class={`device ${props.state}`}>
      <path
        d={`M${props.x - size},${props.y - size * 0.7} L${props.x + size},${props.y + size * 0.7} L${props.x + size},${props.y - size * 0.7} L${props.x - size},${props.y + size * 0.7} Z`}
      />
      <line x1={props.x} y1={props.y} x2={props.x} y2={props.y - 16} />
      <Show
        when={props.control}
        fallback={<rect x={props.x - 7} y={props.y - 24} width="14" height="8" />}
      >
        <path d={`M${props.x - 9},${props.y - 16} A9,9 0 0 1 ${props.x + 9},${props.y - 16} Z`} />
      </Show>
      <text x={props.x} y={props.y + 26} class="tag">
        {props.tag}
      </text>
    </g>
  );
}

function Pump(props: { x: number; y: number; state: DeviceState; tag: string }): JSX.Element {
  return (
    <g class={`device ${props.state}`}>
      <circle cx={props.x} cy={props.y} r="16" />
      <path class="mark" d={`M${props.x - 8},${props.y - 10} L${props.x + 12},${props.y} L${props.x - 8},${props.y + 10} Z`} />
      <text x={props.x} y={props.y + 32} class="tag">
        {props.tag}
      </text>
    </g>
  );
}

function Instrument(props: { x: number; y: number; letters: string; loop: string; reading: string; to: number }): JSX.Element {
  return (
    <g class="instrument">
      <line x1={props.to} y1={props.y} x2={props.x - (props.x > props.to ? 18 : -18)} y2={props.y} class="signal" />
      <circle cx={props.x} cy={props.y} r="18" />
      <line x1={props.x - 18} y1={props.y} x2={props.x + 18} y2={props.y} />
      <text x={props.x} y={props.y - 4} class="letters">
        {props.letters}
      </text>
      <text x={props.x} y={props.y + 12} class="loop">
        {props.loop}
      </text>
      <text x={props.x + (props.x > props.to ? 26 : -26)} y={props.y + 4} class={`reading ${props.x > props.to ? 'start' : 'end'}`}>
        {props.reading}
      </text>
    </g>
  );
}

function valveState(openLimitSwitch: boolean, closedLimitSwitch: boolean): DeviceState {
  if (openLimitSwitch) return 'on';
  if (closedLimitSwitch) return 'off';
  return 'moving';
}

export function Overview(props: { view: SimulatorSnapshot }): JSX.Element {
  const level = () => fromMilliamps(props.view.inputs['LT-201'].milliamps, signalRanges['LT-201']);
  const temperature = () => fromMilliamps(props.view.inputs['TT-201'].milliamps, signalRanges['TT-201']);
  const levelFraction = () => Math.min(1, Math.max(0, level() / signalRanges['LT-201'].upper));
  const heatingOpening = () => (props.view.outputs['TV-201'].milliamps - 4) / 16;
  const highHighY = tank.bottom - 0.9 * tankHeight;
  return (
    <svg class="overview" viewBox="0 0 720 440" role="img" aria-label="Piping and instrumentation diagram of tank T-200">
      <defs>
        <clipPath id="tank-inside">
          <rect x={tank.left} y={tank.top} width={tank.right - tank.left} height={tankHeight} rx="14" />
        </clipPath>
      </defs>

      {/* Water supply into the top of the tank through XV-201. */}
      <path class="pipe" d={`M30,60 L300,60 L300,${tank.top}`} />
      <text x="30" y="50" class="label start">
        Water supply
      </text>
      <Valve
        x={150}
        y={60}
        tag="XV-201"
        state={valveState(props.view.inputs['XV-201'].openLimitSwitch, props.view.inputs['XV-201'].closedLimitSwitch)}
      />

      {/* Heating medium through TV-201 into the jacket and back out. */}
      <path class="pipe" d="M30,290 L248,290" />
      <path class="pipe" d="M432,200 L470,200 L470,160 L700,160" />
      <text x="30" y="280" class="label start">
        Heating medium
      </text>
      <text x="700" y="150" class="label end">
        Return
      </text>
      <Valve x={150} y={290} tag="TV-201" control state={heatingOpening() > 0 ? 'on' : 'off'} />
      <text x="150" y="330" class="reading">
        {formatNumber(heatingOpening() * 100, 0)} %
      </text>

      {/* The tank, its jacket and its contents. */}
      <path
        class="jacket"
        d={`M${tank.left - 12},180 L${tank.left - 12},${tank.bottom - 2} Q${tank.left - 12},${tank.bottom + 12} ${tank.left + 2},${tank.bottom + 12} L${tank.right - 2},${tank.bottom + 12} Q${tank.right + 12},${tank.bottom + 12} ${tank.right + 12},${tank.bottom - 2} L${tank.right + 12},180`}
      />
      <g clip-path="url(#tank-inside)">
        <rect
          class="contents"
          x={tank.left}
          width={tank.right - tank.left}
          y={tank.bottom - levelFraction() * tankHeight}
          height={levelFraction() * tankHeight}
        />
      </g>
      <rect class="vessel" x={tank.left} y={tank.top} width={tank.right - tank.left} height={tankHeight} rx="14" />
      <text x={(tank.left + tank.right) / 2} y={tank.top + 40} class="tag large">
        T-200
      </text>

      {/* Agitator AG-201 on the tank's top. */}
      <g class={`device ${props.view.inputs['AG-201'].running ? 'on' : 'off'}`}>
        <rect x="335" y="44" width="30" height="26" rx="3" />
        <text x="350" y="62" class="mark-text">
          M
        </text>
      </g>
      <line class="shaft" x1="350" y1="70" x2="350" y2="300" />
      <path class="shaft" d="M326,300 L374,300 M326,294 L326,306 M374,294 L374,306" />
      <text x="378" y="40" class="tag start">
        AG-201
      </text>
      <text x="378" y="56" class="reading start">
        {formatNumber(props.view.plant.agitatorSpeedRpm, 0)} rpm
      </text>

      {/* Outlet through XV-202 and transfer pump P-201. */}
      <path class="pipe" d={`M340,${tank.bottom} L340,390 L700,390`} />
      <text x="700" y="380" class="label end">
        To next unit
      </text>
      <Valve
        x={470}
        y={390}
        tag="XV-202"
        state={valveState(props.view.inputs['XV-202'].openLimitSwitch, props.view.inputs['XV-202'].closedLimitSwitch)}
      />
      <Pump x={590} y={390} tag="P-201" state={props.view.inputs['P-201'].running ? 'on' : 'off'} />

      {/* Instruments. */}
      <Instrument x={500} y={240} letters="LT" loop="201" to={tank.right} reading={`${formatNumber(level(), 1)} L`} />
      <Instrument
        x={500}
        y={highHighY}
        letters="LSHH"
        loop="201"
        to={tank.right}
        reading={props.view.inputs['LSHH-201'].contactClosed ? 'normal' : 'TRIPPED'}
      />
      <Instrument x={200} y={230} letters="TT" loop="201" to={tank.left} reading={`${formatNumber(temperature(), 1)} °C`} />
    </svg>
  );
}
