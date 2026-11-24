import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  AttributeIds,
  DataType,
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAClient,
  SecurityPolicy,
  StatusCodes,
  type ClientSession,
} from 'node-opcua';
import { startOpcUaServer, type RunningServer } from '../../src/server/opcua-server.ts';
import { commandNumbers, stateNumbers } from '../../src/server/phase-interface.ts';
import { Simulator, type SimulatorSnapshot } from '../../src/engine/simulator.ts';
import { chargeByHand, operate, runFor } from '../support/simulation.ts';

let folder: string;
let server: RunningServer | undefined;
let client: OPCUAClient | undefined;
let session: ClientSession;
let simulator: Simulator;
let snapshot: SimulatorSnapshot;

/** The tests step the simulation themselves and publish a snapshot when they want the server to see it. */
function publish(): void {
  snapshot = simulator.snapshot();
}

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'batch-plant-opcua-'));
  simulator = new Simulator(1);
  publish();
  // A port in the dynamic range, picked at random so parallel runs rarely collide.
  const port = 49152 + Math.floor(Math.random() * 10000);
  server = await startOpcUaServer({
    host: '127.0.0.1',
    port,
    pkiFolder: path.join(folder, 'server'),
    access: {
      snapshot: () => snapshot,
      operate: (command) => {
        const result = simulator.operateExternal('Test client', command);
        publish();
        return result;
      },
    },
  });
  client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    clientCertificateManager: new OPCUACertificateManager({ rootFolder: path.join(folder, 'client') }),
    connectionStrategy: { maxRetry: 1 },
  });
  await client.connect(server.endpointUrl);
  session = await client.createSession();
});

after(async () => {
  await session?.close();
  await client?.disconnect();
  await server?.stop();
  await rm(folder, { recursive: true, force: true });
});

async function browseNames(nodeId: string): Promise<string[]> {
  const result = await session.browse(nodeId);
  return (result.references ?? []).flatMap((reference) => (reference.browseName.name ? [reference.browseName.name] : []));
}

async function read(nodeId: string) {
  return session.read({ nodeId, attributeId: AttributeIds.Value });
}

const ns = 'ns=1;s=';

test('the address space lists every control module, the equipment module and every phase of unit T-200', async () => {
  const modules = await browseNames(`${ns}T-200.ControlModules`);
  for (const tag of ['XV-201', 'XV-202', 'P-201', 'AG-201', 'LT-201', 'LSHH-201', 'TIC-201']) assert.ok(modules.includes(tag), tag);
  assert.ok((await browseNames(`${ns}T-200.EquipmentModules`)).includes('Transfer'));
  const phases = await browseNames(`${ns}T-200.Phases`);
  assert.deepEqual(phases.sort(), ['AGITATE', 'CHARGE_WATER', 'HEAT', 'TRANSFER']);
});

test('values follow the simulation: a charge shows on LT-201 and on the I/O image', async () => {
  chargeByHand(simulator, 300);
  publish();
  const level = await read(`${ns}T-200.ControlModules.LT-201.PV`);
  assert.ok(Math.abs(level.value.value - simulator.unit.level.processValue.value) < 1e-9);
  const signal = await read(`${ns}T-200.IO.Inputs.LT-201`);
  assert.equal(signal.value.value, simulator.snapshot().inputs['LT-201'].milliamps);
});

test("a measured value's status is its OPC UA status code: GOOD is Good, out of service and a failed sensor are Bad", async () => {
  assert.equal((await read(`${ns}T-200.ControlModules.LT-201.PV`)).statusCode, StatusCodes.Good);
  operate(simulator, { kind: 'set-level-mode', mode: 'OUT_OF_SERVICE' });
  runFor(simulator, 200);
  publish();
  assert.equal((await read(`${ns}T-200.ControlModules.LT-201.PV`)).statusCode, StatusCodes.BadOutOfService);
  operate(simulator, { kind: 'set-level-mode', mode: 'AUTOMATIC' });
  simulator.injectFault('temperature-transmitter-failed');
  runFor(simulator, 200);
  publish();
  assert.equal((await read(`${ns}T-200.ControlModules.TIC-201.PV`)).statusCode, StatusCodes.BadSensorFailure);
  simulator.clearFault('temperature-transmitter-failed');
});

async function write(nodeId: string, dataType: DataType, value: number) {
  return session.write({ nodeId, attributeId: AttributeIds.Value, value: { value: { dataType, value } } });
}

test('a batch engine drives a phase over OPC UA: it writes the parameters, then START, and reads the state number', async () => {
  operate(simulator, { kind: 'set-phase-owner', phase: 'AGITATE', owner: 'external' });
  publish();
  const phase = `${ns}T-200.Phases.AGITATE`;
  assert.equal(await write(`${phase}.Parameters.speedRpm`, DataType.Double, 120), StatusCodes.Good);
  assert.equal(await write(`${phase}.Parameters.durationMinutes`, DataType.Double, 1), StatusCodes.Good);
  assert.equal(await write(`${phase}.Command`, DataType.Int32, commandNumbers.START), StatusCodes.Good);
  assert.equal((await read(`${phase}.StateNumber`)).value.value, stateNumbers.RUNNING);
  runFor(simulator, 1000);
  publish();
  assert.equal((await read(`${phase}.ActiveParameters.speedRpm`)).value.value, 120);
});

test('a refused command comes back as a Bad status code, with the reason in CommandResult', async () => {
  const phase = `${ns}T-200.Phases.AGITATE`;
  assert.equal(await write(`${phase}.Command`, DataType.Int32, commandNumbers.RESTART), StatusCodes.BadInvalidState);
  assert.match((await read(`${phase}.CommandResult`)).value.value, /doesn't accept that command/);
  assert.equal(await write(`${phase}.Command`, DataType.Int32, 99), StatusCodes.BadOutOfRange);
  const operatorsPhase = `${ns}T-200.Phases.HEAT.Command`;
  assert.equal(await write(operatorsPhase, DataType.Int32, commandNumbers.START), StatusCodes.BadUserAccessDenied);
});

test('the phase echoes the watchdog value the batch engine writes', async () => {
  const phase = `${ns}T-200.Phases.AGITATE`;
  assert.equal(await write(`${phase}.Watchdog`, DataType.Int32, 42), StatusCodes.Good);
  assert.equal((await read(`${phase}.WatchdogEcho`)).value.value, 42);
});
