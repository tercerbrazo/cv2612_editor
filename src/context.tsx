import React, {
  Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from 'react'
import { reactLocalStorage } from 'reactjs-localstorage'
import {
  MidiChannelEnum,
  MidiCommands as MidiCommands,
  SettingParamEnum,
} from './enums'
import MidiIO from './midi-io'
import { calculate_crc32 } from './utils/checksum'
import { calculateEnvelopePoints } from './utils/envelopePoints'
import {
  decodeKey,
  encodeKey,
  getParamMeta,
  getParamMidiCc,
} from './utils/paramsHelpers'

// TODO: simplify binding commands in the firm and update this logic
const BINDING_CMD_MAP = {
  x: MidiCommands.BIND_X,
  y: MidiCommands.BIND_Y,
  z: MidiCommands.BIND_Z,
} as const

type ContextValue = {
  getParamData: (id: Param, op: OperatorId) => ParamData
  envelopes: Record<OperatorId, string>
  state: State
  dispatch: React.Dispatch<Action>
  playMode: PlayModeEnum
  midiChannel: MidiChannelEnum
  sequenceSteps: number
}

const sendMidiCmd = (cmd: MidiCommands, val = 127) => {
  MidiIO.sendCC(15, cmd, val)
}

type Action =
  | {
    type: 'provider-ready'
    savedState: State
  }
  | {
    type: 'toggle-instruments-loader'
  }
  | {
    type: 'toggle-param-binding'
    id: Param
    op: OperatorId
  }
  | {
    type: 'bind-all'
    modulator?: keyof typeof BINDING_CMD_MAP
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
    instrumentsLoader: false,
  }

  const setParamValue = (
    id: Param,
    patchIdx: PatchId,
    channelIdx: ChannelId,
    op: OperatorId,
    val: number,
  ) => {
    const key = encodeKey(id, patchIdx, channelIdx, op)
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
  setParamValue(SettingParamEnum.TRANSPOSE, 0, 0, 0, 32)
  setParamValue(SettingParamEnum.TUNNING, 0, 0, 0, 64)
  setParamValue(SettingParamEnum.SEQ_STEPS, 0, 0, 0, 7)

  // zero out unused settings
  setParamValue(SettingParamEnum.LEGATO, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.VELOCITY, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.PORTAMENTO, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.POLYPHONY, 0, 0, 0, 0)
  setParamValue(SettingParamEnum.QUANTIZE, 0, 0, 0, 0)

  return state
}

const initialState = getInitialState()

const getEnvelope = (state: State, op: OperatorId) => {
  const getNormalizedValue = (id: Param) => {
    const key = encodeKey(id, state.patchIdx, state.channelIdx, op)
    const { bits } = getParamMeta(id, op)
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

  const { bi } = getParamMeta(id, op)

  // return unchanged state if not boundable
  if (bi === undefined) {
    return state
  }
  // update bindings state
  ; (['x', 'y', 'z'] as const).forEach((mod) => {
    const binding = state.bindings[mod]
    const index = binding.indexOf(bi)
    if (index !== -1) {
      // remove the binding
      binding.splice(index, 1)
      // unbind cmd
      sendMidiCmd(BINDING_CMD_MAP[mod], bi)
    } else if (mod === state.bindingKey) {
      // add the binding
      binding.push(bi)
      // bind cmd
      sendMidiCmd(BINDING_CMD_MAP[mod], 64 + bi)
    }
  })

  return { ...state }
}

const toggleSeqStep = (state: State, voice: number, step: number) => {
  const prev = state.sequence[voice][step]
  const val = voice * 16 + step

  state.sequence[voice][step] = prev === 0 ? 1 : 0

  sendMidiCmd(
    prev === 0 ? MidiCommands.SET_SEQ_STEP_ON : MidiCommands.SET_SEQ_STEP_OFF,
    val,
  )

  return { ...state }
}

const changeParam = (state: State, id: Param, op: OperatorId, val: number) => {
  const doChangeParam = () => {
    const pid = state.patchIdx
    const cid = state.channelIdx
    const key = encodeKey(id, pid, cid, op)
    const { bits } = getParamMeta(id, op)
    const { ch, cc } = getParamMidiCc(id, state, op, pid, cid)

    state.moduleState[key] = val

    const ccVal = val << (7 - bits)
    MidiIO.sendCC(ch, cc, ccVal)
  }

  doChangeParam()

  return { ...state }
}

const bindAll = (state: State, modulator?: keyof typeof BINDING_CMD_MAP) => {
  // clear all bindings first
  sendMidiCmd(MidiCommands.CLEAR_BINDINGS)
  // clear bindings state
  state.bindings = { x: [], y: [], z: [] }

  // if this was a "clear bindings" only cmd, then return
  if (modulator === undefined) return { ...state }

  Object.keys(state.moduleState).forEach((key) => {
    const { id, pid, cid, op } = decodeKey(key)
    const { bi } = getParamMeta(id, op)

    // send bindings for first patch/channel as they are repeated
    if (bi !== undefined && pid === 0 && cid === 0) {
      // push binding state
      state.bindings[modulator].push(bi)
      // send binding via midi
      sendMidiCmd(BINDING_CMD_MAP[modulator], 64 + bi)
    }
  })

  return { ...state }
}

const syncMidi = (state: State) => {
  // clear all bindings first
  sendMidiCmd(MidiCommands.CLEAR_BINDINGS)

  Object.entries(state.moduleState).forEach(([key, val]) => {
    const { id, pid, cid, op } = decodeKey(key)
    const { bits, bi } = getParamMeta(id, op)
    const { ch, cc } = getParamMidiCc(id, state, op, pid, cid)
    const ccVal = val << (7 - bits)
    // sync midi cc
    MidiIO.sendCC(ch, cc, ccVal)

    // send bindings for first patch/channel as they are repeated
    if (bi !== undefined && pid === 0 && cid === 0) {
      if (state.bindings.x.includes(bi)) {
        sendMidiCmd(MidiCommands.BIND_X, 64 + bi)
      } else if (state.bindings.y.includes(bi)) {
        sendMidiCmd(MidiCommands.BIND_Y, 64 + bi)
      } else if (state.bindings.z.includes(bi)) {
        sendMidiCmd(MidiCommands.BIND_Z, 64 + bi)
      }
    }
  })
}

const resetOperator = (state: State, op: OperatorId) => {
  const updateAndSync = (id: Param, val: number) => {
    const key = encodeKey(id, state.patchIdx, state.channelIdx, op)
    const { bits } = getParamMeta(id, op)
    const { ch, cc } = getParamMidiCc(
      id,
      state,
      op,
      state.patchIdx,
      state.channelIdx,
    )
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
    const key = encodeKey(id, state.patchIdx, state.channelIdx, 0)
    const { bits } = getParamMeta(id, 0)
    const { ch, cc } = getParamMidiCc(
      id,
      state,
      0,
      state.patchIdx,
      state.channelIdx,
    )
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

// TODO: send crc32 checks periodically or after certain actions
const sendCrc32 = (state: State) => {
  const crc32 = calculate_crc32(state)

  for (let index = 0; index < 8; index++) {
    const chunk = (crc32 >> (index * 4)) & 0x0f
    const data = (index << 4) | chunk
    sendMidiCmd(MidiCommands.SEND_CRC32_CHUNK, data)
  }
}

// TODO: udpateParams without sending MIDI out
const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'toggle-instruments-loader':
      return { ...state, instrumentsLoader: !state.instrumentsLoader }
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
    case 'bind-all':
      return bindAll(state, action.modulator)
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
    case 'sync-midi': {
      syncMidi(state)
      sendCrc32(state)
      return state
    }
    case 'save-state': {
      sendMidiCmd(MidiCommands.SAVE_STATE)
      const savedState: State = { ...state, bindingKey: undefined }
      sendCrc32(state)
      return savedState
    }
    case 'toggle-debug': {
      sendMidiCmd(MidiCommands.TOGGLE_DEBUG)
      return state
    }
    case 'verify-checksum': {
      sendCrc32(state)
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
  const getParamData = (id: Param, op: OperatorId): ParamData => {
    const pid = state.patchIdx
    const cid = state.channelIdx
    const key = encodeKey(id, pid, cid, op)
    const meta = getParamMeta(id, op)
    const { ch, cc } = getParamMidiCc(id, state, op, pid, cid)

    const value = state.moduleState[key]

    let binding: BindingKey | undefined = undefined
    if (meta.bi !== undefined) {
      ; (['x', 'y', 'z'] as const).forEach((mod) => {
        if (state.bindings[mod].includes(meta.bi as number)) {
          binding = mod
        }
      })
    }

    return {
      ...meta,
      cc,
      ch,
      value,
      binding,
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
  const midiChannel = state.moduleState['rc-0-0-0']
  const sequenceSteps = state.moduleState['stp-0-0-0']

  return {
    playMode,
    midiChannel,
    sequenceSteps,
    state,
    envelopes,
    getParamData,
    dispatch,
  }
}

function normalize(value: unknown) {
  if (typeof value === 'number') return 0
  if (typeof value === 'boolean') return false
  if (typeof value === 'string') return ''
  if (Array.isArray(value)) {
    return value.map(normalize) // Recursively normalize array elements
  }
  if (value !== null && typeof value === 'object') {
    const normalizedObject = {}
    for (let key in value) {
      normalizedObject[key] = normalize(value[key]) // Recursively normalize object properties
    }
    return normalizedObject
  }
  return value // For other types (null, undefined, etc.), return as is
}

function hasSameShape(a: unknown, b: unknown) {
  const normalizedA = JSON.stringify(normalize(a))
  const normalizedB = JSON.stringify(normalize(b))
  return normalizedA === normalizedB
}

const initialContextValue = getContextValue(initialState, () => { })
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
    ; (async () => {
      await MidiIO.init()
      const lastStateStr = reactLocalStorage.get('lastState', '')

      if (lastStateStr) {
        const lastState = JSON.parse(lastStateStr)
        lastState.calibrationStep = 0
        lastState.instrumentsLoader = false
        // validate lastState shape
        if (hasSameShape(lastState, initialState)) {
          dispatch({ type: 'provider-ready', savedState: lastState })
        } else {
          dispatch({ type: 'provider-ready', savedState: initialState })
        }
      } else {
        dispatch({ type: 'provider-ready', savedState: initialState })
      }
    })()
  }, [])

  return (
    <CV2612Context.Provider value={value}>{children}</CV2612Context.Provider>
  )
}

export { CV2612Context, CV2612Provider }
