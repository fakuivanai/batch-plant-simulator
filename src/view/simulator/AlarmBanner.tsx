// The alarm list along the top of the screen. Unacknowledged alarms come
// first; an alarm that has cleared but isn't acknowledged stays, greyed, until
// someone acknowledges it.

import { For, Show, type JSX } from 'solid-js';
import type { Alarm } from '../../engine/record/alarms.ts';
import { formatClock } from '../format.ts';
import type { OperatorSession } from './operator-session.ts';

const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export function AlarmBanner(props: { alarms: readonly Alarm[]; session: OperatorSession }): JSX.Element {
  const sorted = () =>
    [...props.alarms].sort(
      (first, second) =>
        Number(first.acknowledged) - Number(second.acknowledged) ||
        priorityOrder[first.priority] - priorityOrder[second.priority] ||
        first.raisedAtMilliseconds - second.raisedAtMilliseconds,
    );
  return (
    <section class="alarms" aria-label="Alarms">
      <Show when={props.alarms.length > 0} fallback={<p class="no-alarms">No alarms</p>}>
        <ul>
          <For each={sorted()}>
            {(alarm) => (
              <li classList={{ unacknowledged: !alarm.acknowledged, cleared: !alarm.active, [alarm.priority.toLowerCase()]: true }}>
                <span class="priority">{alarm.priority}</span>
                <span class="time">{formatClock(alarm.raisedAtMilliseconds)}</span>
                <span class="text">
                  {alarm.id}
                  {alarm.active ? '' : ' (cleared)'}
                </span>
                <Show when={!alarm.acknowledged}>
                  <button type="button" onClick={() => props.session.operate({ kind: 'acknowledge-alarm', alarm: alarm.id })}>
                    Acknowledge
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
