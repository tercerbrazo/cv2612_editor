/*
 * Tests for the guided Calibration-mode wizard pure logic.
 * Run with: node scripts/test-cal-wizard.mjs
 */
import assert from 'node:assert/strict'
import {
  emptyJackProbe,
  emptySpan,
  evalCapturePrecheck,
  inTune,
  jackProbeOk,
  observeJack,
  OCTAVE_SPAN_MIN,
  reachedOctave,
  spanSemitones,
  spanWidth,
  trackSpan,
  TRIM_CENTER_TOL,
  TUNING_TOL_CENTS,
  WIZARD_STEPS,
} from '../src/monitor-cal-wizard.ts'
import { STABILITY_WINDOW_MS } from '../src/monitor-calibration.ts'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const NOW = 100000
// n quiet, jacks-out, centered samples ending at NOW inside the stability window
const wizSamples = (n, over = {}) =>
  Array.from({ length: n }, (_, i) => ({
    rt: NOW - ((n - 1 - i) * STABILITY_WINDOW_MS) / Math.max(1, n),
    pitchRaw: 62,
    x: 128,
    y: 128,
    z: 128,
    xConn: false,
    yConn: false,
    zConn: false,
    ax: 0,
    ay: 0,
    az: 0,
    modY: 0,
    modZ: 0,
    ...(typeof over === 'function' ? over(i) : over),
  }))

// --- evalCapturePrecheck -----------------------------------------------------
check('capture precheck: green when quiet, jacks out, trimmers centered', () => {
  const r = evalCapturePrecheck(wizSamples(20), NOW)
  assert.equal(r.ready, true) // base precheck ready
  assert.equal(r.centered, true)
  assert.equal(r.readyToCapture, true)
})

check('capture precheck: off-center trimmer is flagged but does NOT block', () => {
  const r = evalCapturePrecheck(
    wizSamples(20, (i) => ({ ay: i === 19 ? TRIM_CENTER_TOL + 1 : 0 })),
    NOW,
  )
  assert.equal(r.centered, false) // advisory flag is raised
  assert.equal(r.readyToCapture, true) // but centering does not gate capture
})

check('capture precheck: trimmer exactly at the tolerance still centered', () => {
  const r = evalCapturePrecheck(wizSamples(20, { ax: TRIM_CENTER_TOL }), NOW)
  assert.equal(r.centered, true)
  assert.equal(r.readyToCapture, true)
})

check('capture precheck: a connected jack still blocks (inherited)', () => {
  const r = evalCapturePrecheck(
    wizSamples(20, (i) => ({ zConn: i === 19 })),
    NOW,
  )
  assert.equal(r.jacksOk, false)
  assert.equal(r.readyToCapture, false)
})

// --- span tracker + reachedOctave -------------------------------------------
check('span: empty has zero width and no octave', () => {
  const s = emptySpan()
  assert.equal(spanWidth(s), 0)
  assert.equal(reachedOctave(s), false)
})

check('span: a healthy full sweep reaches the octave', () => {
  let s = emptySpan()
  for (const v of [0, -60, -124, 30, 121, -118]) s = trackSpan(s, v)
  assert.equal(s.min, -124)
  assert.equal(s.max, 121)
  assert.equal(reachedOctave(s), true)
})

check('span: a compressed sweep (false-connected Y) does NOT reach octave', () => {
  // the few-semitone symptom: modY only spans ~±50
  let s = emptySpan()
  for (const v of [0, -48, 51, -50, 49]) s = trackSpan(s, v)
  assert.ok(spanWidth(s) < OCTAVE_SPAN_MIN)
  assert.equal(reachedOctave(s), false)
})

check('span: a healthy but off-center sweep still reaches octave', () => {
  // the reason the test is width-based: an off-center pot (-70..+127) has a
  // full-width span and must pass, where a fixed ±end test would reject it
  let s = emptySpan()
  for (const v of [-70, 0, 127, -40]) s = trackSpan(s, v)
  assert.ok(spanWidth(s) >= OCTAVE_SPAN_MIN)
  assert.equal(reachedOctave(s), true)
})

check('span: a one-sided sweep (never crosses zero) is rejected', () => {
  let s = emptySpan()
  for (const v of [10, 60, 127]) s = trackSpan(s, v)
  assert.equal(reachedOctave(s), false) // too narrow / never went negative
})

check('span: semitone readout at the ends', () => {
  let s = emptySpan()
  s = trackSpan(s, -128)
  s = trackSpan(s, 127)
  const { lo, hi } = spanSemitones(s)
  assert.ok(lo <= -11.9 && lo >= -12.1) // -128 → ≈ -12 semitones
  assert.ok(hi >= 11.8 && hi <= 12.0)
})

// --- active jack probe -------------------------------------------------------
check('jack probe: needs BOTH a connect and a disconnect', () => {
  let p = emptyJackProbe()
  p = observeJack(p, false)
  assert.equal(jackProbeOk(p), false) // only ever disconnected
  p = observeJack(p, true)
  assert.equal(jackProbeOk(p), true) // now saw both
})

check('jack probe: staying connected the whole time is not enough', () => {
  let p = emptyJackProbe()
  for (let i = 0; i < 5; i++) p = observeJack(p, true)
  assert.equal(jackProbeOk(p), false)
})

// --- tuning ------------------------------------------------------------------
check('tuning: within tolerance passes, beyond fails, unknown fails', () => {
  assert.equal(inTune(0), true)
  assert.equal(inTune(TUNING_TOL_CENTS), true)
  assert.equal(inTune(TUNING_TOL_CENTS + 1), false)
  assert.equal(inTune(-TUNING_TOL_CENTS - 1), false)
  assert.equal(inTune(null), false)
})

// --- step metadata -----------------------------------------------------------
check('steps: ordered, unique, start at prepare and end at done', () => {
  const ids = WIZARD_STEPS.map((s) => s.id)
  assert.equal(ids[0], 'prepare')
  assert.equal(ids[ids.length - 1], 'done')
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('sweepY') && ids.includes('sweepZ'))
})

console.log(`\n${passed} checks passed`)
