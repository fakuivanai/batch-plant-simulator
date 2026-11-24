// Phase control: each phase with its state, its active step and the commands
// its state accepts. The buttons are enabled straight from the state table,
// so they show which commands each state takes.

import { createSignal, For, Show, type JSX } from 'solid-js';
import type { PhaseName, PhaseSnapshot } from '../../engine/procedural-model/phase.ts';
import {
  acceptedCommands,
  commandTransitions,
  proceduralCommands,
  proceduralStates,
  stateAfterCommand,
  type ProceduralState,
} from '../../engine/procedural-model/state-machine.ts';
import { describeOwner } from '../describe.ts';
import { formatNumber } from '../format.ts';
import { StateDiagram } from '../StateDiagram.tsx';
import type { OperatorSession } from './operator-session.ts';

/** States that need the operator's attention get colour; the rest stay grey. */
export function stateClass(state: ProceduralState): string {
  switch (state) {
    case 'HOLDING':
    case 'HELD':
    case 'STOPPING':
    case 'STOPPED':
      return 'state-attention';
    case 'ABORTING':
    case 'ABORTED':
      return 'state-abnormal';
    case 'RUNNING':
    case 'PAUSING':
    case 'PAUSED':
    case 'RESTARTING':
      return 'state-active';
    case 'IDLE':
    case 'COMPLETE':
      return 'state-quiet';
  }
}

function ParameterInputs(props: {
  phase: PhaseSnapshot;
  values: Record<string, string>;
  setValue: (name: string, value: string) => void;
}): JSX.Element {
  return (
    <div class="parameters">
      <For each={Object.entries(props.phase.parameterDefinitions)}>
        {([name, definition]) => (
          <label title={`${definition.minimum} to ${definition.maximum} ${definition.unit}`}>
            {definition.description}{' '}
            <input
              type="number"
              step="any"
              value={props.values[name] ?? ''}
              onInput={(event) => props.setValue(name, event.currentTarget.value)}
            />{' '}
            {definition.unit}
          </label>
        )}
      </For>
    </div>
  );
}

function PhaseCard(props: { phase: PhaseSnapshot; session: OperatorSession }): JSX.Element {
  const [values, setValues] = createSignal<Record<string, string>>(
    Object.fromEntries(Object.entries(props.phase.parameterDefinitions).map(([name, definition]) => [name, String(definition.minimum)])),
  );
  const accepted = () => new Set(acceptedCommands(props.phase.state));
  const ownedElsewhere = () => props.phase.owner.kind !== 'operator';
  const send = (command: (typeof proceduralCommands)[number]) => {
    const name: PhaseName = props.phase.name;
    if (command !== 'START') {
      props.session.operate({ kind: 'phase-command', phase: name, command });
      return;
    }
    const parameters = Object.fromEntries(Object.entries(values()).map(([key, text]) => [key, text.trim() === '' ? Number.NaN : Number(text)]));
    props.session.operate({ kind: 'phase-command', phase: name, command, parameters });
  };
  return (
    <article class="phase">
      <header>
        <h3>{props.phase.name}</h3>
        <span class={`state ${stateClass(props.phase.state)}`}>{props.phase.state}</span>
      </header>
      <p class="hint">{props.phase.description}</p>
      <dl class="readout">
        <dt>Step</dt>
        <dd>{props.phase.step ?? '-'}</dd>
        <Show when={props.phase.parameters}>
          {(parameters) => (
            <>
              <dt>Parameters</dt>
              <dd>
                {Object.entries(props.phase.parameterDefinitions)
                  .flatMap(([name, definition]) => {
                    const value = parameters()[name];
                    return value === undefined ? [] : [`${definition.description} ${formatNumber(value, 1)} ${definition.unit}`];
                  })
                  .join(', ') || 'none'}
              </dd>
            </>
          )}
        </Show>
        <dt>Owner</dt>
        <dd>
          {describeOwner(props.phase.owner)}{' '}
          <Show when={props.phase.owner.kind !== 'batch'}>
            <button
              type="button"
              title="An outside batch engine, connected over OPC UA, commands a phase only once the operator hands it over."
              onClick={() =>
                props.session.operate({
                  kind: 'set-phase-owner',
                  phase: props.phase.name,
                  owner: props.phase.owner.kind === 'external' ? 'operator' : 'external',
                })
              }
            >
              {props.phase.owner.kind === 'external' ? 'Take back' : 'Hand to batch engine'}
            </button>
          </Show>
        </dd>
      </dl>
      <Show when={props.phase.failure !== null && (props.phase.state === 'HOLDING' || props.phase.state === 'HELD')}>
        <p class="failure">Held by the failure monitor: {props.phase.failure}</p>
      </Show>
      <Show when={props.phase.state === 'IDLE' && !ownedElsewhere()}>
        <ParameterInputs
          phase={props.phase}
          values={values()}
          setValue={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
        />
      </Show>
      <div class="button-row">
        <For each={proceduralCommands}>
          {(command) => (
            <button
              type="button"
              disabled={!accepted().has(command) || ownedElsewhere()}
              title={accepted().has(command) ? `${props.phase.state} → ${stateAfterCommand(props.phase.state, command)}` : `Not accepted in ${props.phase.state}`}
              onClick={() => send(command)}
            >
              {command}
            </button>
          )}
        </For>
      </div>
    </article>
  );
}

export function StateTable(props: { current?: readonly ProceduralState[] }): JSX.Element {
  return (
    <table class="state-table">
      <thead>
        <tr>
          <th>State</th>
          <For each={proceduralCommands}>{(command) => <th>{command}</th>}</For>
        </tr>
      </thead>
      <tbody>
        <For each={proceduralStates}>
          {(state) => (
            <tr classList={{ current: props.current?.includes(state) ?? false }}>
              <th>{state}</th>
              <For each={proceduralCommands}>
                {(command) => {
                  const transitions: Partial<Record<string, string>> = commandTransitions[state];
                  return <td>{transitions[command] ?? ''}</td>;
                }}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

export function PhasesPanel(props: { phases: Readonly<Record<PhaseName, PhaseSnapshot>>; session: OperatorSession }): JSX.Element {
  const phases = () => [props.phases.CHARGE_WATER, props.phases.AGITATE, props.phases.HEAT, props.phases.TRANSFER];
  return (
    <section class="panel">
      <h2>Phases</h2>
      <p class="hint">
        Each phase runs the ISA-88 state machine. A button is enabled only when the phase's state accepts that command.
      </p>
      <For each={phases()}>{(phase) => <PhaseCard phase={phase} session={props.session} />}</For>
      <details>
        <summary>The state machine</summary>
        <p class="hint">Highlighted: the states the phases are in now.</p>
        <StateDiagram current={phases().map((phase) => phase.state)} />
        <StateTable current={phases().map((phase) => phase.state)} />
      </details>
    </section>
  );
}
