/*
 * Smoke test for the Monitor tab's serial-line parsers.
 * Run with: node scripts/test-monitor-parser.mjs
 * (Node >= 22.18 strips the TS types of the imported module natively.)
 */
import assert from 'node:assert/strict'
import { parseLine } from '../src/monitor-parsers.ts'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

// --- DBG_CV line -----------------------------------------------------------
check('DBG_CV line parses to all fields', () => {
  const p = parseLine(
    '12345 [MONO] N:45 P:62(0.6V d:12) T:64 tu:64 C:12 CV:276 PB:0 F:319024 | X:135* Y:134. Z:134. | K:41 aX:-7 aY:0 aZ:-18 | mod:-128,0,0,-18 CC:1 | RGB:18,18,0',
  )
  assert.equal(p.type, 'cv')
  assert.equal(p.t, 12345)
  assert.equal(p.mode, 'MONO')
  assert.equal(p.note, 45)
  assert.equal(p.pitchRaw, 62)
  assert.equal(p.pitchVolts, 0.6)
  assert.equal(p.pitchDev, 12)
  assert.equal(p.transpose, 64)
  assert.equal(p.tuning, 64)
  assert.equal(p.c, 12)
  assert.equal(p.cv, 276)
  assert.equal(p.pb, 0)
  assert.equal(p.f, 319024)
  assert.equal(p.x, 135)
  assert.equal(p.xConn, true)
  assert.equal(p.y, 134)
  assert.equal(p.yConn, false)
  assert.equal(p.z, 134)
  assert.equal(p.zConn, false)
  assert.equal(p.k, 41)
  assert.equal(p.ax, -7)
  assert.equal(p.ay, 0)
  assert.equal(p.az, -18)
  assert.equal(p.modW, -128)
  assert.equal(p.modX, 0)
  assert.equal(p.modY, 0)
  assert.equal(p.modZ, -18)
  assert.equal(p.ccMask, 1)
  assert.deepEqual(p.rgb, [18, 18, 0])
})

check('DBG_CV without the optional CC field', () => {
  const p = parseLine(
    '999 [POLY] N:60 P:512(-1.2V d:-3) T:64 tu:70 C:0 CV:640 PB:-100 F:12800 | X:0. Y:255* Z:128. | K:-128 aX:127 aY:-128 aZ:0 | mod:0,10,-10,127 | RGB:0,255,64',
  )
  assert.equal(p.type, 'cv')
  assert.equal(p.mode, 'POLY')
  assert.equal(p.pitchVolts, -1.2)
  assert.equal(p.pb, -100)
  assert.equal(p.yConn, true)
  assert.equal(p.ccMask, null)
  assert.deepEqual(p.rgb, [0, 255, 64])
})

// --- DBG_MOD line ----------------------------------------------------------
check('DBG_MOD line parses', () => {
  const p = parseLine(
    '12345 MOD w:43 x:-24 ax:28 ay:127 az:-128 K:127 raw:41* mm:2 TL0:18 TL3:18',
  )
  assert.equal(p.type, 'mod')
  assert.equal(p.t, 12345)
  assert.equal(p.w, 43)
  assert.equal(p.x, -24)
  assert.equal(p.ax, 28)
  assert.equal(p.ay, 127)
  assert.equal(p.az, -128)
  assert.equal(p.k, 127)
  assert.equal(p.raw, 41)
  assert.equal(p.rawConn, true)
  assert.equal(p.mm, 2)
  assert.equal(p.tl0, 18)
  assert.equal(p.tl3, 18)
})

// --- PATCH line ------------------------------------------------------------
check('PATCH TL dump parses to 4 pairs', () => {
  const p = parseLine('PATCH TL0/TL3: 28/15 58/45 88/75 118/105')
  assert.equal(p.type, 'patch')
  assert.deepEqual(p.pairs, [
    [28, 15],
    [58, 45],
    [88, 75],
    [118, 105],
  ])
})

// --- heartbeat line --------------------------------------------------------
check('heartbeat line parses', () => {
  const p = parseLine('12345 heartbeat loop:1127/s')
  assert.equal(p.type, 'heartbeat')
  assert.equal(p.t, 12345)
  assert.equal(p.loopRate, 1127)
})

// --- tolerance: truncated / garbled / unknown lines ------------------------
check('truncated DBG_CV falls back to raw', () => {
  const p = parseLine('12345 [MONO] N:45 P:62(0.')
  assert.equal(p.type, 'raw')
  assert.equal(p.text, '12345 [MONO] N:45 P:62(0.')
})

check('garbled MOD falls back to raw', () => {
  const p = parseLine('345 MOD w:4x:-24 ax:?? K')
  assert.equal(p.type, 'raw')
})

check('unknown text is passed through verbatim', () => {
  const p = parseLine('EEPROM saved ok')
  assert.equal(p.type, 'raw')
  assert.equal(p.text, 'EEPROM saved ok')
})

check('empty and CR-only lines return null', () => {
  assert.equal(parseLine(''), null)
  assert.equal(parseLine('\r'), null)
  assert.equal(parseLine('   '), null)
})

console.log(`\n${passed} checks passed`)
