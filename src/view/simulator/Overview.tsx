// The overview of T-200: a piping and instrumentation diagram with live
// values. It follows the high-performance HMI idea of ISA-101: grey by
// default, with colour kept for what needs attention. A filled device symbol
// means open or running, an outline means closed or stopped. Click a device
// or an instrument to open its faceplate.

import { Show, type JSX } from 'solid-js';
import type { Feedback } from '../../engine/physical-model/control-modules/discrete-device.ts';
import type { MeasuredValue } from '../../engine/physical-model/status.ts';
import type { SimulatorSnapshot } from '../../engine/simulator.ts';
import { formatNumber } from '../format.ts';
import type { ModuleTag } from './Faceplates.tsx';

const tank = { left: 260, right: 420, top: 90, bottom: 330 } as const;
const tankHeight = tank.bottom - tank.top;

type DeviceState = 'on' | 'off' | 'moving';

function deviceState(feedback: Feedback): DeviceState {
  switch (feedback) {
    case 'ACTIVE':
      return 'on';
    case 'PASSIVE':
      return 'off';
    case 'TRAVELLING':
    case 'CONFLICTING':
      return 'moving';
  }
}

interface Selectable {
  readonly selected: ModuleTag | null;
  readonly select: (tag: ModuleTag) => void;
  readonly alarmed: (tag: string) => boolean;
}

function selectableClasses(tag: ModuleTag, selection: Selectable): Record<string, boolean> {
  return { clickable: true, selected: selection.selected === tag, alarmed: selection.alarmed(tag) };
}

function Valve(props: {
  x: number;
  y: number;
  state: DeviceState;
  tag: string;
  module: ModuleTag;
  selection: Selectable;
  control?: boolean;
}): JSX.Element {
  const size = 12;
  return (
    <g
      class={`device ${props.state}`}
      classList={selectableClasses(props.module, props.selection)}
      onClick={() => props.selection.select(props.module)}
    >
      <title>{props.tag}</title>
      <rect class="hit" x={props.x - 20} y={props.y - 28} width="40" height="62" />
      <path
        d={`M${props.x - size},${props.y - size * 0.7} L${props.x + size},${props.y + size * 0.7} L${props.x + size},${props.y - size * 0.7} L${props.x - size},${props.y + size * 0.7} Z`}
      />
      <line x1={props.x} y1={props.y} x2={props.x} y2={props.y - 16} />
      <Show when={props.control} fallback={<rect x={props.x - 7} y={props.y - 24} width="14" height="8" />}>
        <path d={`M${props.x - 9},${props.y - 16} A9,9 0 0 1 ${props.x + 9},${props.y - 16} Z`} />
      </Show>
      <text x={props.x} y={props.y + 26} class="tag">
        {props.tag}
      </text>
    </g>
  );
}

function Pump(props: { x: number; y: number; state: DeviceState; selection: Selectable }): JSX.Element {
  return (
    <g
      class={`device ${props.state}`}
      classList={selectableClasses('P-201', props.selection)}
      onClick={() => props.selection.select('P-201')}
    >
      <title>P-201</title>
      <circle cx={props.x} cy={props.y} r="16" />
      <path class="mark" d={`M${props.x - 8},${props.y - 10} L${props.x + 12},${props.y} L${props.x - 8},${props.y + 10} Z`} />
      <text x={props.x} y={props.y + 32} class="tag">
        P-201
      </text>
    </g>
  );
}

function Instrument(props: {
  x: number;
  y: number;
  letters: string;
  module: ModuleTag;
  selection: Selectable;
  alarmTag: string;
  children: JSX.Element;
  readingSide: 'left' | 'right';
}): JSX.Element {
  return (
    <g
      class="instrument"
      classList={{ ...selectableClasses(props.module, props.selection), alarmed: props.selection.alarmed(props.alarmTag) }}
      onClick={() => props.selection.select(props.module)}
    >
      <circle cx={props.x} cy={props.y} r="18" />
      <line x1={props.x - 18} y1={props.y} x2={props.x + 18} y2={props.y} />
      <text x={props.x} y={props.y - 4} class="letters">
        {props.letters}
      </text>
      <text x={props.x} y={props.y + 12} class="loop">
        201
      </text>
      <text
        x={props.x + (props.readingSide === 'right' ? 26 : -26)}
        y={props.y + 4}
        class={`reading ${props.readingSide === 'right' ? 'start' : 'end'}`}
      >
        {props.children}
      </text>
    </g>
  );
}

function Reading(props: { value: MeasuredValue; unit: string; decimals: number }): JSX.Element {
  return (
    <Show when={props.value.status !== 'BAD'} fallback={<tspan class="status-bad">BAD</tspan>}>
      <tspan class={props.value.status === 'UNCERTAIN' ? 'status-uncertain' : ''}>
        {formatNumber(props.value.value, props.decimals)} {props.unit}
      </tspan>
    </Show>
  );
}

export function Overview(props: {
  view: SimulatorSnapshot;
  selected: ModuleTag | null;
  select: (tag: ModuleTag) => void;
}): JSX.Element {
  const unit = () => props.view.unit;
  const selection: Selectable = {
    get selected() {
      return props.selected;
    },
    select: (tag) => props.select(tag),
    alarmed: (tag) => props.view.alarms.some((alarm) => alarm.module === tag && !alarm.acknowledged),
  };
  const levelFraction = () => {
    const level = unit()['LT-201'];
    return Math.min(1, Math.max(0, (level.processValue.value - level.range.lower) / (level.range.upper - level.range.lower)));
  };
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
      <Valve x={150} y={60} tag="XV-201" module="XV-201" selection={selection} state={deviceState(unit()['XV-201'].feedback)} />

      {/* Heating medium through TV-201 into the jacket and back out. */}
      <path class="pipe" d="M30,310 L248,310" />
      <path class="pipe" d="M432,200 L470,200 L470,160 L700,160" />
      <text x="30" y="300" class="label start">
        Heating medium
      </text>
      <text x="700" y="150" class="label end">
        Return
      </text>
      <Valve
        x={150}
        y={310}
        tag="TV-201"
        module="TIC-201"
        selection={selection}
        control
        state={unit()['TIC-201'].outputPercent > 0 ? 'on' : 'off'}
      />
      <text x="150" y="352" class="reading">
        {formatNumber(unit()['TIC-201'].outputPercent, 0)} %
      </text>

      {/* The tank, its jacket and its contents (as LT-201 reports them). */}
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
      <g
        class={`device ${deviceState(unit()['AG-201'].feedback)}`}
        classList={selectableClasses('AG-201', selection)}
        onClick={() => selection.select('AG-201')}
      >
        <title>AG-201</title>
        <rect x="335" y="44" width="30" height="26" rx="3" />
        <text x="350" y="62" class="mark-text">
          M
        </text>
        <text x="378" y="40" class="tag start">
          AG-201
        </text>
        <text x="378" y="56" class="reading start">
          {formatNumber(props.view.plant.agitatorSpeedRpm, 0)} rpm
        </text>
      </g>
      <line class="shaft" x1="350" y1="70" x2="350" y2="300" />
      <path class="shaft" d="M326,300 L374,300 M326,294 L326,306 M374,294 L374,306" />

      {/* Outlet through XV-202 and transfer pump P-201. */}
      <path class="pipe" d={`M340,${tank.bottom} L340,390 L700,390`} />
      <text x="700" y="380" class="label end">
        To next unit
      </text>
      <Valve x={470} y={390} tag="XV-202" module="XV-202" selection={selection} state={deviceState(unit()['XV-202'].feedback)} />
      <Pump x={590} y={390} selection={selection} state={deviceState(unit()['P-201'].feedback)} />

      {/* Instruments, with their signal lines dashed. */}
      <line class="signal" x1={tank.right} y1={240} x2={482} y2={240} />
      <Instrument x={500} y={240} letters="LT" module="LT-201" alarmTag="LT-201" selection={selection} readingSide="right">
        <Reading value={unit()['LT-201'].processValue} unit="L" decimals={1} />
      </Instrument>
      <line class="signal" x1={tank.right} y1={highHighY} x2={482} y2={highHighY} />
      <Instrument x={500} y={highHighY} letters="LSHH" module="LSHH-201" alarmTag="LSHH-201" selection={selection} readingSide="right">
        {unit()['LSHH-201'].tripped ? 'TRIPPED' : 'normal'}
      </Instrument>
      <line class="signal" x1={tank.left - 12} y1={250} x2={228} y2={250} />
      <line class="signal" x1={196} y1={240} x2={165} y2={211} />
      <line class="signal" x1={150} y1={218} x2={150} y2={282} />
      <Instrument x={210} y={250} letters="TT" module="TIC-201" alarmTag="TT-201" selection={selection} readingSide="right">
        {''}
      </Instrument>
      <Instrument x={150} y={200} letters="TIC" module="TIC-201" alarmTag="TIC-201" selection={selection} readingSide="left">
        <Reading value={unit()['TIC-201'].processValue} unit="°C" decimals={1} />
      </Instrument>
      <text x={124} y={220} class="reading end">
        SP {formatNumber(unit()['TIC-201'].setpoint, 1)} °C
      </text>
    </svg>
  );
}
