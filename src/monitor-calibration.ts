/*
 * Pure helpers for the Monitor tab's rest-calibration panel
 * ("Rest calibration"). The panel guides the operator through
 * capturing the module's resting levels (pitch + X/Y/Z + trimmer centers):
 * the module block-averages all inputs (~60ms) and persists the rests to
 * EEPROM when it receives SET_CALIBRATION_STEP (CC 113 on channel 15) with
 * value 9. Everything here is side-effect free and unit-testable in node:
 * `node scripts/test-calibration.mjs`. The UI in monitor.tsx only collects
 * telemetry samples and renders the results.
 */

// SET_CALIBRATION_STEP payload for "capture all rests at once" (steps 0-8
// are the legacy per-point guided calibration)
export const CAPTURE_RESTS_VALUE = 9

// pre-check: every watched signal must stay within STABILITY_PP_MAX counts
// peak-to-peak over the last STABILITY_WINDOW_MS before capturing
export const STABILITY_WINDOW_MS = 2000
export const STABILITY_PP_MAX = 2
// enough samples to actually claim stability over the window (state frames
// arrive at ~20Hz, DBG_CV lines slower — 8 covers both without stalling)
export const STABILITY_MIN_SAMPLES = 8

// after sending the capture command: how long to wait for the voices-strip
// cents to move before showing the "no effect seen" hint, and the minimum
// cents change that counts as the firmware applying the new rests
export const EFFECT_TIMEOUT_MS = 3000
export const EFFECT_CENTS_MIN = 2

// one telemetry sample, from either a DBG_CV line or a DBG_STATE frame
export type RestSample = {
  rt: number // arrival time (performance.now() domain)
  pitchRaw: number // pitch ADC raw 0..1023
  x: number // mod CV inputs 0..255 (calibrated domain)
  y: number
  z: number
  xConn: boolean // jack detection bits
  yConn: boolean
  zConn: boolean
}

export type PrecheckResult = {
  hasData: boolean // any sample inside the window
  enough: boolean // >= STABILITY_MIN_SAMPLES in the window
  jacksOk: boolean // all three jack bits clear on the latest sample
  pitchStable: boolean
  xStable: boolean
  yStable: boolean
  zStable: boolean
  ready: boolean // all of the above → safe to capture
  // window peak-to-peak per signal (null without data), for display
  pp: { pitch: number; x: number; y: number; z: number } | null
  latest: RestSample | null
}

const peakToPeak = (vals: number[]): number =>
  Math.max(...vals) - Math.min(...vals)

/*
 * Evaluate the capture pre-conditions over the samples inside the stability
 * window: all jacks disconnected (latest sample) and pitch/X/Y/Z quiet
 * (peak-to-peak <= STABILITY_PP_MAX). Stability is only claimed once the
 * window holds STABILITY_MIN_SAMPLES samples — a lone sample is trivially
 * "stable" but proves nothing.
 */
export const evalPrecheck = (
  samples: RestSample[],
  now: number,
): PrecheckResult => {
  const win = samples.filter((s) => now - s.rt <= STABILITY_WINDOW_MS)
  if (win.length === 0) {
    return {
      hasData: false,
      enough: false,
      jacksOk: false,
      pitchStable: false,
      xStable: false,
      yStable: false,
      zStable: false,
      ready: false,
      pp: null,
      latest: null,
    }
  }
  const latest = win[win.length - 1]
  const jacksOk = !latest.xConn && !latest.yConn && !latest.zConn
  const enough = win.length >= STABILITY_MIN_SAMPLES
  const pp = {
    pitch: peakToPeak(win.map((s) => s.pitchRaw)),
    x: peakToPeak(win.map((s) => s.x)),
    y: peakToPeak(win.map((s) => s.y)),
    z: peakToPeak(win.map((s) => s.z)),
  }
  const pitchStable = enough && pp.pitch <= STABILITY_PP_MAX
  const xStable = enough && pp.x <= STABILITY_PP_MAX
  const yStable = enough && pp.y <= STABILITY_PP_MAX
  const zStable = enough && pp.z <= STABILITY_PP_MAX
  return {
    hasData: true,
    enough,
    jacksOk,
    pitchStable,
    xStable,
    yStable,
    zStable,
    ready: jacksOk && pitchStable && xStable && yStable && zStable,
    pp,
    latest,
  }
}

/*
 * Did the firmware visibly apply the new rests? The voices-strip cents
 * offset should move (collapse toward ~0) once the calibrated rest enters
 * the pitch math. A change below EFFECT_CENTS_MIN is indistinguishable from
 * jitter; unknown values (no voices telemetry) never count as an effect.
 */
export const centsEffectSeen = (
  before: number | null,
  current: number | null,
): boolean =>
  before !== null &&
  current !== null &&
  Math.abs(current - before) >= EFFECT_CENTS_MIN
