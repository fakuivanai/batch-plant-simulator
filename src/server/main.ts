// Runs the simulation in Node and serves it over OPC UA.
//
//   pnpm serve [--port 4840] [--web-port 8080] [--host 127.0.0.1] [--speed 1] [--seed 200]
//
// The simulation advances in real time (or at --speed times real time),
// paced by the wall clock here; the engine itself still only steps.

import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Pacer } from '../engine/pacing.ts';
import { Simulator, type SimulatorSnapshot } from '../engine/simulator.ts';
import { stepMilliseconds } from '../engine/time.ts';
import { fileURLToPath } from 'node:url';
import { startOpcUaServer } from './opcua-server.ts';
import { startWebServer } from './web-server.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4840' },
    'web-port': { type: 'string', default: '8080' },
    host: { type: 'string', default: '127.0.0.1' },
    speed: { type: 'string', default: '1' },
    seed: { type: 'string', default: '200' },
  },
});

/** Command-line values are outside input: checked once, here. */
function positiveInteger(name: string, text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} needs a positive whole number, not ${text}`);
  return value;
}

const port = positiveInteger('port', values.port);
const webPort = positiveInteger('web-port', values['web-port']);
const speed = positiveInteger('speed', values.speed);
const seed = positiveInteger('seed', values.seed);

/** The per-user state folder (XDG), so certificates never land in the repository. */
const stateFolder = process.env['XDG_STATE_HOME'] ?? path.join(homedir(), '.local', 'state');
const pkiFolder = path.join(stateFolder, 'batch-plant-simulator', 'pki');

/** How commands from OPC UA clients show in the journal. */
const outsideClient = 'OPC UA client';

const simulator = new Simulator(seed);
let snapshot: SimulatorSnapshot = simulator.snapshot();

/** At most a minute of simulated time per tick, so a stalled process falls behind instead of racing. */
const pacer = new Pacer(600);
let previous = performance.now();
setInterval(() => {
  const now = performance.now();
  const steps = pacer.steps(now - previous, speed);
  previous = now;
  for (let step = 0; step < steps; step++) simulator.step();
  if (steps > 0) snapshot = simulator.snapshot();
}, stepMilliseconds / 2);

const server = await startOpcUaServer({
  host: values.host,
  port,
  pkiFolder,
  access: {
    snapshot: () => snapshot,
    operate: (command) => {
      const result = simulator.operateExternal(outsideClient, command);
      snapshot = simulator.snapshot();
      return result;
    },
  },
});
console.log(`Serving T-200 over OPC UA at ${server.endpointUrl}, ${speed}× real time. Ctrl+C stops it.`);
if (speed !== 1) {
  console.log('An outside batch engine writes its watchdog in real time; at this speed its phases will hold on a lost watchdog.');
}


const pagesFolder = fileURLToPath(new URL('../../dist/', import.meta.url));
const web = await startWebServer({
  host: values.host,
  port: webPort,
  pagesFolder,
  simulation: {
    snapshot: () => snapshot,
    speed,
    operate: (request) => {
      const result = simulator.operate(request.operatorName, request.command, request.reason);
      snapshot = simulator.snapshot();
      return result;
    },
    setFault: (fault, active) => {
      if (active) simulator.injectFault(fault);
      else simulator.clearFault(fault);
      snapshot = simulator.snapshot();
    },
  },
});
console.log(`Open ${web.url} to watch the plant and operate it.`);

process.on('SIGINT', () => {
  void Promise.all([server.stop(), web.stop()]).then(() => process.exit(0));
});
