# Instructions for coding agents

Follow [the shared guidelines](external/clankerlib/guidelines.md), and read
the quoted directions as well as each rule. clankerlib has no rules or
libraries for this repository's language yet, so carry the general rules over
by their intent, and when one doesn't fit, say so instead of bending it. If
`external/clankerlib` is empty, run `git submodule update --init`.

## What this repository is

A simulator of a small batch plant, modelled on ISA-88 (IEC 61512): the
physical model (unit, equipment modules, control modules), the procedural
model (procedure, unit procedures, operations, phases) and the phase state
machine. It is also a teaching tool, so the code should read as an
explanation of those concepts.

## Rules

- Use the ISA-88 term for an ISA-88 concept, in the code and on screen.
- No vendor's product names, screen designs or code. The concepts come from
  the standard and public material.
- The model advances by a fixed step on a simulated clock that the caller
  owns, never on the wall clock, so a test can replay a batch exactly.
- Every fault that can be injected has a test that pins what the control
  layer does about it.
