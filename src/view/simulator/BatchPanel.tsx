// Batch control: create a batch from the master recipe, with its formula
// values, then start and command it. The procedure tree shows where the batch
// is: procedure, unit procedure, operations, and the phases they run.

import { createSignal, For, Show, type JSX } from 'solid-js';
import type { BatchSnapshot } from '../../engine/procedural-model/batch.ts';
import type { PhaseName, PhaseSnapshot } from '../../engine/procedural-model/phase.ts';
import { bufferPreparation } from '../../engine/procedural-model/recipe.ts';
import { acceptedCommands, isFinal, proceduralCommands } from '../../engine/procedural-model/state-machine.ts';
import { formatClock, formatNumber } from '../format.ts';
import type { OperatorSession } from './operator-session.ts';
import { stateClass } from './PhasesPanel.tsx';

const batchCommands = proceduralCommands.filter((command) => command !== 'RESET');

function NewBatch(props: { session: OperatorSession }): JSX.Element {
  const formula = Object.entries(bufferPreparation.formula);
  const [values, setValues] = createSignal<Record<string, string>>(
    Object.fromEntries(formula.map(([name, parameter]) => [name, String(parameter.defaultValue)])),
  );
  const [reason, setReason] = createSignal('');
  const create = () => {
    const parsed = Object.fromEntries(
      Object.entries(values()).map(([name, text]) => [name, text.trim() === '' ? Number.NaN : Number(text)]),
    );
    props.session.operate({ kind: 'create-batch', formula: parsed }, reason());
  };
  return (
    <>
      <h3>New batch</h3>
      <p class="hint">
        Master recipe {bufferPreparation.id} version {bufferPreparation.version}, for {bufferPreparation.product}. The batch
        gets its own copy, the control recipe, with the formula values below.
      </p>
      <table class="formula">
        <thead>
          <tr>
            <th>Formula value</th>
            <th>Value</th>
            <th>Limits</th>
          </tr>
        </thead>
        <tbody>
          <For each={formula}>
            {([name, parameter]) => (
              <tr>
                <td>{parameter.description}</td>
                <td>
                  <input
                    type="number"
                    step="any"
                    value={values()[name] ?? ''}
                    onInput={(event) => setValues((current) => ({ ...current, [name]: event.currentTarget.value }))}
                  />{' '}
                  {parameter.unit}
                </td>
                <td class="muted">
                  {parameter.minimum} to {parameter.maximum}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <label class="reason">
        Reason for values off the recipe's defaults{' '}
        <input type="text" value={reason()} onInput={(event) => setReason(event.currentTarget.value)} />
      </label>
      <div class="button-row">
        <button type="button" onClick={create}>
          Create batch
        </button>
      </div>
    </>
  );
}

function ProcedureTree(props: { batch: BatchSnapshot; phases: Readonly<Record<PhaseName, PhaseSnapshot>> }): JSX.Element {
  const unitProcedures = () => [...new Set(props.batch.steps.map((step) => step.unitProcedure))];
  return (
    <div class="procedure">
      <p>
        <strong>Procedure</strong> {props.batch.recipe.procedure}
      </p>
      <For each={unitProcedures()}>
        {(unitProcedure) => (
          <div class="unit-procedure">
            <p>
              <strong>Unit procedure</strong> {unitProcedure} <span class="muted">(unit T-200)</span>
            </p>
            <ol class="operations">
              <For each={props.batch.steps.filter((step) => step.unitProcedure === unitProcedure)}>
                {(step) => (
                  <li classList={{ [step.progress.toLowerCase()]: true }}>
                    <span class="operation">Operation {step.operation}</span>
                    <span class="phase-name">{step.phase}</span>
                    <span class="muted">
                      {Object.entries(step.parameters)
                        .map(([name, value]) => `${name} ${formatNumber(value, 1)}`)
                        .join(', ')}
                    </span>
                    <Show when={step.progress === 'ACTIVE'}>
                      <span class={`state ${stateClass(props.phases[step.phase].state)}`}>{props.phases[step.phase].state}</span>
                    </Show>
                    <Show when={step.progress === 'DONE'}>
                      <span class="muted">done</span>
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </div>
        )}
      </For>
    </div>
  );
}

function FormulaChange(props: { batch: BatchSnapshot; session: OperatorSession }): JSX.Element {
  const [parameter, setParameter] = createSignal(props.batch.formula[0]?.name ?? '');
  const [value, setValue] = createSignal('');
  const [reason, setReason] = createSignal('');
  return (
    <details>
      <summary>Change a formula value</summary>
      <p class="hint">Allowed until the phase that uses the value has started. Every change needs a reason.</p>
      <div class="parameters">
        <label>
          Value{' '}
          <select value={parameter()} onChange={(event) => setParameter(event.currentTarget.value)}>
            <For each={props.batch.formula}>
              {(entry) => (
                <option value={entry.name}>
                  {entry.description}: {formatNumber(entry.value, 1)} {entry.unit}
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          New value <input type="number" step="any" value={value()} onInput={(event) => setValue(event.currentTarget.value)} />
        </label>
        <label>
          Reason <input type="text" value={reason()} onInput={(event) => setReason(event.currentTarget.value)} />
        </label>
      </div>
      <button
        type="button"
        onClick={() =>
          props.session.operate(
            { kind: 'change-formula-value', parameter: parameter(), value: value().trim() === '' ? Number.NaN : Number(value()) },
            reason(),
          )
        }
      >
        Change
      </button>
    </details>
  );
}

function ActiveBatch(props: {
  batch: BatchSnapshot;
  phases: Readonly<Record<PhaseName, PhaseSnapshot>>;
  session: OperatorSession;
}): JSX.Element {
  const [reason, setReason] = createSignal('');
  const accepted = () => new Set(acceptedCommands(props.batch.state));
  return (
    <>
      <header class="batch-header">
        <h3>Batch {props.batch.id}</h3>
        <span class={`state ${stateClass(props.batch.state)}`}>{props.batch.state}</span>
      </header>
      <dl class="readout">
        <dt>Recipe</dt>
        <dd>
          {props.batch.recipe.id} version {props.batch.recipe.version}, {props.batch.recipe.product}
        </dd>
        <dt>Created</dt>
        <dd>{formatClock(props.batch.createdAtMilliseconds)}</dd>
        <Show when={props.batch.startedAtMilliseconds}>
          {(started) => (
            <>
              <dt>Started</dt>
              <dd>{formatClock(started())}</dd>
            </>
          )}
        </Show>
      </dl>
      <div class="button-row">
        <For each={batchCommands}>
          {(command) => (
            <button
              type="button"
              disabled={!accepted().has(command)}
              onClick={() => {
                void props.session.operate({ kind: 'batch-command', command }, reason()).then((ok) => ok && setReason(''));
              }}
            >
              {command}
            </button>
          )}
        </For>
      </div>
      <label class="reason">
        Reason (needed to STOP or ABORT){' '}
        <input type="text" value={reason()} onInput={(event) => setReason(event.currentTarget.value)} />
      </label>
      <ProcedureTree batch={props.batch} phases={props.phases} />
      <FormulaChange batch={props.batch} session={props.session} />
    </>
  );
}

export function BatchPanel(props: {
  batches: readonly BatchSnapshot[];
  phases: Readonly<Record<PhaseName, PhaseSnapshot>>;
  session: OperatorSession;
}): JSX.Element {
  const active = () => {
    const last = props.batches.at(-1);
    return last !== undefined && !isFinal(last.state) ? last : null;
  };
  return (
    <section class="panel">
      <h2>Batch</h2>
      <p class="hint">
        A batch runs the recipe's procedure. While it runs it owns the phases: command the batch here, not the phases.
      </p>
      <Show when={active()} fallback={<NewBatch session={props.session} />}>
        {(batch) => <ActiveBatch batch={batch()} phases={props.phases} session={props.session} />}
      </Show>
    </section>
  );
}
