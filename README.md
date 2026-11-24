# Batch plant simulator

A simulator of a small batch plant for learning and testing batch control as
ISA-88 (IEC 61512) describes it. One jacketed tank with its valves, pump,
agitator and transmitters, a control layer of control modules and phases,
and recipes that run as batches and leave a batch record. Faults can be
injected to see how the control layer and the batch respond. A later stage
exposes the plant over OPC UA, so other control and batch software can drive
it.

Work in progress. It is built from the standard's concepts and public
material only, with no vendor's names, screens or code.

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
pages into `dist/`. Each page is one self-contained HTML file that opens from
disk with no server or network.

The engine in `src/engine/` is type-checked on its own without the DOM or
Node's APIs, so it runs unchanged in the browser and, later, in Node.
