import { Snapshot } from 'valtio'

const SAMPLE_RATE = 44100

function secondsToSamples(sec: number) {
  return Math.floor(sec * SAMPLE_RATE)
}

function midiToFreq(note: number) {
  return 440 * Math.pow(2, (note - 69) / 12)
}

function freqToYM(freq: number) {
  let block = 4
  let f = freq

  // normalize into ~A4 octave
  while (f >= 880) {
    f /= 2
    block++
  }
  while (f < 440) {
    f *= 2
    block--
  }

  if (block < 0) block = 0
  if (block > 7) block = 7

  // high-resolution fnum
  let fnum = Math.round((f * 1024) / 440)

  if (fnum > 0x7ff) fnum = 0x7ff

  return { fnum, block }
}

function createVGM() {
  const data = []
  const w = (...b) => data.push(...b)

  const api = {
    writeReg(addr: number, val: number, port = 0) {
      w(port ? 0x53 : 0x52, addr, val)
    },

    wait(samples: number) {
      w(0x61, samples & 0xff, samples >> 8)
    },

    keyOn() {
      w(0x52, 0x28, 0xf0 | 0)
    },

    keyOff() {
      w(0x52, 0x28, 0)
    },

    note(midiNote: number, dur: number) {
      const freq = midiToFreq(midiNote)
      const { fnum, block } = freqToYM(freq)

      this.writeReg(0xa4, (block << 3) | (fnum >> 8))
      this.writeReg(0xa0, fnum & 0xff)

      this.keyOn()
      this.wait(secondsToSamples(dur))
      this.keyOff()
    },

    rest(duration: number) {
      this.wait(secondsToSamples(duration))
    },
    instrument(inst: Instrument | Snapshot<Instrument>) {
      const OP_BASE = [0x30, 0x34, 0x38, 0x3c]

      inst.operators.forEach((op, i) => {
        const base = OP_BASE[i]

        this.writeReg(base + 0x00, (op.det << 4) | op.mul)
        this.writeReg(base + 0x10, op.tl)
        this.writeReg(base + 0x20, (op.rs << 6) | op.ar)
        this.writeReg(base + 0x30, (op.am << 7) | op.d1)
        this.writeReg(base + 0x40, op.d2)
        this.writeReg(base + 0x50, (op.sl << 4) | op.rr)
        this.writeReg(base + 0x60, 0x00)
      })

      this.writeReg(0xb0, (inst.fb << 3) | inst.al)
      this.writeReg(0xb4, 0xc0 | (inst.ams << 4) | inst.fms)
    },

    end() {
      w(0x66)
    },

    build() {
      const header = new Uint8Array(0x40)
      const dv = new DataView(header.buffer)

      header.set([0x56, 0x67, 0x6d, 0x20], 0x00)

      dv.setUint32(0x08, 0x00000150, true)
      dv.setUint32(0x2c, 7670454, true)
      dv.setUint32(0x34, 0x0c, true)

      const totalLength = 0x40 + data.length
      dv.setUint32(0x04, totalLength - 4, true)

      const result = new Uint8Array(totalLength)
      result.set(header, 0)
      result.set(data, 0x40)

      return result
    },
  }

  return api
}

function previewInstrument(
  inst: Instrument | Snapshot<Instrument>,
  name: string,
) {
  const vgm = createVGM()
  vgm.instrument(inst)
  vgm.note(48, 2)
  vgm.rest(4)
  vgm.end()
  const bytes = vgm.build()
  ScriptNodePlayer.getInstance().prepareTrackForPlayback(name, bytes, {})
}

function noop(...args) {
  console.log('NOOP', args)
}

function doOnTrackReadyToPlay() {
  console.log('doOnTrackReadyToPlay')
  ScriptNodePlayer.getInstance().play()
}

ScriptNodePlayer.createInstance(
  new VgmBackendAdapter(),
  '',
  [],
  true,
  noop,
  doOnTrackReadyToPlay,
  noop,
)

export { previewInstrument }
