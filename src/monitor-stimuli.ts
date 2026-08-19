/*
 * MIDI test stimuli for the Monitor tab: canned CC setups, test notes,
 * a note sweep and a pitch-bend ramp, meant to be fired while watching the
 * telemetry charts. Everything goes through the shared MidiIO singleton, so
 * the stimuli use the SAME MIDI output the Editor tab has selected.
 * Only timing/sequencing here — the buttons live in monitor.tsx.
 */
import { MidiCommands } from './enums'
import MidiIO from './midi-io'
import { CAPTURE_RESTS_VALUE } from './monitor-calibration'

// notes/bend go out on channel 0: the module filters by midi_recv_channel,
// which defaults to OMNI, so any channel works
export const NOTE_CH = 0
export const NOTE_VELOCITY = 100
export const TEST_NOTE_DEFAULT = 57 // A3

// "Clean state": MONO, quantize off, transpose/tuning centered (ch14)
export const sendCleanState = () => {
  MidiIO.sendCC(14, 20, 0) // play mode = MONO
  MidiIO.sendCC(14, 34, 0) // quantize off
  MidiIO.sendCC(14, 22, 64) // transpose centered
  MidiIO.sendCC(14, 23, 64) // tuning centered
}

// "Sine patch": a single sine carrier on patch A, channel 1 (MIDI ch0)
export const SINE_PATCH: [number, number][] = [
  [11, 112],
  [12, 0],
  [10, 96],
  [15, 124],
  [16, 0],
  [17, 0],
  [18, 0],
  [19, 120],
  [20, 0],
  [21, 8],
  [22, 0],
  [23, 0],
  [24, 0],
  [30, 127],
  [40, 127],
  [50, 127],
]

export const sendSinePatch = () => {
  for (const [cc, val] of SINE_PATCH) MidiIO.sendCC(0, cc, val)
  MidiIO.sendCC(0, 1, 0) // W to zero so the morph does not bite
}

// "Capture rests": commands channel (15), same path as the editor's
// bind/save commands in context.tsx. Value 9 = capture-all-rests: the module
// block-averages all inputs (~60ms) and persists pitch/X/Y/Z rests plus the
// trimmer centers to EEPROM.
export const sendCaptureRests = () =>
  MidiIO.sendCC(15, MidiCommands.SET_CALIBRATION_STEP, CAPTURE_RESTS_VALUE)

// telemetry ON/OFF via CC114 on the commands channel (val 1/0); stream returns over Web Serial
export const sendToggleDebug = (on: boolean) =>
  MidiIO.sendCC(15, MidiCommands.TOGGLE_DEBUG, on ? 1 : 0)

export const noteOn = (note: number) =>
  MidiIO.sendRaw([0x90 | NOTE_CH, note & 0x7f, NOTE_VELOCITY])

export const noteOff = (note: number) =>
  MidiIO.sendRaw([0x80 | NOTE_CH, note & 0x7f, 0])

export const sendBend = (v14: number) =>
  MidiIO.sendRaw([0xe0 | NOTE_CH, v14 & 0x7f, (v14 >> 7) & 0x7f])

export type Runner = { cancel: () => void }

// "Note sweep": 21..117 in steps of 6, 400ms each
export const NOTE_SWEEP_FROM = 21
export const NOTE_SWEEP_TO = 117
export const NOTE_SWEEP_STEP = 6
export const NOTE_SWEEP_MS = 400

// onNote reports the sounding note, null when the sweep ends
export const runNoteSweep = (onNote: (n: number | null) => void): Runner => {
  let current: number | null = NOTE_SWEEP_FROM
  noteOn(current)
  onNote(current)
  const id = setInterval(() => {
    if (current === null) return
    noteOff(current)
    const next = current + NOTE_SWEEP_STEP
    if (next > NOTE_SWEEP_TO) {
      clearInterval(id)
      current = null
      onNote(null)
      return
    }
    current = next
    noteOn(current)
    onNote(current)
  }, NOTE_SWEEP_MS)
  return {
    cancel: () => {
      clearInterval(id)
      if (current !== null) noteOff(current)
      current = null
      onNote(null)
    },
  }
}

// "Bend ramp": center to max over BEND_MS, then snap back to center
export const BEND_CENTER = 8192
export const BEND_MAX = 16383
export const BEND_MS = 2000
export const BEND_TICK_MS = 40

export const runBendRamp = (onDone: () => void): Runner => {
  const t0 = performance.now()
  sendBend(BEND_CENTER)
  const id = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / BEND_MS)
    sendBend(BEND_CENTER + Math.round(k * (BEND_MAX - BEND_CENTER)))
    if (k >= 1) {
      clearInterval(id)
      sendBend(BEND_CENTER)
      onDone()
    }
  }, BEND_TICK_MS)
  return {
    cancel: () => {
      clearInterval(id)
      sendBend(BEND_CENTER)
      onDone()
    },
  }
}
