/*
 * Pure evaluators for the Monitor tab's factory checklist ("Unit test").
 * Each one works over an array of already-parsed telemetry samples
 * (see monitor-parsers.ts), so the whole PASS/FAIL logic is unit-testable
 * in node: `node scripts/test-checklist.mjs`. The UI in monitor.tsx only
 * collects samples and renders the results.
 */

// step 1 (rest sanity)
export const QUIET_PP_MAX = 4 // max peak-to-peak per attenuverter at rest
export const PITCH_REST_MIN = 40 // sane P raw range at rest
export const PITCH_REST_MAX = 90

// steps 2-5 (full sweeps)
export const SWEEP_NEG = -120 // negative end every sweep must reach
export const SWEEP_POS = 120 // positive end every sweep must reach

// rail-collapse signature: a sample at/above the rail followed by a
// sudden drop while the stream keeps coming (a healthy pot never does this)
export const RAIL_HIGH = 115
export const RAIL_DROP = 30
export const RAIL_LOOKAHEAD = 3

// pitchRaw is null for samples coming from DBG_MOD lines (no P field there):
// when the firmware ships with DBG_CV disabled the pitch criterion is skipped
export type QuietSample = {
  ax: number
  ay: number
  az: number
  pitchRaw: number | null
}

export type QuietResult = {
  pass: boolean
  rest: { ax: number; ay: number; az: number; p: number | null }
  pp: { ax: number; ay: number; az: number }
  reasons: string[]
}

export type SweepResult = {
  pass: boolean
  min: number
  max: number
  negOk: boolean
  posOk: boolean
  collapseAt: number | null
  reasons: string[]
}

export type NoteChangeResult = {
  pass: boolean
  from: number | null
  to: number | null
}

const median = (vals: number[]): number => {
  const s = [...vals].sort((a, b) => a - b)
  return s[s.length >> 1]
}

const peakToPeak = (vals: number[]): number =>
  Math.max(...vals) - Math.min(...vals)

/*
 * Step 1: everything at rest for a few seconds.
 * PASS if each attenuverter moves at most QUIET_PP_MAX counts peak-to-peak
 * and the pitch ADC stays inside the sane rest window. Rest values are the
 * per-axis medians, recorded for the final report.
 */
export const evalQuiet = (samples: QuietSample[]): QuietResult => {
  if (samples.length === 0) {
    return {
      pass: false,
      rest: { ax: 0, ay: 0, az: 0, p: 0 },
      pp: { ax: 0, ay: 0, az: 0 },
      reasons: ['no telemetry (serial connected?)'],
    }
  }
  const ax = samples.map((s) => s.ax)
  const ay = samples.map((s) => s.ay)
  const az = samples.map((s) => s.az)
  const p = samples
    .map((s) => s.pitchRaw)
    .filter((v): v is number => v !== null)
  const pp = { ax: peakToPeak(ax), ay: peakToPeak(ay), az: peakToPeak(az) }
  const rest = {
    ax: median(ax),
    ay: median(ay),
    az: median(az),
    p: p.length > 0 ? median(p) : null,
  }
  const reasons: string[] = []
  for (const axis of ['ax', 'ay', 'az'] as const) {
    if (pp[axis] > QUIET_PP_MAX)
      reasons.push(
        `a${axis[1].toUpperCase()} restless: p2p ${pp[axis]} > ${QUIET_PP_MAX}`,
      )
  }
  if (p.length > 0) {
    const pMin = Math.min(...p)
    const pMax = Math.max(...p)
    if (pMin < PITCH_REST_MIN || pMax > PITCH_REST_MAX)
      reasons.push(
        `P rest ${pMin}..${pMax} outside ${PITCH_REST_MIN}..${PITCH_REST_MAX}`,
      )
  }
  return { pass: reasons.length === 0, rest, pp, reasons }
}

/*
 * rail-collapse detector: returns the index of the offending drop, or
 * null. A sample >= RAIL_HIGH followed within RAIL_LOOKAHEAD samples by a
 * drop > RAIL_DROP counts flags a worn pot — but only if more samples come
 * after the drop (a drop as the very last sample is inconclusive).
 */
export const detectRailCollapse = (values: number[]): number | null => {
  for (let i = 0; i < values.length; i++) {
    if (values[i] < RAIL_HIGH) continue
    const end = Math.min(i + RAIL_LOOKAHEAD, values.length - 1)
    for (let j = i + 1; j <= end; j++) {
      if (values[i] - values[j] > RAIL_DROP && j < values.length - 1) return j
    }
  }
  return null
}

/*
 * Steps 2-5: a full end-to-end sweep of one control (-128..127 domain).
 * PASS if both rails were reached and (for attenuverters) no rail-collapse
 * signature showed up. The main knob K skips the collapse check.
 */
export const evalSweep = (
  values: number[],
  checkCollapse = true,
): SweepResult => {
  if (values.length === 0) {
    return {
      pass: false,
      min: 0,
      max: 0,
      negOk: false,
      posOk: false,
      collapseAt: null,
      reasons: ['no telemetry (serial connected?)'],
    }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const negOk = min <= SWEEP_NEG
  const posOk = max >= SWEEP_POS
  const collapseAt = checkCollapse ? detectRailCollapse(values) : null
  const reasons: string[] = []
  if (!negOk)
    reasons.push(
      `did not reach negative end (min ${min}, need ≤${SWEEP_NEG})`,
    )
  if (!posOk)
    reasons.push(
      `did not reach positive end (max ${max}, need ≥${SWEEP_POS})`,
    )
  if (collapseAt !== null)
    reasons.push(`rail collapse at sample ${collapseAt}`)
  return {
    pass: reasons.length === 0,
    min,
    max,
    negOk,
    posOk,
    collapseAt,
    reasons,
  }
}

/*
 * Step 6: MIDI-in proof. PASS as soon as the telemetry note (N:) differs
 * from the first observed value. The caller seeds the stream with the note
 * seen before firing the test note.
 */
export const evalNoteChange = (notes: number[]): NoteChangeResult => {
  if (notes.length === 0) return { pass: false, from: null, to: null }
  const from = notes[0]
  for (let i = 1; i < notes.length; i++) {
    if (notes[i] !== from) return { pass: true, from, to: notes[i] }
  }
  return { pass: false, from, to: null }
}

// -- report helpers (also pure, also tested) --------------------------------

export const describeQuiet = (r: QuietResult): string => {
  const p = r.rest.p !== null ? `${r.rest.p}` : '— (no DBG_CV)'
  const base = `rest aX:${r.rest.ax} aY:${r.rest.ay} aZ:${r.rest.az} P:${p} | p2p ${r.pp.ax}/${r.pp.ay}/${r.pp.az}`
  return r.reasons.length === 0 ? base : `${base}; ${r.reasons.join('; ')}`
}

export const describeSweep = (r: SweepResult): string => {
  const base = `min:${r.min} max:${r.max}`
  return r.reasons.length === 0 ? base : `${base} — ${r.reasons.join('; ')}`
}

export type StepReport = { name: string; pass: boolean; detail: string }

export const formatReport = (
  steps: StepReport[],
  when: Date = new Date(),
): string => {
  const width = Math.max(...steps.map((s) => s.name.length))
  const failed = steps.filter((s) => !s.pass).length
  return [
    'CV2612 unit test',
    when.toISOString().replace('T', ' ').slice(0, 16),
    '----------------------------------------',
    ...steps.map(
      (s) =>
        `[${s.pass ? 'PASS' : 'FAIL'}] ${s.name.padEnd(width)}  ${s.detail}`,
    ),
    '----------------------------------------',
    failed === 0
      ? `RESULT: PASS (${steps.length}/${steps.length} steps OK)`
      : `RESULT: FAIL (${failed} of ${steps.length} steps failed)`,
  ].join('\n')
}
