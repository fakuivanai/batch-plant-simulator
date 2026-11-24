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
