// Unit T-200 in the ISA-88 physical model. A unit is equipment that carries
// out one or more major processing activities on a batch, here preparing a
// buffer in one tank. It contains control modules (and, from the next stage,
// an equipment module), and it is where the interlocks between them are
// wired.
//
// Each scan has three parts: the modules read their inputs, the interlocks are
// evaluated from what was read, then (after the phases have run) the modules
// write their outputs.

import type { FieldInputs, FieldOutputs } from '../io.ts';
import { signalRanges } from '../io.ts';
import type { AlarmCondition } from '../record/alarms.ts';
import type { Recorder } from '../record/journal.ts';
import { AnalogInput, type AnalogInputSnapshot } from './control-modules/analog-input.ts';
import {
  DiscreteDevice,
  motorFeedback,
  valveFeedback,
  type DiscreteDeviceSnapshot,
} from './control-modules/discrete-device.ts';
import { LevelSwitch, type LevelSwitchSnapshot } from './control-modules/level-switch.ts';
import { PidLoop, type PidLoopSnapshot } from './control-modules/pid-loop.ts';
import { VariableSpeedDrive, type VariableSpeedDriveSnapshot } from './control-modules/variable-speed-drive.ts';
import { highHighTemperatureCelsius, minimumLevelLiters, type InterlockId } from './interlocks.ts';

/** A valve strokes in 4 s; 10 s allows a slow stroke and still catches a stuck one quickly. */
const valveFeedbackTimeoutMilliseconds = 10_000;
/** A starter's contact follows in half a second; 3 s allows for a slow contactor. */
const motorFeedbackTimeoutMilliseconds = 3_000;

export interface UnitSnapshot {
  readonly 'XV-201': DiscreteDeviceSnapshot;
  readonly 'XV-202': DiscreteDeviceSnapshot;
  readonly 'P-201': DiscreteDeviceSnapshot;
  readonly 'AG-201': VariableSpeedDriveSnapshot;
  readonly 'LT-201': AnalogInputSnapshot;
  readonly 'LSHH-201': LevelSwitchSnapshot;
  readonly 'TIC-201': PidLoopSnapshot;
}

export type DiscreteDeviceTag = 'XV-201' | 'XV-202' | 'P-201' | 'AG-201';

export class UnitT200 {
  readonly name = 'T-200';
  readonly inletValve: DiscreteDevice;
  readonly outletValve: DiscreteDevice;
  readonly transferPump: DiscreteDevice;
  readonly agitator: VariableSpeedDrive;
  readonly level: AnalogInput;
  readonly highHighLevel: LevelSwitch;
  readonly temperature: PidLoop;

  constructor(recorder: Recorder) {
    this.inletValve = new DiscreteDevice(
      { tag: 'XV-201', description: 'Water inlet valve', kind: 'valve', feedbackTimeoutMilliseconds: valveFeedbackTimeoutMilliseconds },
      recorder,
    );
    this.outletValve = new DiscreteDevice(
      { tag: 'XV-202', description: 'Outlet valve', kind: 'valve', feedbackTimeoutMilliseconds: valveFeedbackTimeoutMilliseconds },
      recorder,
    );
    this.transferPump = new DiscreteDevice(
      { tag: 'P-201', description: 'Transfer pump', kind: 'motor', feedbackTimeoutMilliseconds: motorFeedbackTimeoutMilliseconds },
      recorder,
    );
    this.agitator = new VariableSpeedDrive(
      {
        tag: 'AG-201',
        description: 'Agitator',
        kind: 'motor',
        feedbackTimeoutMilliseconds: motorFeedbackTimeoutMilliseconds,
        speedRange: signalRanges['AG-201'],
      },
      recorder,
    );
    this.level = new AnalogInput(
      { tag: 'LT-201', description: 'Tank level', range: signalRanges['LT-201'], unit: 'L' },
      recorder,
    );
    this.highHighLevel = new LevelSwitch('LSHH-201', 'High-high level switch');
    this.temperature = new PidLoop(
      {
        tag: 'TIC-201',
        description: 'Tank temperature control',
        transmitterTag: 'TT-201',
        valveTag: 'TV-201',
        range: signalRanges['TT-201'],
        unit: '°C',
        // Tuned on the model: a fast, nearly integrating process (a small jacket,
        // a 10 s sensor lag) takes a high gain. With this tuning the temperature
        // overshoots a step to any recipe setpoint by under 2 °C.
        gainPercentPerUnit: 100,
        integralTimeSeconds: 600,
        setpointLimits: { lower: 0, upper: 90 },
        highDeviationLimit: 2.5,
      },
      recorder,
    );
  }

  /** Every discrete device by its tag, for the operator's commands. */
  discreteDevice(tag: DiscreteDeviceTag): DiscreteDevice {
    switch (tag) {
      case 'XV-201':
        return this.inletValve;
      case 'XV-202':
        return this.outletValve;
      case 'P-201':
        return this.transferPump;
      case 'AG-201':
        return this.agitator;
    }
  }

  readInputs(inputs: FieldInputs): void {
    this.inletValve.readFeedback(valveFeedback(inputs['XV-201']));
    this.outletValve.readFeedback(valveFeedback(inputs['XV-202']));
    this.transferPump.readFeedback(motorFeedback(inputs['P-201']));
    this.agitator.readFeedback(motorFeedback(inputs['AG-201']));
    this.level.readSignal(inputs['LT-201']);
    this.highHighLevel.readContact(inputs['LSHH-201']);
    this.temperature.readSignal(inputs['TT-201']);
    this.#applyInterlocks();
  }

  #applyInterlocks(): void {
    const level = this.level.processValue;
    const temperature = this.temperature.processValue;
    const levelBelowMinimum = level.status !== 'GOOD' || level.value < minimumLevelLiters;
    const temperatureHighHigh = temperature.status !== 'GOOD' || temperature.value >= highHighTemperatureCelsius;
    const active = (entries: readonly (readonly [InterlockId, boolean])[]): InterlockId[] =>
      entries.filter(([, tripped]) => tripped).map(([id]) => id);

    this.inletValve.setInterlocks(active([['LSHH-201 high-high level', this.highHighLevel.tripped]]));
    this.transferPump.setInterlocks(active([['XV-202 not open', !this.outletValve.confirmedActive]]));
    this.agitator.setInterlocks(active([['Level below minimum', levelBelowMinimum]]));
    this.temperature.setInterlocks(
      active([
        ['Level below minimum', levelBelowMinimum],
        ['TT-201 high-high temperature', temperatureHighHigh],
      ]),
    );
  }

  writeOutputs(): FieldOutputs {
    this.inletValve.writeOutput();
    this.outletValve.writeOutput();
    this.transferPump.writeOutput();
    this.agitator.writeOutput();
    this.temperature.writeOutput();
    return {
      'XV-201': { energized: this.inletValve.output },
      'XV-202': { energized: this.outletValve.output },
      'P-201': { energized: this.transferPump.output },
      'AG-201': { energized: this.agitator.output, speedReferenceMilliamps: this.agitator.speedReferenceMilliamps },
      'TV-201': { milliamps: this.temperature.outputMilliamps },
    };
  }

  get alarmConditions(): readonly AlarmCondition[] {
    return [
      ...this.inletValve.alarmConditions,
      ...this.outletValve.alarmConditions,
      ...this.transferPump.alarmConditions,
      ...this.agitator.alarmConditions,
      ...this.level.alarmConditions,
      ...this.highHighLevel.alarmConditions,
      ...this.temperature.alarmConditions,
      ...this.#highHighTemperatureAlarm(),
    ];
  }

  // The trip on a BAD measurement already alarms as a signal failure, so this
  // alarm is for a real high-high temperature only.
  #highHighTemperatureAlarm(): readonly AlarmCondition[] {
    const temperature = this.temperature.processValue;
    const tripped = temperature.status === 'GOOD' && temperature.value >= highHighTemperatureCelsius;
    return tripped ? [{ module: 'TT-201', condition: 'high-high temperature', priority: 'HIGH' }] : [];
  }

  get snapshot(): UnitSnapshot {
    return {
      'XV-201': this.inletValve.snapshot,
      'XV-202': this.outletValve.snapshot,
      'P-201': this.transferPump.snapshot,
      'AG-201': this.agitator.snapshot,
      'LT-201': this.level.snapshot,
      'LSHH-201': this.highHighLevel.snapshot,
      'TIC-201': this.temperature.snapshot,
    };
  }
}
