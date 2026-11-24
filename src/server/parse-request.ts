// Checks what arrives over HTTP before it reaches the simulation. The body of
// a request is outside input: anything could have sent it. Each parser either
// returns a value of the engine's own types or null, so the engine only ever
// sees well-formed commands. Ranges and states are still the engine's to
// check; this only checks shape.

import type { AnalogInputMode } from '../engine/physical-model/control-modules/analog-input.ts';
import type { DiscreteDeviceMode } from '../engine/physical-model/control-modules/discrete-device.ts';
import type { Mode } from '../engine/physical-model/mode.ts';
import type { DiscreteDeviceTag } from '../engine/physical-model/unit.ts';
import { faultKinds, type FaultKind } from '../engine/process/faults.ts';
import type { PhaseName } from '../engine/procedural-model/phase.ts';
import { proceduralCommands, type ProceduralCommand } from '../engine/procedural-model/state-machine.ts';
import type { OperatorCommand } from '../engine/simulator.ts';
import type { FaultRequest, OperateRequest } from '../remote/protocol.ts';

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A check that a string is one of a type's values. The values come as the
 * keys of a record, so leaving one out, or adding one the type doesn't have,
 * fails to compile.
 */
function oneOf<T extends string>(values: Readonly<Record<T, true>>): (value: unknown) => value is T {
  return (value): value is T => typeof value === 'string' && Object.hasOwn(values, value);
}

const isDeviceTag = oneOf<DiscreteDeviceTag>({ 'XV-201': true, 'XV-202': true, 'P-201': true, 'AG-201': true });
const isDeviceMode = oneOf<DiscreteDeviceMode>({ OUT_OF_SERVICE: true, MANUAL: true, CASCADE: true });
const isInputMode = oneOf<AnalogInputMode>({ OUT_OF_SERVICE: true, AUTOMATIC: true });
const isMode = oneOf<Mode>({ OUT_OF_SERVICE: true, MANUAL: true, AUTOMATIC: true, CASCADE: true });
const isPhaseName = oneOf<PhaseName>({ CHARGE_WATER: true, AGITATE: true, HEAT: true, TRANSFER: true });
const isOwner = oneOf<'operator' | 'external'>({ operator: true, external: true });
const isCommand = (value: unknown): value is ProceduralCommand =>
  typeof value === 'string' && proceduralCommands.some((command) => command === value);
const isFault = (value: unknown): value is FaultKind => typeof value === 'string' && faultKinds.some((fault) => fault === value);
/**
 * A number, or NaN for null: JSON has no NaN, so a field the operator left
 * empty arrives as null. The engine then refuses it as it would any value
 * outside its limits. Anything else is not a number at all.
 */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  return value === null ? Number.NaN : undefined;
}

/** An object of numbers by name, as the formula and phase parameters come. */
function numbers(value: unknown): Readonly<Record<string, number>> | null {
  if (!isFields(value)) return null;
  const checked: Record<string, number> = {};
  for (const [name, entry] of Object.entries(value)) {
    const number = numberOf(entry);
    if (number === undefined) return null;
    checked[name] = number;
  }
  return checked;
}

/** One parser per kind of command. Leaving a kind out fails to compile. */
const commandParsers: { readonly [Kind in OperatorCommand['kind']]: (fields: Fields) => OperatorCommand | null } = {
  'set-device-mode': ({ module, mode }) => (isDeviceTag(module) && isDeviceMode(mode) ? { kind: 'set-device-mode', module, mode } : null),
  'command-device': ({ module, active }) =>
    isDeviceTag(module) && typeof active === 'boolean' ? { kind: 'command-device', module, active } : null,
  'reset-device-failure': ({ module }) => (isDeviceTag(module) ? { kind: 'reset-device-failure', module } : null),
  'set-agitator-speed': (fields) => {
    const rpm = numberOf(fields['rpm']);
    return rpm === undefined ? null : { kind: 'set-agitator-speed', rpm };
  },
  'set-level-mode': ({ mode }) => (isInputMode(mode) ? { kind: 'set-level-mode', mode } : null),
  'set-loop-mode': ({ mode }) => (isMode(mode) ? { kind: 'set-loop-mode', mode } : null),
  'set-loop-setpoint': (fields) => {
    const value = numberOf(fields['value']);
    return value === undefined ? null : { kind: 'set-loop-setpoint', value };
  },
  'set-loop-output': (fields) => {
    const percent = numberOf(fields['percent']);
    return percent === undefined ? null : { kind: 'set-loop-output', percent };
  },
  'acknowledge-alarm': ({ alarm }) => (typeof alarm === 'string' ? { kind: 'acknowledge-alarm', alarm } : null),
  'phase-command': ({ phase, command, parameters }) => {
    if (!isPhaseName(phase) || !isCommand(command)) return null;
    if (parameters === undefined) return { kind: 'phase-command', phase, command };
    const checked = numbers(parameters);
    return checked === null ? null : { kind: 'phase-command', phase, command, parameters: checked };
  },
  'set-phase-owner': ({ phase, owner }) => (isPhaseName(phase) && isOwner(owner) ? { kind: 'set-phase-owner', phase, owner } : null),
  'create-batch': ({ formula }) => {
    const checked = numbers(formula);
    return checked === null ? null : { kind: 'create-batch', formula: checked };
  },
  'batch-command': ({ command }) => (isCommand(command) ? { kind: 'batch-command', command } : null),
  'change-formula-value': (fields) => {
    const parameter = fields['parameter'];
    const value = numberOf(fields['value']);
    return typeof parameter === 'string' && value !== undefined ? { kind: 'change-formula-value', parameter, value } : null;
  },
};

function isCommandKind(kind: unknown): kind is OperatorCommand['kind'] {
  return typeof kind === 'string' && Object.hasOwn(commandParsers, kind);
}

export function parseOperateRequest(body: unknown): OperateRequest | null {
  if (!isFields(body) || typeof body['operatorName'] !== 'string') return null;
  const reason = body['reason'];
  if (reason !== undefined && typeof reason !== 'string') return null;
  const command = body['command'];
  if (!isFields(command) || !isCommandKind(command['kind'])) return null;
  const parsed = commandParsers[command['kind']](command);
  if (parsed === null) return null;
  return reason === undefined
    ? { operatorName: body['operatorName'], command: parsed }
    : { operatorName: body['operatorName'], command: parsed, reason };
}

export function parseFaultRequest(body: unknown): FaultRequest | null {
  if (!isFields(body)) return null;
  const { fault, active } = body;
  return isFault(fault) && typeof active === 'boolean' ? { fault, active } : null;
}
