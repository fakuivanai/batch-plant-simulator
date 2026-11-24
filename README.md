# Batch plant simulator

A simulator of a small batch plant for learning and testing batch control as
ISA-88 (IEC 61512) describes it. One jacketed tank with its valves, pump,
agitator and transmitters, a control layer of control modules and phases,
and a recipe that runs as batches and leaves a batch record. Faults can be
injected to see how the control layer and the batch respond. Other software,
such as a batch engine, can drive the plant's phases over OPC UA.

It is built from the standard's concepts and public material only, with no
vendor's names, screens or code.

The simulator builds into standalone HTML pages that open from disk in a
browser, with no server or network. `index.html` is the simulator;
`documentation.html` explains each concept with exercises to try, and
`limitations.html` lists what the model simplifies.

## Cloning

The guidelines for coding agents come in as a submodule:

```sh
git clone --recurse-submodules <URL>
```

## Development

The build tools come from the Nix flake, pinned by `flake.lock`. Node.js 24
and pnpm are needed only for building, testing and serving; the built pages
need only a browser.

```sh
nix develop
pnpm install --frozen-lockfile
pnpm verify:light
```

`verify:light` type-checks the sources, runs the tests and builds the pages
into `dist/`. Each page is one self-contained HTML file.

## Serving over OPC UA

```sh
pnpm serve
```

This builds the pages, then runs the simulation in Node in real time and
serves it two ways, both on this machine only:

- an OPC UA server at `opc.tcp://localhost:4840`, with no encryption or
  sign-in, publishing unit T-200: its I/O, control modules, equipment module,
  phases and batch. Each phase has the command, state, parameter and
  watchdog values a batch engine uses to drive phase logic;
- the pages at `http://localhost:8080/`, where the simulator page shows the
  server's simulation, to watch, operate and inject faults while other
  software drives the phases.

`--port`, `--web-port`, `--host`, `--speed` and `--seed` change the
defaults. The server keeps its self-signed certificate in the per-user
state folder (`$XDG_STATE_HOME`, or `~/.local/state`), never in the
repository. The "How it works" page explains the address space and the
phase interface.

## How it is built

The engine in `src/engine/` is TypeScript with no DOM or Node APIs: it is
type-checked on its own without either, so the same code runs in the page
and in the server. The views in `src/view/` are Solid components in TSX. The
model never reads the wall clock: its owner calls `step` to advance it
100 ms of simulated time, so a test can replay a batch exactly.

| ISA-88 or control concept | Where |
| --- | --- |
| The plant: mass and energy balances, devices, transmitters, faults | `src/engine/process/` |
| The I/O image between the plant and the control system | `src/engine/io.ts` |
| Control modules: modes, value status, discrete devices, PID loop | `src/engine/physical-model/control-modules/` |
| Unit T-200 and its interlocks | `src/engine/physical-model/unit.ts`, `interlocks.ts` |
| Equipment module: the transfer | `src/engine/physical-model/transfer-module.ts` |
| The procedural state machine | `src/engine/procedural-model/state-machine.ts` |
| Phases, their logic, owners and watchdog | `src/engine/procedural-model/phase.ts`, `phases/` |
| Master recipe, formula and procedure | `src/engine/procedural-model/recipe.ts` |
| Batch | `src/engine/procedural-model/batch.ts` |
| Journal (audit trail) and alarms | `src/engine/record/` |
| Operator and outside-engine commands, the edge for outside input | `src/engine/simulator.ts` |
| OPC UA address space and phase interface | `src/server/address-space.ts`, `phase-interface.ts` |
| HTTP for an attached page, and its checks | `src/server/web-server.ts`, `parse-request.ts`, `src/remote/` |

The tests in `tests/engine/` pin behaviour: the plant's balances, each
control module's rules, each interlock in every mode, the state table
against the ISA-88 model, each phase and the batch, and, for every fault
that can be injected, what the control modules, the phase and a running
batch do about it. `tests/server/` runs real OPC UA and HTTP clients against
the servers. `tests/types/` holds code that must not compile, such as a
phase that leaves out a state's logic; the type check fails if it ever
does.
