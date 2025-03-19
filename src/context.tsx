import React, {
  Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from 'react'
import { reactLocalStorage } from 'reactjs-localstorage'
import MidiIO from './midi-io'
import { calculateEnvelopePoints } from './utils/envelopePoints'

type ParamMeta = {
  key: string
  title: string
  label: string
  cc: number
  ch: number
  max: number
  bits: number
  options: string[]
  bi?: number
}

type ParamData = ParamMeta & {
  value: number
  bindings: BindingKey[]
}

type PatchId = 0 | 1 | 2 | 3
type ChannelId = 0 | 1 | 2 | 3 | 4 | 5
type OperatorId = 0 | 1 | 2 | 3

type ContextValue = {
  getParamData: (id: Param, op: OperatorId) => ParamData
  envelopes: Record<OperatorId, string>
  state: State
  dispatch: React.Dispatch<Action>
  playMode: PlayModeEnum
  blendMode: BlendModeEnum
  midiChannel: MidiChannelEnum
  sequenceSteps: number
}

enum MidiCommands {
  BIND_X = 101,
  BIND_Y = 102,
  BIND_Z = 103,
  COPY_PATCH = 104,
  MOVE_PATCH = 105,
  COPY_CHANNEL = 106,
  MOVE_CHANNEL = 107,
  SET_SEQ_STEP_ON = 108,
  SET_SEQ_STEP_OFF = 109,
  SAVE_STATE = 110,
  CLEAR_SEQ = 111,
  CLEAR_BINDINGS = 112,
  SET_CALIBRATION_STEP = 113,
  TOGGLE_DEBUG = 114,
  VERIFY_CHECKSUM = 115,
}

const sendMidiCmd = (cmd: MidiCommands, val = 127) => {
  MidiIO.sendCC(15, cmd, val)
}

const calculateChecksum = (state: State) => {
  const key = encodeKey('lfo', 0, 0, 0)
  return state.moduleState[key]
}

const bindingsMap: Record<BindingKey, MidiCommands> = {
  x: MidiCommands.BIND_X,
  y: MidiCommands.BIND_Y,
  z: MidiCommands.BIND_Z,
}

enum SettingParamEnum {
  PATCH_ZONE = 'pz',
  BLEND = 'bl',
  BLEND_MODE = 'bm',
  PLAY_MODE = 'pm',
  LED_BRIGHTNESS = 'lb',
  TRANSPOSE = 'tr',
  TUNNING = 'tu',
  MIDI_RECEIVE_CHANNEL = 'rc',
  ATTENUVERTER_MODE = 'atm',
  SEQ_STEPS = 'stp',
}

enum PatchParamEnum {
  LFO = 'lfo',
}

enum ChannelParamEnum {
  AL = 'al',
  FB = 'fb',
  AMS = 'ams',
  FMS = 'fms',
  ST = 'st',
}

enum OperatorParamEnum {
  AR = 'ar',
  D1 = 'd1',
  SL = 'sl',
  D2 = 'd2',
  RR = 'rr',
  TL = 'tl',
  MUL = 'mul',
  DET = 'det',
  RS = 'rs',
  AM = 'am',
}
const CH_PARAM_OFFSET = 10
const OP_PARAM_OFFSET = 40
const CH_BINDING_OFFSET = 10
const OP_BINDING_OFFSET = 20

type SettingParam = `${SettingParamEnum}`
type PatchParam = `${PatchParamEnum}`
type ChannelParam = `${ChannelParamEnum}`
type OperatorParam = `${OperatorParamEnum}`
type Param = SettingParam | PatchParam | ChannelParam | OperatorParam
type BindingKey = 'x' | 'y' | 'z'

enum PlayModeEnum {
  MONO = 0,
  DUO = 1,
  TRIO = 2,
  CHORD = 3,
  SEQ = 4,
  RAND = 5,
  POLY = 6,
}

enum BlendModeEnum {
  KNOB = 0,
  KNOB_MOD_X = 1,
  MOD_X = 2,
}

enum MidiChannelEnum {
  CH1 = 0,
  CH2 = 1,
  CH3 = 2,
  CH4 = 3,
  CH5 = 4,
  CH6 = 5,
  CH7 = 6,
  CH8 = 7,
  CH9 = 8,
  CH10 = 9,
  CH11 = 10,
  CH12 = 11,
  CH13 = 12,
  CH14 = 13,
  CH15 = 14,
  CH16 = 15,
  OMNI = 16,
  FORWARD = 17,
  MULTITRACK = 18,
}

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

/*
 * A ModuleState is the state of the YM2612 regarding sound design.
 * What defines it is the value of the whole parameters set,
 * which can be defined by a set of values.
 * The key is defined as `ctrlId-patchId-channelId-operatorId`
 * but to ensure keys are properly built, we should encode/decode them
 * with the provided helpers
 */
type ModuleState = Record<string, number>

type State = {
  name: string
  sequence: number[][]
  bindingKey?: BindingKey
  bindings: Record<BindingKey, number[]>
  moduleState: ModuleState
  patchIdx: PatchId
  channelIdx: ChannelId
  calibrationStep: number
}
type Action =
  | {
      type: 'provider-ready'
      savedState: State
    }
  | {
      type: 'toggle-param-binding'
      id: Param
      op: OperatorId
    }
  | {
      type: 'change-param'
      id: Param
      op: OperatorId
      val: number
    }
  | {
      type: 'toggle-seq-step'
      voice: number
      step: number
    }
  | {
      type: 'clear-sequence'
    }
  | {
      type: 'toggle-binding'
      bindingKey: BindingKey
    }
  | {
      type: 'reset-channel'
    }
  | {
      type: 'reset-operator'
      op: OperatorId
    }
  | {
      type: 'change-name'
      name: string
    }
  | {
      type: 'change-patch'
      index: PatchId
    }
  | {
      type: 'move-patch'
      index: PatchId
      before: PatchId
    }
  | {
      type: 'copy-patch'
      source: PatchId
      target: PatchId
    }
  | {
      type: 'change-channel'
      index: ChannelId
    }
  | {
      type: 'move-channel'
      index: ChannelId
      before: ChannelId
    }
  | {
      type: 'copy-channel'
      source: ChannelId
      target: ChannelId
    }
  | {
      type: 'update-state'
      newState: State
    }
  | {
      type: 'sync-midi'
    }
  | {
      type: 'save-state'
    }
  | {
      type: 'toggle-debug'
    }
  | {
      type: 'calibration-step'
      step: number
    }
  | {
      type: 'verify-checksum'
    }

const paramTitles: Record<Param, string> = {
  pz: 'Patch Zone',
  bl: 'Blend',
  bm: 'Blend Mode',
  pm: 'Play Mode',
  lb: 'Led Brightness',
  tr: 'Transpose',
  tu: 'Tunning',
  rc: 'Midi Receive Channel',
  atm: 'Attenuverter Mode',
  stp: 'Seq Mode steps',
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
  pz: 7,
  bl: 7,
  bm: 7,
  pm: 7,
  lb: 7,
  tr: 7,
  tu: 7,
  rc: 7,
  atm: 7,
  stp: 7,
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
    case 'pz':
      return ['A- B', 'B - C', 'C - D']
    case 'bm':
      return ['KNOB ONLY', 'KNOB + X MOD', 'X MOD']
    case 'pm':
      return Object.keys(PlayModeEnum).filter((k) => isNaN(Number(k)))
    case 'rc':
      return Object.keys(MidiChannelEnum).filter((k) => isNaN(Number(k)))
    case 'atm':
      return ['AUTO', 'OFFSET', 'ATTENUVERTER']
    case 'stp':
      return [
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
        '11',
        '12',
        '13',
        '14',
        '15',
        '16',
      ]
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
  state: State,
  op: OperatorId,
  pid = state.patchIdx,
  cid = state.channelIdx,
): { ch: number; cc: number } => {
  if (isSettingParam(id)) {
    const values: SettingParam[] = Object.values(SettingParamEnum)
    const index = values.indexOf(id)
    return { ch: 15, cc: 0 + index }
  }

  if (isPatchParam(id)) {
    // LFO case
    return {
      ch: pid * 4,
      cc: 9,
    }
  }

  if (isChannelParam(id)) {
    const values: ChannelParam[] = Object.values(ChannelParamEnum)
    const index = values.indexOf(id)
    return {
      ch: pid * 4,
      cc: CH_PARAM_OFFSET + cid * values.length + index, // 10-39 range
    }
  }
  // isOperatorParam
  const values: OperatorParam[] = Object.values(OperatorParamEnum)
  const index = values.indexOf(id)
  if ((state.moduleState['pm-0-0-0'] as PlayModeEnum) === PlayModeEnum.POLY) {
    return {
      ch: 0,
      cc: OP_PARAM_OFFSET + op * values.length + index, // 40 - 79 range
    }
  } else {
    return {
      ch: pid * 4 + op,
      cc: OP_PARAM_OFFSET + cid * values.length + index, // 40 - 99 range
    }
  }
}

/*
 * Binding index defines how a parameter can be bound to a modulator.
 * There is a maximum of 64 parameters that can be bound (but actually only
 * 47 are currently used) and depending on the action wanted (binding/unbinding)
 * the corresponding CC value will be shifted by 64.
 * Example:
 *   if BLEND binding index is `1`, then:
 *    * to unbind, send CC value 1
 *    * to bind, send CC value 65 (64+1)
 * This needs to be mimicked in the module firmware.
 *
 * */
const getParamBindingIndex = (
  id: Param,
  op: OperatorId,
): number | undefined => {
  if (id === SettingParamEnum.BLEND) {
    return 1
  }
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

const encodeKey = (
  id: Param,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId,
): string => {
  if (isSettingParam(id)) {
    return `${id}-0-0-0`
  }
  if (isPatchParam(id)) {
    return `${id}-${pid}-0-0`
  }
  if (isChannelParam(id)) {
    return `${id}-${pid}-${cid}-0`
  }
  // isOperatorParam
  return `${id}-${pid}-${cid}-${op}`
}

const decodeKey = (key: string) => {
  const parts = key.split('-')

  return {
    id: parts[0] as Param,
    pid: parseInt(parts[1], 10) as PatchId,
    cid: parseInt(parts[2], 10) as ChannelId,
    op: parseInt(parts[3], 10) as OperatorId,
  }
}

const getParamMeta = (
  id: Param,
  state: State,
  op: OperatorId,
  pid = state.patchIdx,
  cid = state.channelIdx,
): ParamMeta => {
  const key = encodeKey(id, pid, cid, op)
  const { ch, cc } = getParamMidiCc(id, state, op, pid, cid)
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
    cc,
    ch,
    max,
    bits,
    options,
    key,
  }
}

const createSequence = () =>
  Array.from({ length: 6 }).map((_) => Array.from({ length: 16 }).map((_) => 0))

const getInitialState = (): State => {
  const state: State = {
    name: 'Unnamed',
    bindings: { x: [], y: [], z: [] },
    patchIdx: 0,
    channelIdx: 0,
    moduleState: {},
    sequence: createSequence(),
    calibrationStep: 0,
  }

  const setParamValue = (
    id: Param,
    patchIdx: PatchId,
    channelIdx: ChannelId,
    op: OperatorId,
    val: number,
  ) => {
    const { key } = getParamMeta(id, state, op, patchIdx, channelIdx)
    state.moduleState[key] = val
  }

  for (let i = 0; i < 4; i++) {
    // stupid typescript
    const pid = i as PatchId

    setParamValue('lfo', pid, 0, 0, 0)

    for (let i = 0; i < 6; i++) {
      const cid = i as ChannelId
      setParamValue('al', pid, cid, 0, 7)
      setParamValue('fb', pid, cid, 0, 0)
      setParamValue('ams', pid, cid, 0, 0)
      setParamValue('fms', pid, cid, 0, 0)
      setParamValue('st', pid, cid, 0, 3)
      for (let i = 0; i < 4; i++) {
        const op = i as OperatorId
        setParamValue('ar', pid, cid, op, 31)
        setParamValue('d1', pid, cid, op, 0)
        setParamValue('sl', pid, cid, op, 0)
        setParamValue('d2', pid, cid, op, 0)
        setParamValue('rr', pid, cid, op, 15)
        setParamValue('tl', pid, cid, op, 0)
        setParamValue('mul', pid, cid, op, 3)
        setParamValue('det', pid, cid, op, 3)
        setParamValue('rs', pid, cid, op, 0)
        setParamValue('am', pid, cid, op, 0)
      }
    }
  }

  // add globals settings
  setParamValue(SettingParamEnum.PLAY_MODE, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.LED_BRIGHTNESS, 0, 0, 0, 64)
  setParamValue(SettingParamEnum.MIDI_RECEIVE_CHANNEL, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.ATTENUVERTER_MODE, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.TRANSPOSE, 0, 0, 0, 32)
  setParamValue(SettingParamEnum.TUNNING, 0, 0, 0, 64)
  setParamValue(SettingParamEnum.BLEND, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.SEQ_STEPS, 0, 0, 0, 7)

  return state
}

const initialState = getInitialState()

const getEnvelope = (state: State, op: OperatorId) => {
  const getNormalizedValue = (id: Param) => {
    const { bits, key } = getParamMeta(id, state, op)
    return (state.moduleState[key] << (7 - bits)) / 127
  }

  const ar = getNormalizedValue('ar')
  const d1 = getNormalizedValue('d1')
  const sl = getNormalizedValue('sl')
  const d2 = getNormalizedValue('d2')
  const rr = getNormalizedValue('rr')
  const tl = getNormalizedValue('tl')

  return calculateEnvelopePoints({ ar, d1, sl, d2, rr, tl })
}

const toggleParamBinding = (state: State, id: Param, op: OperatorId) => {
  // return unchanged state if not binding
  if (!state.bindingKey) return state

  const { bi } = getParamMeta(id, state, op)

  // return unchanged state if not boundable
  if (!bi) return state

  const binding = state.bindings[state.bindingKey]

  const index = binding.indexOf(bi)
  if (index !== -1) {
    // remove the binding
    binding.splice(index, 1)
    sendMidiCmd(bindingsMap[state.bindingKey], bi)
  } else {
    // add the binding
    binding.push(bi)
    sendMidiCmd(bindingsMap[state.bindingKey], 64 + bi)
  }

  return { ...state }
}

const toggleSeqStep = (state: State, voice: number, step: number) => {
  const prev = state.sequence[voice][step]
  const val = voice * 16 + step

  state.sequence[voice][step] = prev === 0 ? 1 : 0
  console.log(state.sequence, voice, step, prev)

  sendMidiCmd(
    prev === 0 ? MidiCommands.SET_SEQ_STEP_ON : MidiCommands.SET_SEQ_STEP_OFF,
    val,
  )

  return { ...state }
}

const changeParam = (state: State, id: Param, op: OperatorId, val: number) => {
  const doChangeParam = (pid = state.patchIdx) => {
    const { key, ch, cc, bits } = getParamMeta(id, state, op, pid)

    state.moduleState[key] = val

    const ccVal = val << (7 - bits)
    MidiIO.sendCC(ch, cc, ccVal)
  }

  // HACK: change for all patches at once for these list of parameters
  const ALL_PATCHES_PARAMS: Param[] = ['st']
  if (ALL_PATCHES_PARAMS.includes(id)) {
    for (let pid = 0; pid < 4; pid++) {
      doChangeParam(pid as PatchId)
    }
  } else {
    doChangeParam()
  }

  return { ...state }
}

const syncMidi = (state: State) => {
  // clear all bindings first
  sendMidiCmd(MidiCommands.CLEAR_BINDINGS)

  Object.entries(state.moduleState).forEach(([key, val]) => {
    const { id, pid, cid, op } = decodeKey(key)
    const { ch, cc, bits, bi } = getParamMeta(id, state, op, pid, cid)
    const ccVal = val << (7 - bits)
    // sync midi cc
    MidiIO.sendCC(ch, cc, ccVal)
    if (bi === undefined) {
      return
    }
    if (state.bindings.x.includes(bi)) {
      sendMidiCmd(bindingsMap.x, 64 + bi)
    } else if (state.bindings.y.includes(bi)) {
      sendMidiCmd(bindingsMap.y, 64 + bi)
    } else if (state.bindings.z.includes(bi)) {
      sendMidiCmd(bindingsMap.z, 64 + bi)
    }
  })
}

const resetOperator = (state: State, op: OperatorId) => {
  const updateAndSync = (id: Param, val: number) => {
    const { key, ch, cc, bits } = getParamMeta(id, state, op)
    state.moduleState[key] = val
    // sync midi cc
    const ccVal = val << (7 - bits)
    MidiIO.sendCC(ch, cc, ccVal)
  }

  updateAndSync('ar', 31)
  updateAndSync('d1', 0)
  updateAndSync('sl', 0)
  updateAndSync('d2', 0)
  updateAndSync('rr', 15)
  updateAndSync('tl', 0)
  updateAndSync('mul', 3)
  updateAndSync('det', 3)
  updateAndSync('rs', 0)
  updateAndSync('am', 0)

  return state
}

const resetChannel = (state: State) => {
  const updateAndSync = (id: Param, val: number) => {
    const { key, ch, cc, bits } = getParamMeta(id, state, 0)
    state.moduleState[key] = val
    // sync midi cc
    const ccVal = val << (7 - bits)
    MidiIO.sendCC(ch, cc, ccVal)
  }

  updateAndSync('lfo', 0)
  updateAndSync('al', 7)
  updateAndSync('fb', 0)
  updateAndSync('ams', 0)
  updateAndSync('fms', 0)
  updateAndSync('st', 3)

  return resetOperator(
    resetOperator(resetOperator(resetOperator(state, 0), 1), 2),
    3,
  )
}

// TODO: udpateParams without sending MIDI out
const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'calibration-step':
      sendMidiCmd(MidiCommands.SET_CALIBRATION_STEP, action.step)
      return { ...state, calibrationStep: action.step }
    case 'change-name':
      return { ...state, name: action.name }
    case 'provider-ready':
      return action.savedState ? action.savedState : state
    case 'toggle-param-binding':
      return toggleParamBinding(state, action.id, action.op)
    case 'change-param':
      return changeParam(state, action.id, action.op, action.val)
    case 'toggle-binding':
      return {
        ...state,
        bindingKey:
          action.bindingKey === state.bindingKey
            ? undefined
            : action.bindingKey,
      }
    case 'toggle-seq-step':
      return toggleSeqStep(state, action.voice, action.step)
    case 'reset-channel':
      return resetChannel({ ...state })
    case 'reset-operator':
      return resetOperator({ ...state }, action.op)
    case 'change-patch': {
      const patchIdx = action.index
      return { ...state, patchIdx }
    }
    case 'move-patch': {
      const { index, before } = action

      const moduleState = Object.fromEntries(
        Object.entries(state.moduleState).map(([key, val]) => {
          const { id, pid, cid, op } = decodeKey(key)
          let newPid: number = pid
          if (pid === index && index !== before - 1 && index !== before) {
            newPid = before
          } else if (index > before && pid < index && pid >= before) {
            newPid++
          } else if (index < before - 1 && pid > index && pid <= before) {
            newPid--
          }
          const newKey = encodeKey(id, newPid as PatchId, cid, op)
          return [newKey, val]
        }),
      )

      // encode two 3-bit values together
      const val = ((index & 0b111) << 3) | (before & 0b111)
      sendMidiCmd(MidiCommands.MOVE_PATCH, val)

      return { ...state, moduleState }
    }
    case 'copy-patch': {
      const { source, target } = action

      const moduleState = { ...state.moduleState }
      Object.keys(moduleState).forEach((key) => {
        const { id, pid, cid, op } = decodeKey(key)
        if (pid === target) {
          const sourceKey = encodeKey(id, source, cid, op)
          moduleState[key] = moduleState[sourceKey]
        }
      })

      // encode two 3-bit values together
      const val = ((source & 0b111) << 3) | (target & 0b111)
      sendMidiCmd(MidiCommands.COPY_PATCH, val)

      return { ...state, moduleState }
    }

    case 'update-state': {
      const { newState } = action
      return newState
    }
    case 'change-channel': {
      const channelIdx = action.index
      return { ...state, channelIdx }
    }
    case 'move-channel': {
      const { index, before } = action

      if (index === before - 1 || index === before) {
        return state
      }

      const moduleState = Object.fromEntries(
        Object.entries(state.moduleState).map(([key, val]) => {
          const { id, pid, cid, op } = decodeKey(key)
          let newCid: number = cid
          if (pid === state.patchIdx) {
            if (cid === index) {
              newCid = before
            } else if (index > before && cid < index && cid >= before) {
              newCid++
            } else if (index < before - 1 && cid > index && cid <= before) {
              newCid--
            }
          }
          const newKey = encodeKey(id, pid, newCid as ChannelId, op)
          return [newKey, val]
        }),
      )

      // shrink before up to 5 values based on index value
      // as index != before
      // NOTE: it could be shrunk to 4 values, but 5 is enough
      // and that way we keep the same logic as for COPY_CHANNEL
      const encodedBefore = index < before ? before : before - 1
      // encode values as a sum
      const val = state.patchIdx * 30 + encodedBefore * 6 + index
      sendMidiCmd(MidiCommands.MOVE_CHANNEL, val)

      return { ...state, moduleState }
    }
    case 'copy-channel': {
      const { source, target } = action

      if (source === target) {
        return state
      }

      const moduleState = { ...state.moduleState }
      Object.keys(moduleState).forEach((key) => {
        const { id, pid, cid, op } = decodeKey(key)
        if (pid === state.patchIdx && cid === target) {
          const sourceKey = encodeKey(id, pid, source, op)
          moduleState[key] = moduleState[sourceKey]
        }
      })

      // shrink target up to 5 values based on source value
      // as source != target
      // NOTE: to decode it, target =  encodedTarget === source ? target + 1 : encodedTarget
      const encodedTarget = target < source ? target : target - 1
      // encode values as a sum
      const val = state.patchIdx * 30 + encodedTarget * 6 + source
      sendMidiCmd(MidiCommands.COPY_CHANNEL, val)

      return { ...state, moduleState }
    }
    case 'sync-midi':
      syncMidi(state)
      return state
    case 'save-state': {
      sendMidiCmd(MidiCommands.SAVE_STATE)
      const savedState: State = { ...state, bindingKey: undefined }
      return savedState
    }
    case 'toggle-debug': {
      sendMidiCmd(MidiCommands.TOGGLE_DEBUG)
      return state
    }
    case 'verify-checksum': {
      const checksum = calculateChecksum(state)
      console.log('CHECKSUM', checksum)
      sendMidiCmd(MidiCommands.VERIFY_CHECKSUM, checksum)
      return state
    }
    case 'clear-sequence': {
      sendMidiCmd(MidiCommands.CLEAR_SEQ)

      return { ...state, sequence: createSequence() }
    }
  }
}

const getContextValue = (
  state: State,
  dispatch: React.Dispatch<Action>,
): ContextValue => {
  const getParamData = (id: Param, op: OperatorId) => {
    const meta = getParamMeta(id, state, op)

    const { key, bi } = meta
    const value = state.moduleState[key]

    const bindings: BindingKey[] = []
    if (bi) {
      ;(['x', 'y', 'z'] as const).forEach((mod) => {
        if (state.bindings[mod].includes(bi)) {
          bindings.push(mod)
        }
      })
    }

    return {
      ...meta,
      value,
      bindings,
    }
  }

  const envelopes: Record<OperatorId, string> = {
    0: '',
    1: '',
    2: '',
    3: '',
  }

  // TODO: do not asume envelopes have changed
  for (let op = 0; op < 4; op++) {
    envelopes[op] = getEnvelope(state, op as OperatorId)
  }

  // HACK: conveniently re-exposing these properties
  const playMode = state.moduleState['pm-0-0-0']
  const blendMode = state.moduleState['bm-0-0-0']
  const midiChannel = state.moduleState['rc-0-0-0']
  const sequenceSteps = state.moduleState['stp-0-0-0']

  return {
    playMode,
    blendMode,
    midiChannel,
    sequenceSteps,
    state,
    envelopes,
    getParamData,
    dispatch,
  }
}

const initialContextValue = getContextValue(initialState, () => {})
const CV2612Context = React.createContext<ContextValue>(initialContextValue)

let saveId = 0
const CV2612Provider = ({ children }) => {
  const [state, dispatch] = useReducer<Reducer<State, Action>>(
    reducer,
    initialState,
  )

  const value = useMemo(() => {
    return getContextValue(state, dispatch)
  }, [state])

  const doSaveState = useCallback(() => {
    reactLocalStorage.set('lastState', JSON.stringify(state))
  }, [state])

  const saveStateDelayed = useCallback(() => {
    if (saveId) {
      clearTimeout(saveId)
    }
    saveId = setTimeout(doSaveState, 500)
  }, [doSaveState])

  useEffect(saveStateDelayed, [saveStateDelayed])

  useEffect(() => {
    ;(async () => {
      await MidiIO.init()
      const lastStateStr = reactLocalStorage.get('lastState', '')

      if (lastStateStr) {
        const lastState = JSON.parse(lastStateStr)
        dispatch({ type: 'provider-ready', savedState: lastState })
      } else {
        dispatch({ type: 'provider-ready', savedState: initialState })
      }
    })()
  }, [])

  return (
    <CV2612Context.Provider value={value}>{children}</CV2612Context.Provider>
  )
}

export {
  CV2612Context,
  CV2612Provider,
  BindingKey,
  Param,
  OperatorId,
  PatchId,
  ChannelId,
  PlayModeEnum,
  BlendModeEnum,
  MidiChannelEnum,
}
