// Faceplates: the small window an operator opens on one control module, with
// its value, its mode and the commands it takes. Every command goes through
// the operator session, so it carries the operator's name into the journal.

import { createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import type { AnalogInputSnapshot } from '../../engine/physical-model/control-modules/analog-input.ts';
import {
  deviceWords,
  type DiscreteDeviceMode,
  type DiscreteDeviceSnapshot,
} from '../../engine/physical-model/control-modules/discrete-device.ts';
import type { LevelSwitchSnapshot } from '../../engine/physical-model/control-modules/level-switch.ts';
import type { PidLoopSnapshot } from '../../engine/physical-model/control-modules/pid-loop.ts';
import type { VariableSpeedDriveSnapshot } from '../../engine/physical-model/control-modules/variable-speed-drive.ts';
import type { Mode } from '../../engine/physical-model/mode.ts';
import type { MeasuredValue } from '../../engine/physical-model/status.ts';
import type { DiscreteDeviceTag, UnitSnapshot } from '../../engine/physical-model/unit.ts';
import { formatNumber } from '../format.ts';
import type { OperatorSession } from './operator-session.ts';

export type ModuleTag = Exclude<keyof UnitSnapshot, 'transfer'>;

export const moduleTags: readonly ModuleTag[] = ['XV-201', 'XV-202', 'P-201', 'AG-201', 'LT-201', 'LSHH-201', 'TIC-201'];

const modeNames: Record<Mode, string> = {
  OUT_OF_SERVICE: 'OOS',
  MANUAL: 'MAN',
  AUTOMATIC: 'AUTO',
  CASCADE: 'CAS',
};

const modeExplanations: Record<Mode, string> = {
  OUT_OF_SERVICE: 'Out of service: taken out of operation. Outputs go safe and measurements read BAD.',
  MANUAL: 'Manual: the operator drives the output.',
  AUTOMATIC: 'Automatic: the module controls to a setpoint the operator sets.',
  CASCADE: 'Cascade: the control program (a phase) drives the module.',
};

function ModeButtons<M extends Mode>(props: { modes: readonly M[]; current: M; choose: (mode: M) => void }): JSX.Element {
  return (
    <div class="button-row" role="group" aria-label="Mode">
      <For each={props.modes}>
        {(mode) => (
          <button
            type="button"
            classList={{ active: props.current === mode }}
            title={modeExplanations[mode]}
            onClick={() => props.choose(mode)}
          >
            {modeNames[mode]}
          </button>
        )}
      </For>
    </div>
  );
}

export function StatusValue(props: { value: MeasuredValue; unit: string; decimals: number }): JSX.Element {
  return (
    <span class={`value status-${props.value.status.toLowerCase()}`}>
      {formatNumber(props.value.value, props.decimals)} {props.unit}
      <Show when={props.value.status !== 'GOOD'}>
        <span class="status-flag">{props.value.status}</span>
      </Show>
    </span>
  );
}

function Bar(props: { fraction: number; marker?: number }): JSX.Element {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return (
    <div class="bar-gauge">
      <div class="bar-fill" style={{ width: `${clamp(props.fraction) * 100}%` }} />
      <Show when={props.marker !== undefined}>
        <div class="bar-marker" style={{ left: `${clamp(props.marker ?? 0) * 100}%` }} />
      </Show>
    </div>
  );
}

function Interlocks(props: { interlocks: readonly string[] }): JSX.Element {
  return (
    <Show when={props.interlocks.length > 0}>
      <p class="interlocked">Interlocked: {props.interlocks.join(', ')}</p>
    </Show>
  );
}

function NumberEntry(props: { label: string; unit: string; initial: number; disabled: boolean; submit: (value: number) => void }): JSX.Element {
  const [text, setText] = createSignal(String(props.initial));
  return (
    <form
      class="number-entry"
      onSubmit={(event) => {
        event.preventDefault();
        const value = Number(text());
        if (text().trim() !== '' && Number.isFinite(value)) props.submit(value);
      }}
    >
      <label>
        {props.label}{' '}
        <input type="number" step="any" value={text()} disabled={props.disabled} onInput={(event) => setText(event.currentTarget.value)} />{' '}
        {props.unit}
      </label>{' '}
      <button type="submit" disabled={props.disabled}>
        Set
      </button>
    </form>
  );
}

function DiscreteDeviceFaceplate(props: {
  tag: DiscreteDeviceTag;
  device: DiscreteDeviceSnapshot;
  session: OperatorSession;
  reason: () => string;
}): JSX.Element {
  const tag = () => props.tag;
  const words = () => deviceWords[props.device.kind];
  const state = () => {
    switch (props.device.feedback) {
      case 'ACTIVE':
        return words().active;
      case 'PASSIVE':
        return words().passive;
      case 'TRAVELLING':
        return 'TRAVELLING';
      case 'CONFLICTING':
        return 'BOTH LIMITS';
    }
  };
  const failure = () =>
    props.device.failure === null
      ? null
      : props.device.failure === 'FAILED_TO_ACTIVATE'
        ? words().failedToActivate
        : words().failedToDeactivate;
  const modes: readonly DiscreteDeviceMode[] = ['OUT_OF_SERVICE', 'MANUAL', 'CASCADE'];
  return (
    <>
      <dl class="readout">
        <dt>State</dt>
        <dd class="value">{state()}</dd>
        <dt>Requested</dt>
        <dd>{props.device.setpoint ? words().active : words().passive}</dd>
        <dt>Output</dt>
        <dd>{props.device.output ? 'energized' : 'de-energized'}</dd>
      </dl>
      <ModeButtons
        modes={modes}
        current={props.device.mode}
        choose={(mode) => props.session.operate({ kind: 'set-device-mode', module: tag(), mode }, props.reason())}
      />
      <div class="button-row">
        <button
          type="button"
          disabled={props.device.mode !== 'MANUAL'}
          onClick={() => props.session.operate({ kind: 'command-device', module: tag(), active: true }, props.reason())}
        >
          {props.device.kind === 'valve' ? 'Open' : 'Start'}
        </button>
        <button
          type="button"
          disabled={props.device.mode !== 'MANUAL'}
          onClick={() => props.session.operate({ kind: 'command-device', module: tag(), active: false }, props.reason())}
        >
          {props.device.kind === 'valve' ? 'Close' : 'Stop'}
        </button>
      </div>
      <Show when={failure()}>
        {(text) => (
          <div class="failure">
            <span>Failed: {text()}</span>
            <button
              type="button"
              onClick={() => props.session.operate({ kind: 'reset-device-failure', module: tag() }, props.reason())}
            >
              Reset failure
            </button>
          </div>
        )}
      </Show>
      <Interlocks interlocks={props.device.interlocks} />
    </>
  );
}

function DriveFaceplate(props: { drive: VariableSpeedDriveSnapshot; session: OperatorSession; reason: () => string }): JSX.Element {
  return (
    <>
      <DiscreteDeviceFaceplate tag="AG-201" device={props.drive} session={props.session} reason={props.reason} />
      <p>Speed setpoint: {formatNumber(props.drive.speedSetpointRpm, 0)} rpm</p>
      <NumberEntry
        label="New speed"
        unit="rpm"
        initial={props.drive.speedSetpointRpm}
        disabled={props.drive.mode !== 'MANUAL'}
        submit={(rpm) => props.session.operate({ kind: 'set-agitator-speed', rpm }, props.reason())}
      />
    </>
  );
}

function AnalogInputFaceplate(props: { input: AnalogInputSnapshot; session: OperatorSession; reason: () => string }): JSX.Element {
  const range = () => props.input.range;
  return (
    <>
      <dl class="readout">
        <dt>PV</dt>
        <dd>
          <StatusValue value={props.input.processValue} unit={props.input.unit} decimals={1} />
        </dd>
        <dt>Signal</dt>
        <dd>{formatNumber(props.input.signalMilliamps, 2)} mA</dd>
      </dl>
      <Bar fraction={(props.input.processValue.value - range().lower) / (range().upper - range().lower)} />
      <ModeButtons
        modes={['OUT_OF_SERVICE', 'AUTOMATIC'] as const}
        current={props.input.mode}
        choose={(mode) => props.session.operate({ kind: 'set-level-mode', mode }, props.reason())}
      />
    </>
  );
}

function LevelSwitchFaceplate(props: { levelSwitch: LevelSwitchSnapshot }): JSX.Element {
  return (
    <dl class="readout">
      <dt>State</dt>
      <dd class={props.levelSwitch.tripped ? 'value status-bad' : 'value'}>{props.levelSwitch.tripped ? 'TRIPPED' : 'normal'}</dd>
      <dt>Wiring</dt>
      <dd>Fail-safe: a high level or a broken wire both trip it.</dd>
    </dl>
  );
}

function PidLoopFaceplate(props: { loop: PidLoopSnapshot; session: OperatorSession; reason: () => string }): JSX.Element {
  const range = () => props.loop.range;
  const fraction = (value: number) => (value - range().lower) / (range().upper - range().lower);
  return (
    <>
      <dl class="readout">
        <dt>PV ({props.loop.transmitterTag})</dt>
        <dd>
          <StatusValue value={props.loop.processValue} unit={props.loop.unit} decimals={1} />
        </dd>
        <dt>SP</dt>
        <dd>
          {formatNumber(props.loop.setpoint, 1)} {props.loop.unit}
        </dd>
        <dt>OUT ({props.loop.valveTag})</dt>
        <dd>{formatNumber(props.loop.outputPercent, 1)} %</dd>
        <dt>Mode</dt>
        <dd>
          target {modeNames[props.loop.targetMode]}, actual {modeNames[props.loop.actualMode]}
          <Show when={props.loop.actualMode !== props.loop.targetMode}>
            <span class="status-flag status-bad">SHED</span>
          </Show>
        </dd>
      </dl>
      <Bar fraction={fraction(props.loop.processValue.value)} marker={fraction(props.loop.setpoint)} />
      <Bar fraction={props.loop.outputPercent / 100} />
      <ModeButtons
        modes={['OUT_OF_SERVICE', 'MANUAL', 'AUTOMATIC', 'CASCADE'] as const}
        current={props.loop.targetMode}
        choose={(mode) => props.session.operate({ kind: 'set-loop-mode', mode }, props.reason())}
      />
      <NumberEntry
        label="New setpoint"
        unit={props.loop.unit}
        initial={37}
        disabled={props.loop.targetMode !== 'AUTOMATIC'}
        submit={(value) => props.session.operate({ kind: 'set-loop-setpoint', value }, props.reason())}
      />
      <NumberEntry
        label="New output"
        unit="%"
        initial={0}
        disabled={props.loop.targetMode !== 'MANUAL'}
        submit={(percent) => props.session.operate({ kind: 'set-loop-output', percent }, props.reason())}
      />
      <Interlocks interlocks={props.loop.interlocks} />
    </>
  );
}

export function Faceplate(props: { tag: ModuleTag; unit: UnitSnapshot; session: OperatorSession }): JSX.Element {
  const [reason, setReason] = createSignal('');
  const description = () => props.unit[props.tag].description;
  const valveOrPumpTag = () =>
    props.tag === 'XV-201' || props.tag === 'XV-202' || props.tag === 'P-201' ? props.tag : null;
  return (
    <section class="panel faceplate">
      <h2>
        {props.tag} <span class="muted">{description()}</span>
      </h2>
      <Switch>
        <Match when={props.tag === 'AG-201'}>
          <DriveFaceplate drive={props.unit['AG-201']} session={props.session} reason={reason} />
        </Match>
        <Match when={valveOrPumpTag()}>
          {(tag) => <DiscreteDeviceFaceplate tag={tag()} device={props.unit[tag()]} session={props.session} reason={reason} />}
        </Match>
        <Match when={props.tag === 'LT-201'}>
          <AnalogInputFaceplate input={props.unit['LT-201']} session={props.session} reason={reason} />
        </Match>
        <Match when={props.tag === 'LSHH-201'}>
          <LevelSwitchFaceplate levelSwitch={props.unit['LSHH-201']} />
        </Match>
        <Match when={props.tag === 'TIC-201'}>
          <PidLoopFaceplate loop={props.unit['TIC-201']} session={props.session} reason={reason} />
        </Match>
      </Switch>
      <Show when={props.tag !== 'LSHH-201'}>
        <label class="reason">
          Reason for the change (optional){' '}
          <input type="text" value={reason()} onInput={(event) => setReason(event.currentTarget.value)} />
        </label>
      </Show>
    </section>
  );
}
