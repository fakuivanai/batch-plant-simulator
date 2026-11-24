// The plant: tank T-200 with its piping and field devices, as physics. It
// knows nothing about control. Each step it takes the field outputs (what the
// control system is driving), moves the devices, integrates the mass and
// energy balances, and produces the field inputs (what the instruments report).
//
// The model is deliberately simple: one well-mixed tank, one well-mixed
// jacket, first-order lags, explicit Euler integration over the 100 ms step.
// Every time constant is tens of seconds or more, so the step is far too short
// for the integration to matter. The limitations page lists what is left out.

import type { FieldInputs, FieldOutputs, SignalRange } from '../io.ts';
import { fromMilliamps, namurNe43, signalRanges, toMilliamps } from '../io.ts';
import { NoiseSource } from '../noise.ts';
import { stepMilliseconds, stepSeconds } from '../time.ts';

/** Water near room temperature. */
const water = {
  densityKilogramsPerLiter: 1,
  specificHeatJoulesPerKilogramKelvin: 4186,
} as const;

/**
 * The plant's sizes and rates. The values are chosen to be plausible for a
 * small buffer-preparation tank and to make a batch take under an hour of
 * simulated time, not taken from a particular plant.
 */
export const plantParameters = {
  tankCapacityLiters: 1000,
  /** LSHH-201 sits at 90 % of capacity, which leaves the inlet a minute to close before an overflow. */
  highHighSwitchLiters: 900,
  inletFlowLitersPerMinute: 100,
  inletWaterCelsius: 15,
  pumpFlowLitersPerMinute: 150,
  /** Full stroke time of XV-201 and XV-202. Pneumatic on/off valves of this size take a few seconds. */
  valveStrokeSeconds: 4,
  /** Time between a starter's command changing and its auxiliary contact following. */
  motorFeedbackDelayMilliseconds: 500,
  ambientCelsius: 20,
  heatingMediumSupplyCelsius: 90,
  heatingMediumMaximumFlowLitersPerMinute: 60,
  jacketVolumeLiters: 50,
  jacketToContentsWattsPerKelvin: 1500,
  contentsToAmbientWattsPerKelvin: 20,
  /** About 300 kg of stainless steel at 500 J/(kg K). It keeps an empty tank's temperature finite. */
  vesselHeatCapacityJoulesPerKelvin: 150_000,
  /** The thermowell around TT-201's sensor slows its response. */
  temperatureSensorLagSeconds: 10,
  levelNoiseLiters: 0.5,
  temperatureNoiseCelsius: 0.05,
} as const;

/** What is really in and around the tank, as opposed to what the instruments report. */
export interface PlantSnapshot {
  readonly volumeLiters: number;
  readonly spilledLiters: number;
  readonly contentsCelsius: number;
  readonly jacketCelsius: number;
  readonly inflowLitersPerSecond: number;
  readonly outflowLitersPerSecond: number;
  /** 0 closed to 1 fully open. */
  readonly inletValvePosition: number;
  readonly outletValvePosition: number;
  readonly heatingValvePosition: number;
  readonly pumpRunning: boolean;
  readonly agitatorSpeedRpm: number;
}

/** A motor starter and its auxiliary contact: the feedback follows the command after a short delay. */
class MotorStarter {
  #running = false;
  #disagreementMilliseconds = 0;

  get running(): boolean {
    return this.#running;
  }

  step(energized: boolean): void {
    if (energized === this.#running) {
      this.#disagreementMilliseconds = 0;
      return;
    }
    this.#disagreementMilliseconds += stepMilliseconds;
    if (this.#disagreementMilliseconds >= plantParameters.motorFeedbackDelayMilliseconds) {
      this.#running = energized;
      this.#disagreementMilliseconds = 0;
    }
  }
}

/** An on/off valve's position moves toward its command at the stroke rate. */
function strokeValve(position: number, energized: boolean): number {
  const travel = stepSeconds / plantParameters.valveStrokeSeconds;
  return energized ? Math.min(1, position + travel) : Math.max(0, position - travel);
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

/** A transmitter's output saturates at the edges of NE 43's measurement band. */
function transmit(value: number, range: SignalRange): number {
  return clamp(toMilliamps(value, range), namurNe43.lowestMeasurementMilliamps, namurNe43.highestMeasurementMilliamps);
}

export class Plant {
  readonly #noise: NoiseSource;
  #volumeLiters = 0;
  #spilledLiters = 0;
  #contentsCelsius: number = plantParameters.ambientCelsius;
  #jacketCelsius: number = plantParameters.ambientCelsius;
  /** The temperature at TT-201's sensor, which lags the contents. */
  #sensorCelsius: number = plantParameters.ambientCelsius;
  #inletValvePosition = 0;
  #outletValvePosition = 0;
  #heatingValvePosition = 0;
  #inflowLitersPerSecond = 0;
  #outflowLitersPerSecond = 0;
  readonly #pump = new MotorStarter();
  readonly #agitator = new MotorStarter();
  #agitatorSpeedRpm = 0;
  #inputs: FieldInputs;

  constructor(seed: number) {
    this.#noise = new NoiseSource(seed);
    this.#inputs = this.#measure();
  }

  /** What the instruments report, as of the last step. */
  get inputs(): FieldInputs {
    return this.#inputs;
  }

  get snapshot(): PlantSnapshot {
    return {
      volumeLiters: this.#volumeLiters,
      spilledLiters: this.#spilledLiters,
      contentsCelsius: this.#contentsCelsius,
      jacketCelsius: this.#jacketCelsius,
      inflowLitersPerSecond: this.#inflowLitersPerSecond,
      outflowLitersPerSecond: this.#outflowLitersPerSecond,
      inletValvePosition: this.#inletValvePosition,
      outletValvePosition: this.#outletValvePosition,
      heatingValvePosition: this.#heatingValvePosition,
      pumpRunning: this.#pump.running,
      agitatorSpeedRpm: this.#agitatorSpeedRpm,
    };
  }

  step(outputs: FieldOutputs): void {
    this.#moveDevices(outputs);
    this.#integrate();
    this.#inputs = this.#measure();
  }

  #moveDevices(outputs: FieldOutputs): void {
    this.#inletValvePosition = strokeValve(this.#inletValvePosition, outputs['XV-201'].energized);
    this.#outletValvePosition = strokeValve(this.#outletValvePosition, outputs['XV-202'].energized);
    // TV-201 is a control valve with a positioner; its stroke is fast next to
    // the jacket's response, so the model takes its position as immediate.
    this.#heatingValvePosition = clamp((outputs['TV-201'].milliamps - 4) / 16, 0, 1);
    this.#pump.step(outputs['P-201'].energized);
    this.#agitator.step(outputs['AG-201'].energized);
    const speedReference = fromMilliamps(outputs['AG-201'].speedReferenceMilliamps, signalRanges['AG-201']);
    this.#agitatorSpeedRpm = this.#agitator.running
      ? clamp(speedReference, signalRanges['AG-201'].lower, signalRanges['AG-201'].upper)
      : 0;
  }

  #integrate(): void {
    const p = plantParameters;
    const joulesPerLiterKelvin = water.densityKilogramsPerLiter * water.specificHeatJoulesPerKilogramKelvin;

    // Mass balance. The pump can't move more water than the tank holds.
    this.#inflowLitersPerSecond = (p.inletFlowLitersPerMinute / 60) * this.#inletValvePosition;
    const pumpLitersPerSecond = this.#pump.running ? (p.pumpFlowLitersPerMinute / 60) * this.#outletValvePosition : 0;
    const availableLiters = this.#volumeLiters + this.#inflowLitersPerSecond * stepSeconds;
    this.#outflowLitersPerSecond = Math.min(pumpLitersPerSecond, availableLiters / stepSeconds);

    // Energy balance of the contents: heat from the jacket, loss to the room,
    // and the cold water coming in. The vessel's own heat capacity is lumped in.
    const contentsHeatCapacity = this.#volumeLiters * joulesPerLiterKelvin + p.vesselHeatCapacityJoulesPerKelvin;
    const jacketToContentsWatts = p.jacketToContentsWattsPerKelvin * (this.#jacketCelsius - this.#contentsCelsius);
    const lossWatts = p.contentsToAmbientWattsPerKelvin * (this.#contentsCelsius - p.ambientCelsius);
    const inflowWatts = this.#inflowLitersPerSecond * joulesPerLiterKelvin * (p.inletWaterCelsius - this.#contentsCelsius);
    const contentsCelsiusPerSecond = (jacketToContentsWatts - lossWatts + inflowWatts) / contentsHeatCapacity;

    // Energy balance of the jacket: heating medium flowing through, heat into the contents.
    const supplyCelsius = p.heatingMediumSupplyCelsius;
    const mediumLitersPerSecond = (p.heatingMediumMaximumFlowLitersPerMinute / 60) * this.#heatingValvePosition;
    const mediumWatts = mediumLitersPerSecond * joulesPerLiterKelvin * (supplyCelsius - this.#jacketCelsius);
    const jacketCelsiusPerSecond = (mediumWatts - jacketToContentsWatts) / (p.jacketVolumeLiters * joulesPerLiterKelvin);

    this.#contentsCelsius += contentsCelsiusPerSecond * stepSeconds;
    this.#jacketCelsius += jacketCelsiusPerSecond * stepSeconds;
    this.#sensorCelsius += ((this.#contentsCelsius - this.#sensorCelsius) * stepSeconds) / p.temperatureSensorLagSeconds;

    this.#volumeLiters += (this.#inflowLitersPerSecond - this.#outflowLitersPerSecond) * stepSeconds;
    if (this.#volumeLiters > p.tankCapacityLiters) {
      this.#spilledLiters += this.#volumeLiters - p.tankCapacityLiters;
      this.#volumeLiters = p.tankCapacityLiters;
    }
  }

  #measure(): FieldInputs {
    const p = plantParameters;
    const levelNoise = this.#noise.gaussian(p.levelNoiseLiters);
    const temperatureNoise = this.#noise.gaussian(p.temperatureNoiseCelsius);
    return {
      'XV-201': {
        openLimitSwitch: this.#inletValvePosition >= 1,
        closedLimitSwitch: this.#inletValvePosition <= 0,
      },
      'XV-202': {
        openLimitSwitch: this.#outletValvePosition >= 1,
        closedLimitSwitch: this.#outletValvePosition <= 0,
      },
      'P-201': { running: this.#pump.running },
      'AG-201': { running: this.#agitator.running },
      'LT-201': { milliamps: transmit(this.#volumeLiters + levelNoise, signalRanges['LT-201']) },
      'TT-201': { milliamps: transmit(this.#sensorCelsius + temperatureNoise, signalRanges['TT-201']) },
      'LSHH-201': { contactClosed: this.#volumeLiters < p.highHighSwitchLiters },
    };
  }
}

