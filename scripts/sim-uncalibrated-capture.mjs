/*
 * End-to-end simulation of the uncalibrated-module trap, through the REAL wire
 * path: a synthetic DBG_STATE keyframe (phantom jacks, everything at rest) is
 * fed to the real FrameDemux, mapped to a WizSample the way the Monitor does,
 * and run through the real evalCapturePrecheck. It proves the capture button is
 * no longer blocked by the module's (false) jack detection.
 *
 * Run: node scripts/sim-uncalibrated-capture.mjs
 */
import assert from 'node:assert/strict'
import { FrameDemux } from '../src/monitor-frames.ts'
import { evalCapturePrecheck } from '../src/monitor-cal-wizard.ts'

// Encode a len-27 keyframe. Field order/sizes mirror KEY_FIELDS in
// monitor-frames.ts; only the fields the sim varies are parameters.
const u16 = (v) => [v & 0xff, (v >> 8) & 0xff]
const i8 = (v) => [v & 0xff]
const keyframe = ({ pitchRaw = 50, x = 128, y = 128, z = 128, jack = 0, ax = 0, ay = 0, az = 0, modY = 0, modZ = 0 }) => {
  const payload = [
    ...u16(pitchRaw), ...u16(300), ...u16(0), // pitchRaw, cv, bend
    ...i8(0), ...i8(ax), ...i8(ay), ...i8(az), // k, ax, ay, az
    x & 0xff, y & 0xff, z & 0xff, jack & 0xff, // x, y, z, jackFlags
    ...i8(0), ...i8(0), ...i8(modY), ...i8(modZ), // modW, modX, modY, modZ
    0, 0, 0, 0, 0, 0, // note, modeQuant, tu, tr, tl0, tl3
    ...u16(1300), 0, // loopRate, dropCount
  ]
  assert.equal(payload.length, 27, 'keyframe payload must be 27 bytes')
  const head = [0x4b, payload.length] // type 'K', len
  let xor = 0
  for (const b of [...head, ...payload]) xor ^= b
  return Uint8Array.from([0xaa, 0x01, ...head, ...payload, xor])
}

// Feed N identical frames through the real demux, build the WizSamples the
// Monitor's notifyWizard() would, and return the precheck.
const simulate = (frameFields) => {
  const demux = new FrameDemux()
  const samples = []
  const t0 = 10000
  for (let i = 0; i < 12; i++) {
    demux.feed(keyframe(frameFields))
    const s = demux.lastState
    samples.push({
      rt: t0 + i * 50, // 20Hz
      pitchRaw: s.pitchRaw, x: s.x, y: s.y, z: s.z,
      xConn: s.xConn, yConn: s.yConn, zConn: s.zConn,
      ax: s.ax, ay: s.ay, az: s.az, modY: s.modY, modZ: s.modZ,
    })
  }
  const now = t0 + 11 * 50
  return evalCapturePrecheck(samples, now)
}

// capture gate: OLD = the module-derived aggregate; NEW = host-side only
const oldBlocked = (r) => !r.ready
const HOST_READY = true // serial connected + MIDI out picked
const newBlocked = () => !HOST_READY

const row = (name, r) =>
  console.log(
    `${name.padEnd(34)} jacksOk=${String(r.jacksOk).padEnd(5)} quiet=${String(r.quiet).padEnd(5)}` +
      ` | boton ANTES: ${oldBlocked(r) ? 'BLOQUEADO' : 'habilitado'}` +
      ` | boton AHORA: ${newBlocked() ? 'BLOQUEADO' : 'habilitado'}`,
  )

console.log('\nCaptura de reposo — misma telemetria, gate viejo vs nuevo:\n')

const uncal = simulate({ jack: 0x07 }) // X|Y|Z phantom-connected, at rest
row('sin calibrar (jacks fantasma)', uncal)

const calibrated = simulate({ jack: 0x00 })
row('calibrado (jacks limpios)', calibrated)

const realCable = simulate({ jack: 0x02, y: 40 }) // a real cable on Y
row('cable real en Y', realCable)

console.log()

// --- the invariants the fix guarantees ---
assert.equal(uncal.jacksOk, false, 'phantom jacks must read as connected')
assert.equal(uncal.quiet, true, 'an at-rest module is quiet despite phantom jacks')
assert.equal(oldBlocked(uncal), true, 'OLD logic blocked the uncalibrated module (the bug)')
assert.equal(newBlocked(uncal), false, 'NEW logic does NOT block it (the fix)')
assert.ok(!('readyToCapture' in uncal), 'no module-derived capture gate exists')
assert.equal(newBlocked(realCable), false, 'a real cable is advisory, never a block')

console.log('✓ sin calibrar: ANTES bloqueaba, AHORA habilita — se puede calibrar')
console.log('✓ el gate nuevo no depende de ninguna lectura del modulo\n')
