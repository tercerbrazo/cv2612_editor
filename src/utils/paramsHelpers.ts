import {
  ChannelParamEnum,
  MidiChannelEnum,
  OperatorParamEnum,
  PatchParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from '../enums'

// NOTE: needs to be in sync with firmware
const PARAM_BINDING_INDEXES = {
  lfo: 2,
  // al: 10,
  fb: 11,
  ams: 12,
  fms: 13,
  // operator indexes
  ar: 20,
  d1: 21,
  sl: 22,
  d2: 23,
  rr: 24,
  tl: 25,
  mul: 26,
  det: 27,
} as const

const SETTING_PARAM_MIDI_CC: Record<keyof typeof SettingParamEnum, number> = {
  PLAY_MODE: 0xe0, // channel 14, CC 0
  LED_BRIGHTNESS: 0xe1,
  TRANSPOSE: 0xe2,
  TUNNING: 0xe3,
  MIDI_RECEIVE_CHANNEL: 0xe4,
  SEQ_STEPS: 0xe5,
  PORTAMENTO: 0xe6,
  VELOCITY_SENSITIVITY: 0xe7,
  PITCH_BEND_UP: 0xe8,
  PITCH_BEND_DOWN: 0xe9,
}

const PARAM_INDEXES: Record<
  'lfo' | RoutingParam | ChannelParam | OperatorParam,
  number
> = {
  // patch indexes
  lfo: 9,

  // channel indexes
  al: 10,
  fb: 11,
  ams: 12,
  fms: 13,
  // routing indexes
  lr: 14,

  // operator indexes
  ar: 40,
  d1: 41,
  sl: 42,
  d2: 43,
  rr: 44,
  tl: 45,
  mul: 46,
  det: 47,
  rs: 48,
  am: 49,
}

const CH_PARAM_COUNT = 5
const OP_PARAM_COUNT = 10
// special case, as 64 conflicts with sustain pedal
const RR_CH2_MIDI_CC = 100

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

const paramBitness: Record<Param, number> = {
  pm: 7,
  lb: 7,
  tr: 7,
  tu: 7,
  rc: 7,
  stp: 7,
  vs: 4,
  portamento: 1,
  pbu: 4,
  pbd: 4,
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
}

const getParamOptions = (id: Param): string[] => {
  switch (id) {
    case 'pm':
      return Object.keys(PlayModeEnum).filter((k) => isNaN(Number(k)))
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
    const packed = SETTING_PARAM_MIDI_CC[key]
    return { ch: packed >> 4, cc: packed & 0b1111 }
  }

  const index = PARAM_INDEXES[id]
  if (id === 'lfo') {
    return { ch: pid * 4, cc: index }
  }

  if (id === 'lr') {
    return {
      ch: 0,
      cc: cid * CH_PARAM_COUNT + index,
    }
  }

  if (isChannelParam(id)) {
    return {
      ch: pid * 4,
      cc: cid * CH_PARAM_COUNT + index, // 10-39 range
    }
  }

  // special case, as 64 conflicts with sustain pedal
  if (id === 'rr' && cid === 2) {
    return {
      ch: pid * 4 + op,
      cc: RR_CH2_MIDI_CC,
    }
  }

  // isOperatorParam
  return {
    ch: pid * 4 + op,
    cc: cid * OP_PARAM_COUNT + index, // 40 - 99 range
  }
}

/*
 * Binding index defines how a parameter can be bound to a modulator.
 * There is a maximum of 64 parameters that can be bound (but actually only
 * 47 are currently used) and depending on the action wanted (binding/unbinding)
 * the corresponding CC value will be shifted by 64.
 * Example:
 *   if LFO binding index is `2`, then:
 *    * to unbind, send CC value 2
 *    * to bind, send CC value 66 (64+2)
 * This needs to be mimicked in the module firmware.
 *
 * */
const getParamBindingIndex = (
  id: Param,
  op: OperatorId,
): number | undefined => {
  const base: number | undefined = PARAM_BINDING_INDEXES[id]
  if (base === undefined) return undefined
  return base + OP_PARAM_COUNT * op
}

const paramMax = Object.fromEntries(
  Object.entries(paramBitness).map(([k, b]) => [k, 2 ** b - 1]),
) as typeof paramBitness

const getParamMeta = (id: Param): ParamMeta => {
  const bits = paramBitness[id]
  const title = paramTitle[id]
  const max = paramMax[id]

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
