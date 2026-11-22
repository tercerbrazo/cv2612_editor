/*
 * Pure logic for the Monitor's guided "Calibration mode" wizard. It drives the
 * operator through capturing the rests AND verifying the module end-to-end, and
 * every decision here is side-effect free and unit-testable in node:
 * `node scripts/test-cal-wizard.mjs`. The React view in monitor.tsx feeds it
 * live telemetry and sends the MIDI; it owns no DOM and no timers.
 *
 * Why a separate verify from the "Unit test" checklist: that checklist sweeps
 * the attenuverter READING (ax/ay/az) and passes when the pot reaches its rail.
 * A jack that reads "connected" with no cable turns the trimmer into an
 * attenuverter over a near-rest CV, so the pot still reaches its rail while the
 * EFFECTIVE modulation (modY/modZ) stays compressed — the module detunes a few
 * semitones instead of the full octave. The sweep steps below measure modY/modZ,
 * the thing the ear hears, not the pot position.
 */
import {
  centsEffectSeen,
  evalPrecheck,
  type PrecheckResult,
  type RestSample,
} from './monitor-calibration.ts'

export { centsEffectSeen }

// An attenuverter within this many counts of 0 counts as "centered". Capturing
// the rests also stores the trimmer centers, so an off-center trimmer bakes a
// wrong center into calibration — hence a gate the rest panel does not have.
export const TRIM_CENTER_TOL = 12

// modY/modZ are signed -128..127; the firmware maps that full range to ±96 CV
// (±1 octave). "Reached the octave" is judged by the swept span WIDTH, not by
// hitting fixed ±ends: a healthy pot that rests a little off-center still has a
// wide span, so a width test avoids false-negatives that an ends test would
// give. A falsely-connected jack caps the width far below this — the symptom
// this step exists to catch.
export const OCTAVE_SPAN_MIN = 190 // of the 255-count full range
export const MOD_PER_SEMITONE = 128 / 12 // ≈10.67 mod counts per semitone

// final tuning check: a held reference note should land within this of ET.
export const TUNING_TOL_CENTS = 15

// one telemetry sample for the wizard: the rest-panel fields plus the
// attenuverter readings and the effective mods the sweep steps measure.
export type WizSample = RestSample & {
  ax: number
  ay: number
  az: number
  modY: number
  modZ: number
}

export type CapturePrecheck = Omit<PrecheckResult, 'latest'> & {
  latest: WizSample | null // narrowed: the wizard feeds WizSamples
  centered: boolean // all three trimmers within TRIM_CENTER_TOL of center
  readyToCapture: boolean // precheck ready AND centered
}

/*
 * Pre-conditions for capturing the rests: the rest-panel checks (jacks out,
 * everything quiet). "centered" is computed for display but is ADVISORY: the
 * firmware clamps the stored trimmer centers, and a tolerance guessed without
 * hardware must not block a remote operator from capturing, so it is not part
 * of readyToCapture.
 */
export const evalCapturePrecheck = (
  samples: WizSample[],
  now: number,
): CapturePrecheck => {
  const base = evalPrecheck(samples, now)
  const latest = base.latest as WizSample | null
  const centered =
    latest !== null &&
    Math.abs(latest.ax) <= TRIM_CENTER_TOL &&
    Math.abs(latest.ay) <= TRIM_CENTER_TOL &&
    Math.abs(latest.az) <= TRIM_CENTER_TOL
  return { ...base, latest, centered, readyToCapture: base.ready }
}

// ---------------------------------------------------------------------------
// sweep span tracker — accumulates the min/max of a signal while the operator
// turns one trimmer, so we can tell whether the EFFECT reached the octave.
// ---------------------------------------------------------------------------
export type Span = { min: number; max: number; n: number }

export const emptySpan = (): Span => ({ min: Infinity, max: -Infinity, n: 0 })

export const trackSpan = (s: Span, v: number): Span => ({
  min: Math.min(s.min, v),
  max: Math.max(s.max, v),
  n: s.n + 1,
})

export const spanWidth = (s: Span): number => (s.n === 0 ? 0 : s.max - s.min)

// the reachable detune in semitones at the span ends, for display
export const spanSemitones = (s: Span): { lo: number; hi: number } =>
  s.n === 0
    ? { lo: 0, hi: 0 }
    : { lo: s.min / MOD_PER_SEMITONE, hi: s.max / MOD_PER_SEMITONE }

/*
 * Did the swept mod reach the full ±octave? The span must be wide enough AND
 * straddle zero (a bipolar attenuverter sweeps through its center): the sign
 * check rejects a one-sided sweep that a width test alone would pass.
 */
export const reachedOctave = (s: Span): boolean =>
  s.n > 0 && spanWidth(s) >= OCTAVE_SPAN_MIN && s.min < 0 && s.max > 0

// ---------------------------------------------------------------------------
// active jack test — confirms detection works in BOTH directions by watching
// the operator plug and unplug. A flag that is merely "disconnected now" could
// be a dead input; seeing it toggle proves the detection is alive.
// ---------------------------------------------------------------------------
export type JackProbe = { sawConnected: boolean; sawDisconnected: boolean }

export const emptyJackProbe = (): JackProbe => ({
  sawConnected: false,
  sawDisconnected: false,
})

export const observeJack = (p: JackProbe, connected: boolean): JackProbe => ({
  sawConnected: p.sawConnected || connected,
  sawDisconnected: p.sawDisconnected || !connected,
})

export const jackProbeOk = (p: JackProbe): boolean =>
  p.sawConnected && p.sawDisconnected

// ---------------------------------------------------------------------------
// tuning — a held reference note should be within tolerance of equal temperament
// ---------------------------------------------------------------------------
export const inTune = (
  cents: number | null,
  tol: number = TUNING_TOL_CENTS,
): boolean => cents !== null && Math.abs(cents) <= tol

// ---------------------------------------------------------------------------
// step metadata — single source for the wizard's sequence, titles and the
// one-line instruction each step shows. The component renders these and owns
// the per-step live evaluation; keeping the list here keeps the PDF manual and
// the UI in step (same order, same count).
// ---------------------------------------------------------------------------
export type WizStepId =
  | 'prepare'
  | 'capture'
  | 'jacks'
  | 'sweepY'
  | 'sweepZ'
  | 'tuning'
  | 'done'

export type WizStep = {
  id: WizStepId
  title: string
  hint: string
}

export const WIZARD_STEPS: WizStep[] = [
  {
    id: 'prepare',
    title: 'Preparar',
    hint: 'Desenchufá los 4 CV, centrá los 3 trimmers y dejá todo quieto.',
  },
  {
    id: 'capture',
    title: 'Capturar reposo',
    hint: 'Captura reposos + centros de trimmer a EEPROM.',
  },
  {
    id: 'jacks',
    title: 'Jack detection',
    hint: 'Enchufá y sacá un cable (con señal) en X, Y y Z: el flag debe cambiar.',
  },
  {
    id: 'sweepY',
    title: 'Rango Y (DUO)',
    hint: 'Girá el trimmer Y a fondo: el intervalo debe llegar a ±1 octava.',
  },
  {
    id: 'sweepZ',
    title: 'Rango Z (TRIO)',
    hint: 'Girá el trimmer Z a fondo: el intervalo debe llegar a ±1 octava.',
  },
  {
    id: 'tuning',
    title: 'Afinación',
    hint: 'Tocá A4 (nota 69): debe dar 440 Hz (±15 cents).',
  },
  { id: 'done', title: 'Listo', hint: 'Resumen de la verificación.' },
]
