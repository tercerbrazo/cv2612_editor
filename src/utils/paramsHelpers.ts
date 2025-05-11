import {
  ChannelParamEnum,
  MidiChannelEnum,
  OperatorParamEnum,
  PatchParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from '../enums'

// NOTE: needs to be in sync with firmware
const SETTINGS_PARAM_INDEXES: Record<SettingParam, number> = {
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
}

const CHANNEL_PARAM_INDEXES = {
  al: 0,
  fb: 1,
  ams: 2,
  fms: 3,
  st: 4,
}

const OPERATOR_PARAM_INDEXES = {
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

const LFO_CC = 9
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

const paramTitles: Record<Param, string> = {
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
    case 'stp':
      return Array.from({ length: 16 }, (_, i) => (i + 1).toString())
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
  playMode: PlayModeEnum,
  op: OperatorId,
  pid: PatchId,
  cid: ChannelId,
): { ch: number; cc: number } => {
  if (isSettingParam(id)) {
    const index = SETTINGS_PARAM_INDEXES[id]
    return { ch: 15, cc: 0 + index }
  }

  if (isPatchParam(id)) {
    // LFO case
    return {
      ch: pid * 4,
      cc: LFO_CC,
    }
  }

  if (isChannelParam(id)) {
    const index = CHANNEL_PARAM_INDEXES[id]
    return {
      ch: pid * 4,
      cc: CH_PARAM_OFFSET + cid * CH_PARAM_COUNT + index, // 10-39 range
    }
  }
  // isOperatorParam
  const index = OPERATOR_PARAM_INDEXES[id]
  if (playMode === PlayModeEnum.POLY) {
    return {
      ch: 0,
      cc: OP_PARAM_OFFSET + op * OP_PARAM_COUNT + index, // 40 - 79 range
    }
  } else {
    return {
      ch: pid * 4 + op,
      cc: OP_PARAM_OFFSET + cid * OP_PARAM_COUNT + index, // 40 - 99 range
    }
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
    const values: ChannelParam[] = Object.values(ChannelParamEnum)
    const index = values.indexOf(id)
    return CH_BINDING_OFFSET + index
  }
  if (isOperatorParam(id)) {
    const values: OperatorParam[] = Object.values(OperatorParamEnum)
    const index = values.indexOf(id)
    return OP_BINDING_OFFSET + values.length * op + index
  }
  // for any other non-boundable parameter it'll be undefined
  return undefined
}

const OPERATOR_SIZE = 10
const CHANNEL_SIZE = 5 + 4 * OPERATOR_SIZE
const PATCH_SIZE = 1 + 6 * CHANNEL_SIZE

const getParamIndex = (
  id: Param,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId,
): number => {
  if (isPatchParam(id)) {
    // LFO
    return PATCH_SIZE * pid
  }
  if (isChannelParam(id)) {
    return PATCH_SIZE * pid + CHANNEL_SIZE * cid + CHANNEL_PARAM_INDEXES[id]
  }
  if (isOperatorParam(id)) {
    return (
      PATCH_SIZE * pid +
      CHANNEL_SIZE * cid +
      OPERATOR_SIZE * op +
      OPERATOR_PARAM_INDEXES[id]
    )
  }

  // isSettingParam(id)
  return PATCH_SIZE * 4 + SETTINGS_PARAM_INDEXES[id]
}

const getParamMeta = (id: Param, op: OperatorId): ParamMeta => {
  const label: string = id
  const bits = paramBitness[id]
  const title = paramTitles[id]
  const options = getParamOptions(id)
  const bi = getParamBindingIndex(id, op)
  const max = 127 >> (7 - bits)

  return {
    title,
    label,
    bi,
    max,
    bits,
    options,
  }
}

export {
  isSettingParam,
  isPatchParam,
  isChannelParam,
  isOperatorParam,
  getParamIndex,
  getParamMidiCc,
  getParamBindingIndex,
  getParamMeta,
  getParamOptions,
}
