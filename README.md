# Batch plant simulator

A simulator of a small batch plant for learning and testing batch control as
ISA-88 (IEC 61512) describes it. One jacketed tank with its valves, pump,
agitator and transmitters, a control layer of control modules and phases,
and a recipe that runs as batches and leaves a batch record. Faults can be
injected to see how the control layer and the batch respond.

It is built from the standard's concepts and public material only, with no
vendor's names, screens or code.

The simulator builds into standalone HTML pages that open from disk in a
browser, with no server or network. `index.html` is the simulator;
`documentation.html` explains each concept with exercises to try, and
`limitations.html` lists what the model simplifies.

A later stage will expose the plant over OPC UA, so other control and batch
software can drive it.

## Cloning

The guidelines for coding agents come in as a submodule:

```sh
git clone --recurse-submodules <URL>
```

## Development

The build tools come from the Nix flake, pinned by `flake.lock`. Node.js 24
and pnpm are needed only for building and testing; the built pages need only
a browser.

```sh
nix develop
pnpm install --frozen-lockfile
pnpm verify:light
```

`verify:light` type-checks the sources, runs the unit tests and builds the
pages into `dist/`. Each page is one self-contained HTML file.

## How it is built

The engine in `src/engine/` is TypeScript with no DOM or Node APIs: it is
type-checked on its own without either, so it runs unchanged in the
browser and, later, in Node. The views in `src/view/` are Solid components
in TSX. The model never reads the wall clock: its owner calls `step` to
advance it 100 ms of simulated time, so a test can replay a batch exactly.

| ISA-88 or control concept | Where |
| --- | --- |
| The plant: mass and energy balances, devices, transmitters, faults | `src/engine/process/` |
| The I/O image between the plant and the control system | `src/engine/io.ts` |
| Control modules: modes, value status, discrete devices, PID loop | `src/engine/physical-model/control-modules/` |
| Unit T-200 and its interlocks | `src/engine/physical-model/unit.ts`, `interlocks.ts` |
| Equipment module: the transfer | `src/engine/physical-model/transfer-module.ts` |
| The procedural state machine | `src/engine/procedural-model/state-machine.ts` |
| Phases and their logic | `src/engine/procedural-model/phase.ts`, `phases/` |
| Master recipe, formula and procedure | `src/engine/procedural-model/recipe.ts` |
| Batch | `src/engine/procedural-model/batch.ts` |
| Journal (audit trail) and alarms | `src/engine/record/` |
| Operator commands, the edge where outside input enters | `src/engine/simulator.ts` |

The tests in `tests/engine/` pin behaviour: the plant's balances, each
control module's rules, each interlock in every mode, the state table
against the ISA-88 model, each phase and the batch, and, for every fault
that can be injected, what the control modules, the phase and a running
batch do about it. `tests/types/` holds code that must not compile, such as
a phase that leaves out a state's logic; the type check fails if it ever
does.
