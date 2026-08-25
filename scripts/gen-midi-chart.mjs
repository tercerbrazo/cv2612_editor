/*
 * MIDI Implementation Chart generator — the manual appendix, generated from
 * the same tables the editor actually uses to talk to the module
 * (paramsHelpers.ts / enums.ts), so it cannot drift from the code.
 *
 * Run with: node --experimental-transform-types scripts/gen-midi-chart.mjs [out.md]
 */
import { writeFileSync } from 'node:fs'
import {
  ChannelParamEnum,
  MidiCommands,
  OperatorParamEnum,
  SceneParamEnum,
  SettingParamEnum,
} from '../src/enums.ts'
import {
  getParamMeta,
  getParamMidiCc,
} from '../src/utils/paramsHelpers.ts'

const L = []
const p = (s = '') => L.push(s)

const NAMES = {
  pm: 'Play mode (0-6: MONO/DUO/TRIO/CHORD/SEQ/RAND/POLY)',
  lb: 'LED brightness',
  tr: 'Transpose (64 = center)',
  tu: 'Tuning (64 = center)',
  rc: 'MIDI receive channel (0-15 = ch 1-16, 16 = OMNI)',
  stp: 'Sequencer steps',
  portamento: 'Reserved (no effect yet)',
  vs: 'Velocity sensitivity',
  pbu: 'Pitch bend range up (semitones)',
  pbd: 'Pitch bend range down (semitones)',
  mmx: 'Modulation mode X (0 ABSOLUTE / 1 DIRECT / 2 LINKED)',
  mmy: 'Modulation mode Y (0 ABSOLUTE / 1 DIRECT / 2 LINKED)',
  mmz: 'Modulation mode Z (0 ABSOLUTE / 1 DIRECT / 2 LINKED)',
  qz: 'Quantize (0 off / 1 chromatic / 2-7 scales)',
  lfo: 'LFO (scene)',
  lr: 'Stereo routing L/R (⚠ writes ALL FOUR scenes at once)',
  al: 'Algorithm',
  fb: 'Feedback',
  ams: 'Amplitude mod sensitivity',
  fms: 'Frequency mod sensitivity',
  ar: 'Attack rate',
  d1: 'Decay 1 rate',
  sl: 'Sustain level',
  d2: 'Decay 2 rate',
  rr: 'Release rate',
  tl: 'Total level (volume, inverted)',
  mul: 'Multiplier',
  det: 'Detune',
  rs: 'Rate scaling',
  am: 'Amplitude mod enable',
}

p('# CV2612 — MIDI Implementation Chart')
p()
p('> Generated from the editor source (`scripts/gen-midi-chart.mjs`) — the')
p('> same tables the editor uses on the wire. Do not edit by hand.')
p()
p('## Channel map')
p()
p('| Channel | Role |')
p('|---|---|')
p('| 1-12 | Patch params: channels 1-6 = scenes A/B, 7-12 = scenes C/D |')
p('| receive channel (or OMNI) | Notes, bend, performance CCs — voice allocation is per play mode |')
p('| 15 | Settings (CC 20-34) |')
p('| 16 | Commands (CC 101-115) |')
p('| 13-14 | Unassigned |')
p()
p('> **⚠ Channel 1 warning:** CCs 9-118 on channels 1-12 EDIT the patch in')
p('> real time (see below). A controller sending stock CCs (pan, expression,')
p("> CC74…) on those channels is sculpting your sound — that's a feature,")
p('> but point your DAW at the receive channel knowingly.')
p()
p('## Performance MIDI (any receive channel)')
p()
p('| Message | Effect |')
p('|---|---|')
p('| Note on/off | Play (mode-dependent voice allocation), velocity honored |')
p('| Pitch bend | ± bend range settings, applied on the quantized note |')
p('| CC1 (mod wheel) | Morph blend W (holds the knob until it moves again) |')
p('| CC2 / CC3 / CC4 | Modulation X / Y / Z (holds the jack+trimmer per axis) |')
p('| CC5 | LFO rate, live (unless the LFO is bound to a modulator) |')
p('| CC64 (sustain) | Pedal: releasing keeps only keys still held down |')
p('| CC120 (all sound off) | Panic + SEQ re-sync to the downbeat |')
p('| CC123 (all notes off) | Releases notes (respects the pedal) |')
p()

p('## Settings — channel 15')
p()
p('| CC | Setting | Range |')
p('|---|---|---|')
// effective ranges the firmware clamps to (values above are ignored/clamped)
const SETTING_RANGE = {
  pm: '0-6', rc: '0-16', stp: '0-15 (steps played = value+1)',
  tr: '16-112 (clamped)', tu: '32-96 (clamped)',
  mmx: '0-2 (unvalidated)', mmy: '0-2 (unvalidated)', mmz: '0-2 (unvalidated)',
  qz: '0-7 (clamped)',
}
for (const id of Object.values(SettingParamEnum)) {
  const { cc } = getParamMidiCc(id, 0, 0, 0)
  p(`| ${cc} | ${NAMES[id] ?? id} | ${SETTING_RANGE[id] ?? '0-127'} |`)
}
p()

p('## Patch parameters — channels 1-12')
p()
p('Value scaling: each parameter uses its native bit depth, left-aligned in')
p('the 7-bit CC value (`value = param << (7 - bits)`).')
p()
p('| CC (scene A/C) | CC (scene B/D) | Parameter | Bits | Range |')
p('|---|---|---|---|---|')
const sceneParams = Object.values(SceneParamEnum)
const chParams = ['lr', ...Object.values(ChannelParamEnum)]
const opParams = Object.values(OperatorParamEnum)
for (const id of [...sceneParams, ...chParams]) {
  const a = getParamMidiCc(id, 0, 0, 0)
  const b = getParamMidiCc(id, 1, 0, 0)
  const { bits, max } = getParamMeta(id)
  p(`| ${a.cc} | ${b.cc} | ${NAMES[id] ?? id} | ${bits} | 0-${max} |`)
}
for (let op = 0; op < 4; op++) {
  for (const id of opParams) {
    const a = getParamMidiCc(id, 0, 0, op)
    const b = getParamMidiCc(id, 1, 0, op)
    const { bits, max } = getParamMeta(id)
    p(`| ${a.cc} | ${b.cc} | Op${op + 1} ${NAMES[id] ?? id} | ${bits} | 0-${max} |`)
  }
}
p()

p('## Commands — channel 16')
p()
p('| CC | Command | Value |')
p('|---|---|---|')
const CMD_DESC = {
  BIND_X: ['Bind/unbind parameter to X', '64+index binds, index unbinds'],
  BIND_Y: ['Bind/unbind parameter to Y', 'idem'],
  BIND_Z: ['Bind/unbind parameter to Z', 'idem'],
  SET_SEQ_STEP_ON: ['Sequencer step on', 'voice*16 + step'],
  SET_SEQ_STEP_OFF: ['Sequencer step off', 'voice*16 + step'],
  SAVE_STATE: ['Save everything to EEPROM', 'any'],
  CLEAR_SEQ: ['Clear the sequence', 'any'],
  CLEAR_BINDINGS: ['Clear all bindings', 'any'],
  SET_CALIBRATION_STEP: ['Calibration step', '1-8 span capture, 9 rest capture, 0 exit'],
  TOGGLE_DEBUG: ['Telemetry stream toggle', '0 = off, else on'],
  SEND_CRC32_CHUNK: ['Sync check, 8 nibbles', '(index<<4) | nibble, low first'],
}
for (const [name, val] of Object.entries(MidiCommands)) {
  if (typeof val !== 'number') continue
  const [desc, v] = CMD_DESC[name] ?? [name, '']
  p(`| ${val} | ${desc} | ${v} |`)
}
p()
p('MIDI channels above are 1-based (wire channel 0 = "channel 1").')

const out = L.join('\n') + '\n'
const dest = process.argv[2]
if (dest) writeFileSync(dest, out)
else process.stdout.write(out)
console.error(`chart: ${L.length} lines${dest ? ` → ${dest}` : ''}`)
