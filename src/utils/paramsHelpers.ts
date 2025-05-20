import {
  ChannelParamEnum,
  MidiChannelEnum,
  OperatorParamEnum,
  PatchParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from '../enums'

// NOTE: needs to be in sync with firmware
const PARAM_INDEXES: Record<Param, number> = {
  // settings indexes
  quantize: 0,
  legato: 1,
  velocity: 2,
  pm: 3,
  lb: 4,
  tr: 5,
  tu: 6,
  rc: 7,
  portamento: 8,
  // FIXME: need to make room for polyphony
  // probably spread over 2 or more channels
  polyphony: 8,
  stp: 9,

  // patch indexes
  lfo: 9,

  // channel indexes
  al: 0,
  fb: 1,
  ams: 2,
  fms: 3,
  // routing indexes
  st: 4,

  // operator indexes
  ar: 0,
  d1: 1,
  sl: 2,
  d2: 3,
  rr: 4,
  tl: 5,
  mul: 6,
  det: 7,
  rs: 8,
  am: 9,
}

const CH_PARAM_OFFSET = 10
const CH_PARAM_COUNT = 5
const OP_PARAM_OFFSET = 40
const OP_PARAM_COUNT = 10
const CH_BINDING_OFFSET = 10
const OP_BINDING_OFFSET = 20

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
  quantize: 'Quantize',
  legato: 'Legato',
  velocity: 'Velocity',
  portamento: 'Portamento',
  polyphony: 'Polyphony',
  lfo: 'Low Frequency Oscillator',
  st: 'Stereo Mode',
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
  quantize: 1,
  legato: 1,
  velocity: 1,
  portamento: 1,
  polyphony: 7,
  lfo: 3,
  st: 2,
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
  const index = PARAM_INDEXES[id]

  if (isSettingParam(id)) {
    return { ch: 15, cc: 0 + index }
  }

  if (id === 'lfo') {
    return { ch: pid * 4, cc: index }
  }

  if (id === 'st') {
    return {
      ch: 0,
      cc: CH_PARAM_OFFSET + cid * CH_PARAM_COUNT + index,
    }
  }

  if (isChannelParam(id)) {
    return {
      ch: pid * 4,
      cc: CH_PARAM_OFFSET + cid * CH_PARAM_COUNT + index, // 10-39 range
    }
  }
  // isOperatorParam
  return {
    ch: pid * 4 + op,
    cc: OP_PARAM_OFFSET + cid * OP_PARAM_COUNT + index, // 40 - 99 range
  }
}

const getPolyParamMidiCc = (
  id: Param,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId,
): { ch: number; cc: number } => {
  if (isOperatorParam(id)) {
    const index = PARAM_INDEXES[id]
    return {
      ch: 0,
      cc: OP_PARAM_OFFSET + op * OP_PARAM_COUNT + index, // 40 - 79 range
    }
  } else {
    return getParamMidiCc(id, pid, cid, op)
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
  if (id === PatchParamEnum.LFO) {
    return 2
  }
  if (isChannelParam(id)) {
    return CH_BINDING_OFFSET + PARAM_INDEXES[id]
  }
  if (isOperatorParam(id) && id !== 'am' && id !== 'rs') {
    return OP_BINDING_OFFSET + OP_PARAM_COUNT * op + PARAM_INDEXES[id]
  }
  // for any other non-boundable parameter it'll be undefined
  return undefined
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
  getPolyParamMidiCc,
  getParamBindingIndex,
  getParamMeta,
  getParamOptions,
}
