import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import { Simulator, type SimulatorSnapshot } from '../../src/engine/simulator.ts';
import { paths, protocolVersion, type Update } from '../../src/remote/protocol.ts';
import { startWebServer, type RunningWebServer } from '../../src/server/web-server.ts';

let server: RunningWebServer | undefined;
let simulator: Simulator;
let snapshot: SimulatorSnapshot;
let base: string;

before(async () => {
  simulator = new Simulator(1);
  snapshot = simulator.snapshot();
  const port = 49152 + Math.floor(Math.random() * 10000);
  server = await startWebServer({
    host: '127.0.0.1',
    port,
    pagesFolder: 'a folder with no pages in it',
    simulation: {
      snapshot: () => snapshot,
      speed: 1,
      operate: (body) => {
        const result = simulator.operate(body.operatorName, body.command, body.reason);
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
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await server?.stop();
});

function post(path: string, body: unknown, contentType = 'application/json'): Promise<Response> {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify(body) });
}

test('an operator command posted to the server reaches the simulation and comes back with its result', async () => {
  const response = await post(paths.operate, { operatorName: 'A', command: { kind: 'set-device-mode', module: 'XV-201', mode: 'MANUAL' } });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(simulator.unit.inletValve.mode, 'MANUAL');
  const refused = await post(paths.operate, { operatorName: 'A', command: { kind: 'set-loop-setpoint', value: 37 } });
  assert.deepEqual(await refused.json(), { ok: false, error: 'MODE_REFUSES_ACTOR' });
});

test('the server takes commands only as JSON, only well formed, and only when addressed to it by name', async () => {
  const command = { operatorName: 'A', command: { kind: 'set-device-mode', module: 'XV-201', mode: 'CASCADE' } };
  assert.equal((await post(paths.operate, command, 'text/plain')).status, 415);
  assert.equal((await post(paths.operate, { operatorName: 'A', command: { kind: 'nonsense' } })).status, 400);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const sent = request(`${base}${paths.operate}`, { method: 'POST', headers: { Host: 'attacker.example', 'Content-Type': 'application/json' } });
    sent.on('response', (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    sent.on('error', reject);
    sent.end(JSON.stringify(command));
  });
  assert.equal(status, 403);
  assert.equal(simulator.unit.inletValve.mode, 'MANUAL', 'none of the refused requests changed anything');
});

test('an attached page gets the whole journal in its first update and only new entries after that', async () => {
  const controller = new AbortController();
  const response = await fetch(base + paths.events, { signal: controller.signal });
  assert.ok(response.body !== null);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  const next = async (): Promise<Update> => {
    while (!buffered.includes('\n\n')) {
      const chunk = await reader.read();
      assert.ok(!chunk.done, 'the stream ended');
      buffered += chunk.value;
    }
    const [message, ...rest] = buffered.split('\n\n');
    buffered = rest.join('\n\n');
    return JSON.parse((message ?? '').replace(/^data: /, ''));
  };
  const first = await next();
  assert.equal(first.protocol, protocolVersion);
  assert.deepEqual([first.journal.from, first.journal.entries.length], [0, simulator.snapshot().journal.length]);
  await post(paths.faults, { fault: 'pump-fails-to-start', active: true });
  await post(paths.operate, { operatorName: 'A', command: { kind: 'set-device-mode', module: 'P-201', mode: 'MANUAL' } });
  const second = await next();
  assert.equal(second.journal.from, first.journal.entries.length);
  assert.deepEqual(second.journal.entries.map((entry) => entry.event.kind), ['mode-changed']);
  assert.deepEqual(second.snapshot.activeFaults, ['pump-fails-to-start']);
  controller.abort();
});

test('the server sends a browser opening it to the simulator page, attached', async () => {
  const response = await fetch(`${base}/`, { redirect: 'manual' });
  assert.deepEqual([response.status, response.headers.get('location')], [302, '/index.html?attach']);
});
