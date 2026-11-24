// The ISA-88 state machine of a procedural element. The same machine runs a
// phase in the equipment and the procedure of a batch: every procedural
// element is IDLE until it is started, and every one can be held, restarted,
// stopped and aborted the same way. This follows the example state model in
// ISA-88 Part 1 (IEC 61512-1); control systems differ in the details, such as
// whether they offer PAUSE.

export const proceduralStates = [
  'IDLE',
  'RUNNING',
  'COMPLETE',
  'PAUSING',
  'PAUSED',
  'HOLDING',
  'HELD',
  'RESTARTING',
  'STOPPING',
  'STOPPED',
  'ABORTING',
  'ABORTED',
] as const;
export type ProceduralState = (typeof proceduralStates)[number];

export const proceduralCommands = ['START', 'PAUSE', 'RESUME', 'HOLD', 'RESTART', 'STOP', 'ABORT', 'RESET'] as const;
export type ProceduralCommand = (typeof proceduralCommands)[number];

/**
 * Which commands each state accepts, and the state each one leads to. This
 * table is the whole state model; everything else reads it.
 *
 * - START begins the element. RESET takes a finished one back to IDLE.
 * - PAUSE asks it to stop at its next pause point and wait; RESUME continues.
 * - HOLD brings the equipment to a safe pause it can resume from; RESTART
 *   resumes it.
 * - STOP ends it in an orderly way; there is no resuming.
 * - ABORT gets it safe as fast as possible; there is no resuming either.
 */
export const commandTransitions = {
  IDLE: { START: 'RUNNING' },
  RUNNING: { PAUSE: 'PAUSING', HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  PAUSING: { HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  PAUSED: { RESUME: 'RUNNING', HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  HOLDING: { STOP: 'STOPPING', ABORT: 'ABORTING' },
  HELD: { RESTART: 'RESTARTING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  RESTARTING: { HOLD: 'HOLDING', STOP: 'STOPPING', ABORT: 'ABORTING' },
  STOPPING: { ABORT: 'ABORTING' },
  ABORTING: {},
  COMPLETE: { RESET: 'IDLE' },
  STOPPED: { RESET: 'IDLE' },
  ABORTED: { RESET: 'IDLE' },
} as const satisfies { readonly [State in ProceduralState]: Partial<Record<ProceduralCommand, ProceduralState>> };

/**
 * The states in which an element runs logic of its own, and where each goes
 * when that logic is done. The states in between (IDLE, PAUSED, HELD and the
 * final ones) only wait for a command. PAUSING runs the RUNNING logic up to a
 * pause point, so it has no logic of its own.
 */
export const logicDoneTransitions = {
  RUNNING: 'COMPLETE',
  HOLDING: 'HELD',
  RESTARTING: 'RUNNING',
  STOPPING: 'STOPPED',
  ABORTING: 'ABORTED',
} as const satisfies Partial<Record<ProceduralState, ProceduralState>>;

export type LogicState = keyof typeof logicDoneTransitions;

export const logicStates: readonly LogicState[] = ['RUNNING', 'HOLDING', 'RESTARTING', 'STOPPING', 'ABORTING'];

/** The state a command leads to, or null if the state doesn't accept it. */
export function stateAfterCommand(state: ProceduralState, command: ProceduralCommand): ProceduralState | null {
  const transitions: Partial<Record<ProceduralCommand, ProceduralState>> = commandTransitions[state];
  return transitions[command] ?? null;
}

export function acceptedCommands(state: ProceduralState): readonly ProceduralCommand[] {
  return proceduralCommands.filter((command) => stateAfterCommand(state, command) !== null);
}

/** The states that the failure monitor watches: those where the equipment is working toward the goal. */
export function isMonitored(state: ProceduralState): boolean {
  return state === 'RUNNING' || state === 'PAUSING' || state === 'PAUSED' || state === 'RESTARTING';
}

/** The final states, which only RESET leaves. */
export function isFinal(state: ProceduralState): boolean {
  return state === 'COMPLETE' || state === 'STOPPED' || state === 'ABORTED';
}
