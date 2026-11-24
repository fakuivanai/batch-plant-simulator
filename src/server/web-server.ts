// The web side of the server: it serves the built pages and lets the
// simulator page attach to the simulation running here, so you can watch the
// plant and inject faults while an outside batch engine drives it. It listens
// on the same host as the OPC UA server, localhost unless told otherwise.

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { FaultKind } from '../engine/process/faults.ts';
import type { SimulatorSnapshot } from '../engine/simulator.ts';
import { paths, protocolVersion, type OperateRequest, type OperateResponse, type Update } from '../remote/protocol.ts';
import { pages } from '../view/pages.ts';
import { parseFaultRequest, parseOperateRequest } from './parse-request.ts';

export interface WebSimulation {
  /** The latest snapshot. A new object whenever the simulation has changed. */
  readonly snapshot: () => SimulatorSnapshot;
  readonly speed: number;
  readonly operate: (request: OperateRequest) => OperateResponse;
  readonly setFault: (fault: FaultKind, active: boolean) => void;
}

export interface WebServerOptions {
  readonly host: string;
  readonly port: number;
  /** The folder the build writes the pages to. */
  readonly pagesFolder: string;
  readonly simulation: WebSimulation;
}

export interface RunningWebServer {
  readonly url: string;
  stop(): Promise<void>;
}

/** How often an attached page gets an update: often enough to look live, at most once per two steps. */
const updateIntervalMilliseconds = 200;

/** Requests carry a command or a fault, a few hundred bytes. Anything far larger isn't one. */
const largestBodyBytes = 64 * 1024;

export async function startWebServer(options: WebServerOptions): Promise<RunningWebServer> {
  const streams = new Set<ServerResponse>();
  const allowedHosts = new Set([`localhost:${options.port}`, `127.0.0.1:${options.port}`, `${options.host}:${options.port}`]);

  const server = createServer((request, response) => {
    // A page from some other site could otherwise reach this server through
    // the browser, by a cross-site request or by rebinding a name to
    // 127.0.0.1. Only requests addressed to this server by name are served.
    if (!allowedHosts.has(request.headers.host ?? '')) {
      respond(response, 403, 'text/plain', 'This server only answers requests addressed to it on this machine.');
      return;
    }
    void route(request, response, options, streams);
  });

  const timer = setInterval(() => {
    for (const stream of streams) sendUpdate(stream, options.simulation);
  }, updateIntervalMilliseconds);

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  return {
    url: `http://${options.host === '127.0.0.1' ? 'localhost' : options.host}:${options.port}/`,
    stop: async () => {
      clearInterval(timer);
      for (const stream of streams) stream.end();
      const closed = new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      // A browser keeps idle connections open; without this, stopping waits for them to time out.
      server.closeAllConnections();
      await closed;
    },
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: WebServerOptions,
  streams: Set<ServerResponse>,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://server.invalid');
  const line = `${request.method} ${url.pathname}`;
  if (line === 'GET /') {
    // The simulator page attaches to this server when it is opened with ?attach.
    response.writeHead(302, { Location: '/index.html?attach' }).end();
    return;
  }
  if (line === `GET ${paths.events}`) {
    openStream(response, options.simulation, streams);
    return;
  }
  if (line === `POST ${paths.operate}`) {
    const body = await readJson(request, response);
    if (body === undefined) return;
    const parsed = parseOperateRequest(body);
    if (parsed === null) {
      respond(response, 400, 'text/plain', 'Not an operator command.');
      return;
    }
    respond(response, 200, 'application/json', JSON.stringify(options.simulation.operate(parsed)));
    return;
  }
  if (line === `POST ${paths.faults}`) {
    const body = await readJson(request, response);
    if (body === undefined) return;
    const parsed = parseFaultRequest(body);
    if (parsed === null) {
      respond(response, 400, 'text/plain', 'Not a fault.');
      return;
    }
    options.simulation.setFault(parsed.fault, parsed.active);
    response.writeHead(204).end();
    return;
  }
  const page = pages.find((candidate) => `GET /${candidate.file}` === line);
  if (page !== undefined) {
    await servePage(response, path.join(options.pagesFolder, page.file));
    return;
  }
  respond(response, 404, 'text/plain', 'Not found.');
}

async function servePage(response: ServerResponse, file: string): Promise<void> {
  try {
    respond(response, 200, 'text/html; charset=utf-8', await readFile(file, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    respond(response, 503, 'text/plain', 'The pages are not built yet. Run pnpm build, then reload.');
  }
}

/**
 * Reads a JSON body, or answers the request itself and returns undefined. A
 * JSON content type is required: a browser won't send one across sites
 * without asking this server first, which it never allows.
 */
async function readJson(request: IncomingMessage, response: ServerResponse): Promise<unknown> {
  if (request.headers['content-type'] !== 'application/json') {
    respond(response, 415, 'text/plain', 'Send JSON.');
    return undefined;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) throw new Error('Invariant broken: a request body arrives as buffers');
    size += chunk.length;
    if (size > largestBodyBytes) {
      respond(response, 413, 'text/plain', 'Too large.');
      return undefined;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    respond(response, 400, 'text/plain', 'Not JSON.');
    return undefined;
  }
}

function respond(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(body);
}

/** What each open stream has been sent so far. */
const sent = new WeakMap<ServerResponse, { snapshot: SimulatorSnapshot | null; journalLength: number }>();

function openStream(response: ServerResponse, simulation: WebSimulation, streams: Set<ServerResponse>): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  sent.set(response, { snapshot: null, journalLength: 0 });
  streams.add(response);
  response.on('close', () => streams.delete(response));
  sendUpdate(response, simulation);
}

function sendUpdate(stream: ServerResponse, simulation: WebSimulation): void {
  const previous = sent.get(stream);
  if (previous === undefined) return;
  const snapshot = simulation.snapshot();
  if (snapshot === previous.snapshot) return;
  const { journal, ...rest } = snapshot;
  const update: Update = {
    protocol: protocolVersion,
    speed: simulation.speed,
    snapshot: rest,
    journal: { from: previous.journalLength, entries: journal.slice(previous.journalLength) },
  };
  stream.write(`data: ${JSON.stringify(update)}\n\n`);
  sent.set(stream, { snapshot, journalLength: journal.length });
}
