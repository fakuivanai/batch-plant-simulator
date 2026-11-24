// The OPC UA address space: the tree of named values an OPC UA client
// browses, reads and subscribes to. It mirrors the ISA-88 physical model:
//
//   T-200                      the unit
//     IO/Inputs, IO/Outputs    the I/O image, signal by signal
//     ControlModules/<tag>     each control module's values and mode
//     EquipmentModules/Transfer
//     Phases/<name>            each phase's state, step, owner and parameters
//     Batch                    the batch that is active, if any
//
// Node ids are readable paths such as "T-200.ControlModules.LT-201.PV", so
// whoever connects a client can find and bind them by name. Every value is
// read from the latest snapshot of the simulation.
//
// A measured value's status travels as the OPC UA StatusCode of the value:
// GOOD, UNCERTAIN and BAD are exactly OPC UA's three severities.

import {
  DataType,
  DataValue,
  StatusCodes,
  Variant,
  makeEUInformation,
  standardUnits,
  type EUInformation,
  type Namespace,
  type StatusCode,
  type UAObject,
} from 'node-opcua';
import { invariant } from '../engine/invariant.ts';
import { signalRanges, type SignalRange } from '../engine/io.ts';
import { deviceWords, type DiscreteDeviceSnapshot } from '../engine/physical-model/control-modules/discrete-device.ts';
import type { MeasuredValue } from '../engine/physical-model/status.ts';
import type { PhaseCommandRefusal, PhaseName } from '../engine/procedural-model/phase.ts';
import type { Result } from '../engine/result.ts';
import { refusalMessages, type ExternalCommand, type SimulatorSnapshot } from '../engine/simulator.ts';
import { commandOfNumber, noCommand, stateNumbers } from './phase-interface.ts';
import { stepMilliseconds } from '../engine/time.ts';

/** Clients sample no faster than the simulation steps. */
const samplingIntervalMilliseconds = stepMilliseconds;

const units = {
  liter: makeEUInformation('LTR', 'L', 'litre'),
  milliampere: makeEUInformation('4K', 'mA', 'milliampere'),
  celsius: standardUnits.degree_celsius,
  percent: standardUnits.percent,
  rpm: standardUnits.revolutions_per_minute,
  minute: makeEUInformation('MIN', 'min', 'minute'),
} as const satisfies Record<string, EUInformation>;

/** What the address space reads from the simulation, and the one way it changes it: as an outside batch engine. */
export interface SimulationAccess {
  readonly snapshot: () => SimulatorSnapshot;
  readonly operate: (command: ExternalCommand) => Result<PhaseCommandRefusal>;
}

/**
 * The status of a measured value as an OPC UA StatusCode. A BAD value says
 * why: its module is out of service, or its instrument failed.
 */
export function statusCodeOf(value: MeasuredValue, outOfService: boolean): StatusCode {
  switch (value.status) {
    case 'GOOD':
      return StatusCodes.Good;
    case 'UNCERTAIN':
      return StatusCodes.UncertainEngineeringUnitsExceeded;
    case 'BAD':
      return outOfService ? StatusCodes.BadOutOfService : StatusCodes.BadSensorFailure;
  }
}

/** Builds variables under one object, each with a node id made from its path. */
class Builder {
  readonly #namespace: Namespace;
  readonly #source: () => SimulatorSnapshot;

  constructor(namespace: Namespace, source: () => SimulatorSnapshot) {
    this.#namespace = namespace;
    this.#source = source;
  }

  /** A folder only organizes what is in it, the way a directory does. */
  folder(parent: UAObject, path: string, name: string): UAObject {
    return this.#namespace.addObject({ organizedBy: parent, typeDefinition: 'FolderType', browseName: name, nodeId: `s=${path}.${name}` });
  }

  object(parent: UAObject, path: string, name: string): UAObject {
    return this.#namespace.addObject({ componentOf: parent, browseName: name, nodeId: `s=${path}.${name}` });
  }

  boolean(parent: UAObject, path: string, name: string, read: (snapshot: SimulatorSnapshot) => boolean): void {
    this.#variable(parent, path, name, DataType.Boolean, read);
  }

  text(parent: UAObject, path: string, name: string, read: (snapshot: SimulatorSnapshot) => string): void {
    this.#variable(parent, path, name, DataType.String, read);
  }

  number(parent: UAObject, path: string, name: string, read: (snapshot: SimulatorSnapshot) => number): void {
    this.#variable(parent, path, name, DataType.Double, read);
  }

  /** An analog item: a number with its engineering units and range, and optionally a status of its own. */
  analog(
    parent: UAObject,
    path: string,
    name: string,
    unit: EUInformation,
    range: SignalRange,
    read: (snapshot: SimulatorSnapshot) => { readonly value: number; readonly statusCode: StatusCode },
  ): void {
    this.#namespace.addAnalogDataItem({
      componentOf: parent,
      browseName: name,
      nodeId: `s=${path}.${name}`,
      dataType: 'Double',
      engineeringUnits: unit,
      engineeringUnitsRange: { low: range.lower, high: range.upper },
      minimumSamplingInterval: samplingIntervalMilliseconds,
      value: {
        timestamped_get: () => {
          const { value, statusCode } = read(this.#source());
          return dataValue(new Variant({ dataType: DataType.Double, value }), statusCode);
        },
      },
    });
  }

  integer(parent: UAObject, path: string, name: string, read: (snapshot: SimulatorSnapshot) => number): void {
    this.#variable(parent, path, name, DataType.Int32, read);
  }

  /** An integer a client may write. `write` says whether the write was taken, as an OPC UA status code. */
  writableInteger(
    parent: UAObject,
    path: string,
    name: string,
    read: (snapshot: SimulatorSnapshot) => number,
    write: (value: number) => StatusCode,
  ): void {
    this.#namespace.addVariable({
      componentOf: parent,
      browseName: name,
      nodeId: `s=${path}.${name}`,
      dataType: 'Int32',
      accessLevel: 'CurrentRead | CurrentWrite',
      userAccessLevel: 'CurrentRead | CurrentWrite',
      minimumSamplingInterval: samplingIntervalMilliseconds,
      value: {
        timestamped_get: () => dataValue(new Variant({ dataType: DataType.Int32, value: read(this.#source()) }), StatusCodes.Good),
        timestamped_set: async (written: DataValue) =>
          Number.isInteger(written.value.value) ? write(written.value.value) : StatusCodes.BadTypeMismatch,
      },
    });
  }

  /** An analog item a client may write. */
  writableAnalog(
    parent: UAObject,
    path: string,
    name: string,
    unit: EUInformation,
    range: SignalRange,
    read: () => { readonly value: number; readonly statusCode: StatusCode },
    write: (value: number) => StatusCode,
  ): void {
    this.#namespace.addAnalogDataItem({
      componentOf: parent,
      browseName: name,
      nodeId: `s=${path}.${name}`,
      dataType: 'Double',
      accessLevel: 'CurrentRead | CurrentWrite',
      userAccessLevel: 'CurrentRead | CurrentWrite',
      engineeringUnits: unit,
      engineeringUnitsRange: { low: range.lower, high: range.upper },
      minimumSamplingInterval: samplingIntervalMilliseconds,
      value: {
        timestamped_get: () => {
          const { value, statusCode } = read();
          return dataValue(new Variant({ dataType: DataType.Double, value }), statusCode);
        },
        timestamped_set: async (written: DataValue) =>
          typeof written.value.value === 'number' ? write(written.value.value) : StatusCodes.BadTypeMismatch,
      },
    });
  }

  #variable<T extends boolean | string | number>(
    parent: UAObject,
    path: string,
    name: string,
    dataType: DataType.Boolean | DataType.String | DataType.Double | DataType.Int32,
    read: (snapshot: SimulatorSnapshot) => T,
  ): void {
    this.#namespace.addVariable({
      componentOf: parent,
      browseName: name,
      nodeId: `s=${path}.${name}`,
      dataType: DataType[dataType],
      minimumSamplingInterval: samplingIntervalMilliseconds,
      value: { timestamped_get: () => dataValue(new Variant({ dataType, value: read(this.#source()) }), StatusCodes.Good) },
    });
  }
}

/** Timestamps are the server's, in wall time: OPC UA clients expect real time. Simulated time is a value of its own. */
function dataValue(value: Variant, statusCode: StatusCode): DataValue {
  const now = new Date();
  return new DataValue({ value, statusCode, sourceTimestamp: now, serverTimestamp: now });
}

const good = (value: number) => ({ value, statusCode: StatusCodes.Good });

/** The OPC UA engineering unit of a recipe parameter's unit. */
function unitOf(unit: string): EUInformation {
  switch (unit) {
    case 'L':
      return units.liter;
    case 'rpm':
      return units.rpm;
    case 'min':
      return units.minute;
    case '°C':
      return units.celsius;
    default:
      throw new Error(`Invariant broken: no OPC UA unit for ${unit}`);
  }
}

function deviceState(device: DiscreteDeviceSnapshot): string {
  const words = deviceWords[device.kind];
  switch (device.feedback) {
    case 'ACTIVE':
      return words.active;
    case 'PASSIVE':
      return words.passive;
    case 'TRAVELLING':
      return 'TRAVELLING';
    case 'CONFLICTING':
      return 'BOTH LIMITS';
  }
}

function failureText(device: DiscreteDeviceSnapshot): string {
  if (device.failure === null) return '';
  const words = deviceWords[device.kind];
  return device.failure === 'FAILED_TO_ACTIVATE' ? words.failedToActivate : words.failedToDeactivate;
}

/** Adds the unit T-200 and everything in it under the server's Objects folder. */
export function publishUnit(namespace: Namespace, objects: UAObject, access: SimulationAccess): UAObject {
  const build = new Builder(namespace, access.snapshot);
  const unit = namespace.addObject({ organizedBy: objects, browseName: 'T-200', nodeId: 's=T-200' });
  build.number(unit, 'T-200', 'SimulatedTimeSeconds', (s) => s.timeMilliseconds / 1000);
  publishIo(build, unit);
  publishControlModules(build, unit);
  publishEquipmentModules(build, unit);
  publishPhases(build, unit, access);
  publishBatch(build, unit);
  return unit;
}

function publishIo(build: Builder, unit: UAObject): void {
  const io = build.folder(unit, 'T-200', 'IO');
  const inputs = build.folder(io, 'T-200.IO', 'Inputs');
  const outputs = build.folder(io, 'T-200.IO', 'Outputs');
  const inPath = 'T-200.IO.Inputs';
  const outPath = 'T-200.IO.Outputs';
  const milliamps = { lower: 0, upper: 24 };
  build.boolean(inputs, inPath, 'ZSO-201', (s) => s.inputs['XV-201'].openLimitSwitch);
  build.boolean(inputs, inPath, 'ZSC-201', (s) => s.inputs['XV-201'].closedLimitSwitch);
  build.boolean(inputs, inPath, 'ZSO-202', (s) => s.inputs['XV-202'].openLimitSwitch);
  build.boolean(inputs, inPath, 'ZSC-202', (s) => s.inputs['XV-202'].closedLimitSwitch);
  build.boolean(inputs, inPath, 'P-201.Running', (s) => s.inputs['P-201'].running);
  build.boolean(inputs, inPath, 'AG-201.Running', (s) => s.inputs['AG-201'].running);
  build.boolean(inputs, inPath, 'LSHH-201.ContactClosed', (s) => s.inputs['LSHH-201'].contactClosed);
  build.analog(inputs, inPath, 'LT-201', units.milliampere, milliamps, (s) => good(s.inputs['LT-201'].milliamps));
  build.analog(inputs, inPath, 'TT-201', units.milliampere, milliamps, (s) => good(s.inputs['TT-201'].milliamps));
  build.boolean(outputs, outPath, 'XV-201', (s) => s.outputs['XV-201'].energized);
  build.boolean(outputs, outPath, 'XV-202', (s) => s.outputs['XV-202'].energized);
  build.boolean(outputs, outPath, 'P-201', (s) => s.outputs['P-201'].energized);
  build.boolean(outputs, outPath, 'AG-201', (s) => s.outputs['AG-201'].energized);
  build.analog(outputs, outPath, 'AG-201.SpeedReference', units.milliampere, milliamps, (s) =>
    good(s.outputs['AG-201'].speedReferenceMilliamps),
  );
  build.analog(outputs, outPath, 'TV-201', units.milliampere, milliamps, (s) => good(s.outputs['TV-201'].milliamps));
}

function publishControlModules(build: Builder, unit: UAObject): void {
  const modules = build.folder(unit, 'T-200', 'ControlModules');
  const path = 'T-200.ControlModules';
  const devices: Partial<Record<string, UAObject>> = {};
  for (const tag of ['XV-201', 'XV-202', 'P-201', 'AG-201'] as const) {
    const device = build.object(modules, path, tag);
    devices[tag] = device;
    const here = `${path}.${tag}`;
    build.text(device, here, 'Mode', (s) => s.unit[tag].mode);
    build.text(device, here, 'State', (s) => deviceState(s.unit[tag]));
    build.boolean(device, here, 'Requested', (s) => s.unit[tag].setpoint);
    build.boolean(device, here, 'Output', (s) => s.unit[tag].output);
    build.text(device, here, 'Failure', (s) => failureText(s.unit[tag]));
    build.text(device, here, 'Interlocks', (s) => s.unit[tag].interlocks.join('; '));
  }
  const agitator = devices['AG-201'];
  invariant(agitator !== undefined, 'AG-201 was published above');
  build.analog(agitator, `${path}.AG-201`, 'SpeedSetpoint', units.rpm, signalRanges['AG-201'], (s) => good(s.unit['AG-201'].speedSetpointRpm));

  const level = build.object(modules, path, 'LT-201');
  build.text(level, `${path}.LT-201`, 'Mode', (s) => s.unit['LT-201'].mode);
  build.analog(level, `${path}.LT-201`, 'PV', units.liter, signalRanges['LT-201'], (s) => ({
    value: s.unit['LT-201'].processValue.value,
    statusCode: statusCodeOf(s.unit['LT-201'].processValue, s.unit['LT-201'].mode === 'OUT_OF_SERVICE'),
  }));

  const highHigh = build.object(modules, path, 'LSHH-201');
  build.boolean(highHigh, `${path}.LSHH-201`, 'Tripped', (s) => s.unit['LSHH-201'].tripped);

  const loop = build.object(modules, path, 'TIC-201');
  const here = `${path}.TIC-201`;
  const range = signalRanges['TT-201'];
  build.analog(loop, here, 'PV', units.celsius, range, (s) => ({
    value: s.unit['TIC-201'].processValue.value,
    statusCode: statusCodeOf(s.unit['TIC-201'].processValue, s.unit['TIC-201'].targetMode === 'OUT_OF_SERVICE'),
  }));
  build.analog(loop, here, 'SP', units.celsius, range, (s) => good(s.unit['TIC-201'].setpoint));
  build.analog(loop, here, 'OUT', units.percent, { lower: 0, upper: 100 }, (s) => good(s.unit['TIC-201'].outputPercent));
  build.text(loop, here, 'TargetMode', (s) => s.unit['TIC-201'].targetMode);
  build.text(loop, here, 'ActualMode', (s) => s.unit['TIC-201'].actualMode);
  build.text(loop, here, 'Interlocks', (s) => s.unit['TIC-201'].interlocks.join('; '));
}

function publishEquipmentModules(build: Builder, unit: UAObject): void {
  const modules = build.folder(unit, 'T-200', 'EquipmentModules');
  const transfer = build.object(modules, 'T-200.EquipmentModules', 'Transfer');
  const here = 'T-200.EquipmentModules.Transfer';
  build.text(transfer, here, 'State', (s) => s.unit.transfer.state);
  build.text(transfer, here, 'Failure', (s) => s.unit.transfer.failure ?? '');
}

/** How a refused command shows to the client that wrote it. */
function statusCodeOfRefusal(refusal: PhaseCommandRefusal): StatusCode {
  switch (refusal) {
    case 'NOT_ACCEPTED_IN_STATE':
      return StatusCodes.BadInvalidState;
    case 'OWNED_BY_BATCH':
    case 'OWNED_BY_BATCH_ENGINE':
    case 'NOT_OWNER':
      return StatusCodes.BadUserAccessDenied;
    case 'BAD_PARAMETERS':
      return StatusCodes.BadOutOfRange;
  }
}

function publishPhases(build: Builder, unit: UAObject, access: SimulationAccess): void {
  const phases = build.folder(unit, 'T-200', 'Phases');
  const names: readonly PhaseName[] = ['CHARGE_WATER', 'AGITATE', 'HEAT', 'TRANSFER'];
  for (const name of names) {
    const phase = build.object(phases, 'T-200.Phases', name);
    const here = `T-200.Phases.${name}`;
    const definitions = Object.entries(access.snapshot().phases[name].parameterDefinitions);
    // What the engine has written: the last command, the refusal of it if
    // any, and the parameters waiting for the next START. These are the
    // interface's own registers, like the tags of phase logic in a PLC.
    let lastCommand = noCommand;
    let commandResult = '';
    const staged = new Map<string, number>(definitions.map(([parameter]) => [parameter, Number.NaN]));

    build.text(phase, here, 'State', (s) => s.phases[name].state);
    build.integer(phase, here, 'StateNumber', (s) => stateNumbers[s.phases[name].state]);
    build.text(phase, here, 'Step', (s) => s.phases[name].step ?? '');
    build.text(phase, here, 'Owner', (s) => {
      const owner = s.phases[name].owner;
      return owner.kind === 'batch' ? `batch ${owner.batchId}` : owner.kind;
    });
    build.text(phase, here, 'Failure', (s) => s.phases[name].failure ?? '');

    build.writableInteger(
      phase,
      here,
      'Command',
      () => lastCommand,
      (number) => {
        lastCommand = number;
        const command = commandOfNumber(number);
        if (command === undefined) {
          commandResult = `${number} is not a command number`;
          return StatusCodes.BadOutOfRange;
        }
        if (command === null) {
          commandResult = '';
          return StatusCodes.Good;
        }
        const parameters = command === 'START' ? Object.fromEntries(staged) : undefined;
        const result = access.operate(
          parameters === undefined
            ? { kind: 'phase-command', phase: name, command }
            : { kind: 'phase-command', phase: name, command, parameters },
        );
        commandResult = result.ok ? '' : refusalMessages[result.error];
        return result.ok ? StatusCodes.Good : statusCodeOfRefusal(result.error);
      },
    );
    build.text(phase, here, 'CommandResult', () => commandResult);
    build.writableInteger(
      phase,
      here,
      'Watchdog',
      (s) => s.phases[name].watchdog ?? 0,
      (value) => {
        access.operate({ kind: 'feed-watchdog', phase: name, value });
        return StatusCodes.Good;
      },
    );
    build.integer(phase, here, 'WatchdogEcho', (s) => s.phases[name].watchdog ?? 0);

    const parameters = build.folder(phase, here, 'Parameters');
    for (const [parameter, definition] of definitions) {
      build.writableAnalog(
        parameters,
        `${here}.Parameters`,
        parameter,
        unitOf(definition.unit),
        { lower: definition.minimum, upper: definition.maximum },
        () => {
          const value = staged.get(parameter) ?? Number.NaN;
          return Number.isNaN(value) ? { value, statusCode: StatusCodes.BadWaitingForInitialData } : good(value);
        },
        (value) => {
          // Staged as written: the phase checks the limits at START, where it
          // checks every parameter together.
          staged.set(parameter, value);
          return StatusCodes.Good;
        },
      );
    }
    // The parameters the phase is running with. While it is idle it has none,
    // and the values read as BAD: there is nothing to report yet.
    const active = build.folder(phase, here, 'ActiveParameters');
    for (const [parameter, definition] of definitions) {
      build.analog(
        active,
        `${here}.ActiveParameters`,
        parameter,
        unitOf(definition.unit),
        { lower: definition.minimum, upper: definition.maximum },
        (s) => {
          const value = s.phases[name].parameters?.[parameter];
          return value === undefined
            ? { value: Number.NaN, statusCode: StatusCodes.BadWaitingForInitialData }
            : good(value);
        },
      );
    }
  }
}

function publishBatch(build: Builder, unit: UAObject): void {
  const batch = build.object(unit, 'T-200', 'Batch');
  const here = 'T-200.Batch';
  const active = (s: SimulatorSnapshot) => s.batches.at(-1);
  build.text(batch, here, 'Id', (s) => active(s)?.id ?? '');
  build.text(batch, here, 'State', (s) => active(s)?.state ?? '');
  build.text(batch, here, 'Operation', (s) => active(s)?.steps.find((step) => step.progress === 'ACTIVE')?.operation ?? '');
}
