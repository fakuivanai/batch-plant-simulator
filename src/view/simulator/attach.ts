// Attaching the page to a simulation that runs on the server (`pnpm serve`).
// The server streams updates; operator commands and faults go back to it.
// An outside batch engine may be driving the phases at the same time, over
// OPC UA, and the page shows it all as it happens.

import { createStore, reconcile } from 'solid-js/store';
import type { JournalEntry } from '../../engine/record/journal.ts';
import type { SimulatorSnapshot } from '../../engine/simulator.ts';
import { parseUpdate, paths, type FaultRequest, type OperateRequest, type OperateResponse } from '../../remote/protocol.ts';
import type { Runtime } from './runtime.ts';

async function post(path: string, body: OperateRequest | FaultRequest): Promise<Response> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`The server refused the request: ${response.status} ${await response.text()}`);
  return response;
}

/** Resolves once the first update has arrived, so the page has something to show. */
export function attachToServer(): Promise<Runtime> {
  return new Promise((resolve) => {
    const events = new EventSource(paths.events);
    let journal: readonly JournalEntry[] = [];
    let store: { view: SimulatorSnapshot; set: (snapshot: SimulatorSnapshot) => void } | null = null;
    const [clock, setClock] = createStore({ speed: 1, connected: true });

    events.onmessage = (message: MessageEvent<string>) => {
      const update = parseUpdate(message.data);
      // A new connection starts the journal again from 0; otherwise the
      // entries continue where the last update stopped.
      journal = [...journal.slice(0, update.journal.from), ...update.journal.entries];
      const snapshot: SimulatorSnapshot = { ...update.snapshot, journal };
      setClock({ speed: update.speed, connected: true });
      if (store !== null) {
        store.set(snapshot);
        return;
      }
      const [view, setView] = createStore<SimulatorSnapshot>(snapshot);
      store = { view, set: (next) => setView(reconcile(next)) };
      resolve({
        view,
        clock: {
          kind: 'server',
          get speed() {
            return clock.speed;
          },
          get connected() {
            return clock.connected;
          },
        },
        operate: async (operatorName, command, reason) => {
          const request: OperateRequest = reason === undefined ? { operatorName, command } : { operatorName, command, reason };
          // The server is the same build as this page and answers with the type both share.
          const response: OperateResponse = await (await post(paths.operate, request)).json();
          return response;
        },
        setFault: async (fault, active) => {
          await post(paths.faults, { fault, active });
        },
      });
    };
    // The browser reconnects by itself; until then the page says so.
    events.onerror = () => setClock('connected', false);
  });
}
