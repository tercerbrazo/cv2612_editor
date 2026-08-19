/*
 * Tests for the factory checklist evaluators ("unit test").
 * Run with: node scripts/test-checklist.mjs
 * (Node >= 22.18 strips the TS types of the imported module natively.)
 */
import assert from 'node:assert/strict'
import {
  detectRailCollapse,
  evalNoteChange,
  evalQuiet,
  evalSweep,
  formatReport,
} from '../src/monitor-checklist.ts'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

// synthetic sample builders --------------------------------------------------
const quietSamples = (n, { ax = -2, ay = 0, az = 1, p = 62, jitter = 1 } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    ax: ax + (i % 3 === 0 ? jitter : 0),
    ay: ay + (i % 4 === 0 ? -jitter : 0),
    az: az + (i % 5 === 0 ? jitter : 0),
    pitchRaw: p + (i % 2 === 0 ? jitter : 0),
  }))

// a smooth full sweep: -128 → 127 → -128 in steps small enough (8/sample)
// to never look like a rail collapse
const smoothSweep = (lo = -128, hi = 127) => {
  const up = []
  for (let v = lo; v < hi; v += 8) up.push(v)
  up.push(hi)
  return [...up, ...[...up].reverse()]
}

// --- evalQuiet ---------------------------------------------------------------
check('quiet: PASS with steady controls and sane pitch rest', () => {
  const r = evalQuiet(quietSamples(50))
  assert.equal(r.pass, true)
  assert.equal(r.reasons.length, 0)
  assert.equal(r.rest.ax, -2)
  assert.equal(r.rest.ay, 0)
  assert.equal(r.rest.az, 1)
  assert.ok(r.rest.p >= 62 && r.rest.p <= 63)
  assert.ok(r.pp.ax <= 4 && r.pp.ay <= 4 && r.pp.az <= 4)
})

check('quiet: FAIL when an attenuverter is restless (p2p > 4)', () => {
  const samples = quietSamples(50)
  samples[10].ax = 10
  samples[20].ax = -10
  const r = evalQuiet(samples)
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some((s) => s.includes('aX')))
})

check('quiet: FAIL when pitch rest is out of the sane window', () => {
  const r = evalQuiet(quietSamples(50, { p: 500 }))
  assert.equal(r.pass, false)
  assert.ok(r.reasons.some((s) => s.includes('P rest')))
})

check('quiet: pitch criterion skipped when DBG_CV is off (pitchRaw null)', () => {
  const samples = quietSamples(30).map((s) => ({ ...s, pitchRaw: null }))
  const r = evalQuiet(samples)
  assert.equal(r.pass, true)
  assert.equal(r.rest.p, null)
})

check('quiet: FAIL on empty stream', () => {
  const r = evalQuiet([])
  assert.equal(r.pass, false)
  assert.ok(r.reasons[0].includes('no telemetry'))
})

// --- detectRailCollapse (rail-collapse signature) --------------------------------------
check('collapse: ramp to 127 then sudden ~55 garbage is detected', () => {
  const v = [...smoothSweep().slice(0, 33), 55, 58, 52, 60, 40, 20, 0]
  const at = detectRailCollapse(v)
  assert.notEqual(at, null)
  assert.ok(v[at] <= 61, `collapsed sample was ${v[at]}`)
})

check('collapse: smooth full sweep is NOT flagged', () => {
  assert.equal(detectRailCollapse(smoothSweep()), null)
})

check('collapse: a drop as the very last sample is inconclusive', () => {
  // "while more samples keep coming": no samples after the drop → no flag
  const v = [100, 110, 120, 127, 55]
  assert.equal(detectRailCollapse(v), null)
})

check('collapse: drop more than 3 samples after the rail is NOT the signature', () => {
  const v = [120, 118, 116, 114, 112, 110, 55, 50, 45]
  // 120→..., the >30 drop lands 6 samples after the last ≥115 sample? no:
  // 116 is ≥115 and 55 is 4 samples later — outside the 3-sample lookahead
  assert.equal(detectRailCollapse(v), null)
})

// --- evalSweep -----------------------------------------------------------------
check('sweep: PASS on a full smooth sweep', () => {
  const r = evalSweep(smoothSweep())
  assert.equal(r.pass, true)
  assert.equal(r.min, -128)
  assert.equal(r.max, 127)
  assert.equal(r.collapseAt, null)
})

check('sweep: FAIL when the negative end is not reached', () => {
  const r = evalSweep(smoothSweep(-100, 127))
  assert.equal(r.pass, false)
  assert.equal(r.negOk, false)
  assert.equal(r.posOk, true)
  assert.ok(r.reasons.some((s) => s.includes('negative end')))
})

check('sweep: FAIL when the positive end is not reached', () => {
  const r = evalSweep(smoothSweep(-128, 100))
  assert.equal(r.pass, false)
  assert.equal(r.negOk, true)
  assert.equal(r.posOk, false)
  assert.ok(r.reasons.some((s) => s.includes('positive end')))
})

check('sweep: FAIL on the rail collapse even with full range', () => {
  const v = [...smoothSweep(), 127, 55, 58, 52, 0, -60, -128]
  const r = evalSweep(v)
  assert.equal(r.pass, false)
  assert.notEqual(r.collapseAt, null)
  assert.ok(r.reasons.some((s) => s.includes('rail collapse')))
})

check('sweep: main knob K skips the collapse check', () => {
  const v = [...smoothSweep(), 127, 55, 58, 52, 0, -60, -128]
  const r = evalSweep(v, false)
  assert.equal(r.pass, true)
  assert.equal(r.collapseAt, null)
})

check('sweep: FAIL on empty stream', () => {
  const r = evalSweep([])
  assert.equal(r.pass, false)
  assert.ok(r.reasons[0].includes('no telemetry'))
})

// --- evalNoteChange ---------------------------------------------------------
check('note: PASS when N changes after the baseline', () => {
  const r = evalNoteChange([0, 0, 0, 57, 57])
  assert.equal(r.pass, true)
  assert.equal(r.from, 0)
  assert.equal(r.to, 57)
})

check('note: FAIL when N never changes', () => {
  const r = evalNoteChange([57, 57, 57])
  assert.equal(r.pass, false)
  assert.equal(r.from, 57)
  assert.equal(r.to, null)
})

check('note: FAIL on empty stream', () => {
  const r = evalNoteChange([])
  assert.equal(r.pass, false)
  assert.equal(r.from, null)
})

// --- formatReport -------------------------------------------------------------
check('report: PASS summary and per-step lines', () => {
  const text = formatReport(
    [
      { name: 'Rest', pass: true, detail: 'rest aX:-2 aY:0 aZ:1 P:62' },
      { name: 'Trimmer X', pass: true, detail: 'min:-128 max:127' },
    ],
    new Date('2026-07-25T12:00:00Z'),
  )
  assert.ok(text.includes('CV2612 unit test'))
  assert.ok(text.includes('2026-07-25 12:00'))
  assert.ok(text.includes('[PASS] Rest'))
  assert.ok(text.includes('[PASS] Trimmer X'))
  assert.ok(text.includes('RESULT: PASS (2/2 steps OK)'))
})

check('report: FAIL summary counts failed steps', () => {
  const text = formatReport([
    { name: 'Rest', pass: true, detail: 'ok' },
    { name: 'Trimmer Y', pass: false, detail: 'min:-90, did not reach' },
  ])
  assert.ok(text.includes('[FAIL] Trimmer Y'))
  assert.ok(text.includes('RESULT: FAIL (1 of 2 steps failed)'))
})

console.log(`\n${passed} checks passed`)
