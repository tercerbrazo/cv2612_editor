import {
  ChannelParamEnum,
  MidiChannelEnum,
  OperatorParamEnum,
  PatchParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from '../enums'

const SETTING_PARAM_MIDI_CC: Record<keyof typeof SettingParamEnum, number> = {
  PLAY_MODE: 20,
  LED_BRIGHTNESS: 21,
  TRANSPOSE: 22,
  TUNNING: 23,
  MIDI_RECEIVE_CHANNEL: 24,
  SEQ_STEPS: 25,
  PORTAMENTO: 26,
  VELOCITY_SENSITIVITY: 27,
  PITCH_BEND_UP: 28,
  PITCH_BEND_DOWN: 29,
  MODULATION_MODE_X: 30,
  MODULATION_MODE_Y: 31,
  MODULATION_MODE_Z: 32,
}

const PARAM_INDEXES = [
  // patch indexes
  'lfo',
  // routing indexes
  'lr',
  // channel indexes
  'al',
  'fb',
  'ams',
  'fms',
  // operator indexes
  'ar',
  'd1',
  'sl',
  'd2',
  'rr',
  'tl',
  'mul',
  'det',
  'rs',
  'am',
] as const

const OP_PARAM_COUNT = 10

const PARAM_CC_OFFSET = 9

const isSettingParam = (id: Param): id is SettingParam => {
  const keys: string[] = Object.values(SettingParamEnum)
  return keys.includes(id)
}

const isPatchParam = (id: Param): id is PatchParam => {
  const keys: string[] = Object.values(PatchParamEnum)
  return keys.includes(id)
}

const isChannelParam = (id: Param): id is ChannelParam => {
  const keys: string[] = Object.values(ChannelParamEnum)
  return keys.includes(id)
}

const isOperatorParam = (id: Param): id is OperatorParam => {
  const keys: string[] = Object.values(OperatorParamEnum)
  return keys.includes(id)
}

const paramTitle: Record<Param, string> = {
  pm: 'Play Mode',
  lb: 'Led Brightness',
  tr: 'Transpose',
  tu: 'Tunning',
  rc: 'Midi Receive Channel',
  stp: 'Seq Mode steps',
  vs: 'Velocity Sensitivity',
  portamento: 'Portamento',
  pbu: 'Pitch Bend Up',
  pbd: 'Pitch Bend Down',
  mmx: 'Modulation Mode X',
  mmy: 'Modulation Mode Y',
  mmz: 'Modulation Mode Z',
  lfo: 'Low Frequency Oscillator',
  lr: 'Stereo Mode',
  ams: 'Amplitude Modulation Sensitivity',
  fms: 'Frequency Modulation Sensitivity',
  al: 'Algorithm',
  fb: 'Feedback (op1)',
  ar: 'Attack Rate (angle)',
  d1: 'Decay1 Rate (angle)',
  sl: 'Sustain Level (attenuation)',
  d2: 'Decay2 Rate (angle)',
  rr: 'Release Rate (angle)',
  tl: 'Total Level (attenuation)',
  mul: 'Multiplier',
  det: 'Detune',
  rs: 'Rate Scaling',
  am: 'Amplitude Modulation',
}

const paramBitness = {
  lfo: 3,
  lr: 2,
  ams: 2,
  fms: 3,
  al: 3,
  fb: 3,
  ar: 5,
  d1: 5,
  sl: 4,
  d2: 5,
  rr: 4,
  tl: 7,
  mul: 4,
  det: 3,
  rs: 2,
  am: 1,
} as const

const getParamOptions = (id: Param): string[] => {
  const playmodeOptions: Record<PlayModeEnum, string> = {
    [PlayModeEnum.MONO]: '🔴 MONO',
    [PlayModeEnum.DUO]: '🟠 DUO',
    [PlayModeEnum.TRIO]: '🟡 TRIO',
    [PlayModeEnum.CHORD]: '🟢 CHORD',
    [PlayModeEnum.SEQ]: '🔵 SEQ',
    [PlayModeEnum.RAND]: '🟣 RAND',
    [PlayModeEnum.POLY]: '⚪ POLY',
  }

  switch (id) {
    case 'pm':
      return Object.values(playmodeOptions)
    case 'rc':
      return Object.keys(MidiChannelEnum).filter((k) => isNaN(Number(k)))
    default:
      return []
  }
}

const settingKey = (id: SettingParam) => {
  return (
    Object.keys(SettingParamEnum) as (keyof typeof SettingParamEnum)[]
  ).find((k) => SettingParamEnum[k] === id) as keyof typeof SettingParamEnum
}

/*
 * This is how Module parameters are mapped to Midi channel/control_change
 * for a particular id-patch-channel-operator combination.
 * This needs to be mimicked in the module firmware.
 *
 * */
const getParamMidiCc = (
  id: Param,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId,
): { ch: number; cc: number } => {
  if (isSettingParam(id)) {
    const key = settingKey(id)
    return { ch: 14, cc: SETTING_PARAM_MIDI_CC[key] }
  }

  const ch = cid + (pid < 2 ? 0 : 6)
  const patch_offset = pid === 0 || pid === 2 ? 0 : 64
  const offset = PARAM_CC_OFFSET + patch_offset

  const index = PARAM_INDEXES.indexOf(id)

  return {
    ch,
    cc: offset + index + op * OP_PARAM_COUNT,
  }
}

/*
 * Binding index defines how a parameter can be bound to a modulator.
 * There is a maximum of 64 parameters that can be bound and
 * depending on the action wanted (binding/unbinding)
 * the corresponding CC value will be shifted by 64.
 * Example:
 *   if LFO binding index is `0`, then:
 *    * to unbind, send CC value 0
 *    * to bind, send CC value 64 (64+0)
 * This needs to be mimicked in the module firmware.
 *
 * */
const getParamBindingIndex = (
  id: Param,
  op: OperatorId,
): number | undefined => {
  if (isSettingParam(id) || id === 'lr' || id === 'am' || id === 'rs') {
    return undefined
  }
  const index = PARAM_INDEXES.indexOf(id)
  return index + OP_PARAM_COUNT * op
}

const paramMax = Object.fromEntries(
  Object.entries(paramBitness).map(([k, b]) => [k, 2 ** b - 1]),
) as typeof paramBitness

const getParamMeta = (id: Param): ParamMeta => {
  const bits = isSettingParam(id) ? 7 : paramBitness[id]
  const title = paramTitle[id]
  const max = isSettingParam(id) ? 127 : paramMax[id]

  return {
    title,
    max,
    bits,
  }
}

export {
  isSettingParam,
  isPatchParam,
  isChannelParam,
  isOperatorParam,
  getParamMidiCc,
  getParamBindingIndex,
  getParamMeta,
  getParamOptions,
}
