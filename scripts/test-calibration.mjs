/*
 * Tests for the rest-calibration pre-check helpers ("Rest calibration").
 * Run with: node scripts/test-calibration.mjs
 * (Node >= 22.18 strips the TS types of the imported module natively.)
 */
import assert from 'node:assert/strict'
import {
  CAPTURE_RESTS_VALUE,
  centsEffectSeen,
  EFFECT_CENTS_MIN,
  evalPrecheck,
  STABILITY_MIN_SAMPLES,
  STABILITY_PP_MAX,
  STABILITY_WINDOW_MS,
} from '../src/monitor-calibration.ts'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

// synthetic sample builder: n samples ending at t=now, evenly spaced inside
// the stability window, all jacks disconnected and everything quiet
const NOW = 100000
const restSamples = (n, over = {}) =>
  Array.from({ length: n }, (_, i) => ({
    rt: NOW - ((n - 1 - i) * STABILITY_WINDOW_MS) / Math.max(1, n),
    pitchRaw: 62,
    x: 128,
    y: 128,
    z: 128,
    xConn: false,
    yConn: false,
    zConn: false,
    ...(typeof over === 'function' ? over(i) : over),
  }))

// --- protocol constant -------------------------------------------------------
check('protocol: capture-all-rests is SET_CALIBRATION_STEP value 9', () => {
  assert.equal(CAPTURE_RESTS_VALUE, 9)
})

// --- evalPrecheck ------------------------------------------------------------
check('precheck: all green with quiet signals and no jacks', () => {
  const r = evalPrecheck(restSamples(20), NOW)
  assert.equal(r.hasData, true)
  assert.equal(r.enough, true)
  assert.equal(r.jacksOk, true)
  assert.equal(r.pitchStable, true)
  assert.equal(r.xStable && r.yStable && r.zStable, true)
  assert.equal(r.ready, true)
  assert.deepEqual(r.pp, { pitch: 0, x: 0, y: 0, z: 0 })
  assert.equal(r.latest.pitchRaw, 62)
})

check('precheck: no data at all', () => {
  const r = evalPrecheck([], NOW)
  assert.equal(r.hasData, false)
  assert.equal(r.ready, false)
  assert.equal(r.pp, null)
  assert.equal(r.latest, null)
})

check('precheck: samples older than the window are ignored', () => {
  const stale = restSamples(20).map((s) => ({
    ...s,
    rt: s.rt - STABILITY_WINDOW_MS - 5000,
  }))
  const r = evalPrecheck(stale, NOW)
  assert.equal(r.hasData, false)
  assert.equal(r.ready, false)
})

check(
  'precheck: a connected jack blocks readiness (latest sample wins)',
  () => {
    const samples = restSamples(20, (i) => ({ yConn: i === 19 }))
    const r = evalPrecheck(samples, NOW)
    assert.equal(r.jacksOk, false)
    assert.equal(r.ready, false)
    // stability itself is still fine — only the jack condition is red
    assert.equal(r.pitchStable, true)
  },
)

check(
  'precheck: jack bit on an OLD sample does not block (already unplugged)',
  () => {
    const samples = restSamples(20, (i) => ({ xConn: i === 0 }))
    const r = evalPrecheck(samples, NOW)
    assert.equal(r.jacksOk, true)
  },
)

check('precheck: pitch drift beyond pp max is not stable', () => {
  const samples = restSamples(20, (i) => ({
    pitchRaw: 62 + (i % 2 === 0 ? STABILITY_PP_MAX + 1 : 0),
  }))
  const r = evalPrecheck(samples, NOW)
  assert.equal(r.pitchStable, false)
  assert.equal(r.ready, false)
  assert.equal(r.pp.pitch, STABILITY_PP_MAX + 1)
})

check('precheck: pp exactly at the max still counts as stable', () => {
  const samples = restSamples(20, (i) => ({
    z: 128 + (i % 2 === 0 ? STABILITY_PP_MAX : 0),
  }))
  const r = evalPrecheck(samples, NOW)
  assert.equal(r.zStable, true)
  assert.equal(r.ready, true)
})

check('precheck: one restless mod input blocks readiness', () => {
  const samples = restSamples(20, (i) => ({ x: 128 + (i % 5) * 3 }))
  const r = evalPrecheck(samples, NOW)
  assert.equal(r.xStable, false)
  assert.equal(r.yStable && r.zStable, true)
  assert.equal(r.ready, false)
})

check('precheck: too few samples cannot claim stability', () => {
  const r = evalPrecheck(restSamples(STABILITY_MIN_SAMPLES - 1), NOW)
  assert.equal(r.hasData, true)
  assert.equal(r.enough, false)
  assert.equal(r.pitchStable, false)
  assert.equal(r.ready, false)
})

// --- centsEffectSeen ---------------------------------------------------------
check('effect: a big cents collapse counts (+163c → +2c)', () => {
  assert.equal(centsEffectSeen(163, 2), true)
})

check('effect: sub-threshold jitter does not count', () => {
  assert.equal(centsEffectSeen(163, 163 + EFFECT_CENTS_MIN - 1), false)
})

check('effect: unknown before/after never counts', () => {
  assert.equal(centsEffectSeen(null, 0), false)
  assert.equal(centsEffectSeen(163, null), false)
  assert.equal(centsEffectSeen(null, null), false)
})

console.log(`\n${passed} checks passed`)
