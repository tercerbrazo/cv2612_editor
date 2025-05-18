import {
  ChannelParamEnum,
  MidiCommands,
  OperatorParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from './enums'
import MidiIO from './midi-io'
import { calculate_crc32 } from './utils/checksum'
import {
  getParamBindingIndex,
  getParamMeta,
  getParamMidiCc,
  getPolyParamMidiCc,
  isChannelParam,
  isOperatorParam,
  isPatchParam,
  isSettingParam,
} from './utils/paramsHelpers'

import { proxy, subscribe, useSnapshot } from 'valtio'
import { deepClone } from 'valtio/utils'
import initialLibrary from './instruments.json'

// TODO: simplify binding commands in the firm and update this logic
const BINDING_CMDS = [
  MidiCommands.BIND_X,
  MidiCommands.BIND_Y,
  MidiCommands.BIND_Z,
] as const

const sendMidiCmd = (cmd: MidiCommands, val = 127) => {
  MidiIO.sendCC(15, cmd, val)
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
    type: 'bind-all'
    modulator?: BindingId
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
    bindingId: BindingId
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

const initialSequence = Array.from({ length: 6 }).map((_) =>
  Array.from({ length: 16 }).map((_) => 0),
)

const initialOperator: Operator = {
  ar: 31,
  d1: 0,
  sl: 0,
  d2: 0,
  rr: 15,
  tl: 0,
  mul: 3,
  det: 3,
  am: 0,
  rs: 0,
}

const initialChannel: Channel = {
  name: '---',
  al: 7,
  fb: 0,
  ams: 0,
  fms: 0,
  st: 3,
  operators: [
    initialOperator,
    initialOperator,
    initialOperator,
    initialOperator,
  ] as const,
}

const initialPatch: Patch = {
  lfo: 0,
  channels: [
    initialChannel,
    initialChannel,
    initialChannel,
    initialChannel,
    initialChannel,
    initialChannel,
  ],
}

const initialSettings = {
  lb: 64,
  tr: 32,
  pm: 0,
  tu: 64,
  rc: 0,
  stp: 7,
  quantize: 0,
  legato: 0,
  velocity: 0,
  portamento: 0,
  polyphony: 0,
  sequence: initialSequence,
}

const initialState: State = {
  name: 'New Patch',
  bindings: [[], [], []],
  patchIdx: 0,
  channelIdx: 0,
  calibrationStep: 0,
  instrumentsLoader: false,
  mixer: false,
  settings: initialSettings,
  library: initialLibrary as Channel[],
  patches: [initialPatch, initialPatch, initialPatch, initialPatch],
}

const getInitialState = () => {
  const lastStateStr = localStorage.getItem('lastState')
  if (lastStateStr !== null) {
    const lastState = JSON.parse(lastStateStr)
    if (hasSameShape(lastState, initialState)) {
      return lastState as State
    }
  }
  return deepClone(initialState)
}

const state = proxy(getInitialState())

subscribe(state, () => {
  localStorage.setItem('lastState', JSON.stringify(state))
})

const toggleParamBinding = (id: Param, op: OperatorId) => {
  // return unchanged state if not binding
  if (state.bindingId === undefined) return

  const bi = getParamBindingIndex(id, op)

  // return unchanged state if not boundable
  if (bi === undefined) {
    return
  }
  // update bindings state

  state.bindings.forEach((bindings, index) => {
    bindings.forEach((bi) => {
      // send binding via midi
      sendMidiCmd(BINDING_CMDS[index], 64 + bi)
    })
  })
    ; ([0, 1, 2] as const).forEach((mod) => {
      const binding = state.bindings[mod]
      const index = binding.indexOf(bi)
      if (index !== -1) {
        // remove the binding
        binding.splice(index, 1)
        // unbind cmd
        sendMidiCmd(BINDING_CMDS[mod], bi)
      } else if (mod === state.bindingId) {
        // add the binding
        binding.push(bi)
        // bind cmd
        sendMidiCmd(BINDING_CMDS[mod], 64 + bi)
      }
    })
}

const toggleSeqStep = (voice: number, step: number) => {
  const prev = state.settings.sequence[voice][step]
  const val = voice * 16 + step

  state.settings.sequence[voice][step] = prev === 0 ? 1 : 0

  sendMidiCmd(
    prev === 0 ? MidiCommands.SET_SEQ_STEP_ON : MidiCommands.SET_SEQ_STEP_OFF,
    val,
  )
}

const setParamValue = (
  id: Param,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId,
  value: number,
) => {
  if (isSettingParam(id)) {
    state.settings[id] = value
  }
  if (isPatchParam(id)) {
    state.patches[pid][id] = value
  }
  if (isChannelParam(id)) {
    state.patches[pid].channels[cid][id] = value
  }
  // isOperatorParam(id)
  state.patches[pid].channels[cid].operators[op][id] = value
}

const sendMidiParam = (
  id: Param,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId,
  val: number,
) => {
  const { bits } = getParamMeta(id)
  const { ch, cc } = getParamMidiCc(id, pid, cid, op)
  // sync midi cc
  const ccVal = val << (7 - bits)
  MidiIO.sendCC(ch, cc, ccVal)
}

const changeParam = (id: Param, op: OperatorId, val: number) => {
  const pid = state.patchIdx
  const cid = state.channelIdx
  setParamValue(id, pid, cid, op, val)
  sendMidiParam(id, pid, cid, op, val)
}

const bindAll = (modulator?: number) => {
  // clear all bindings first
  sendMidiCmd(MidiCommands.CLEAR_BINDINGS)
  // clear bindings state
  state.bindings = [[], [], []]

  // if this was a "clear bindings" only cmd, then return
  if (modulator === undefined) return

  const params: Param[] = ['lfo', 'al', 'fms', 'st', 'ams']
  params.forEach((id) => {
    const bi = getParamBindingIndex(id, 0)
    if (bi) {
      state.bindings[modulator].push(bi)
    }
  })

  const opParams: Param[] = Object.values(OperatorParamEnum)
  opParams.forEach((id) => {
    for (let o = 0; o < 4; o++) {
      const bi = getParamBindingIndex(id, o as OperatorId)
      if (bi) {
        state.bindings[modulator].push(bi)
      }
    }
  })

  state.bindings.forEach((bindings, index) => {
    bindings.forEach((bi) => {
      // send binding via midi
      sendMidiCmd(BINDING_CMDS[index], 64 + bi)
    })
  })
}

// for convenience, as iterators are numbers
const relaxedSendParamMidiCc = (
  id: Param,
  pid: number,
  cid: number,
  op: number,
  val: number,
) => {
  sendMidiParam(id, pid as PatchId, cid as ChannelId, op as OperatorId, val)
}

const syncMidi = () => {
  // clear all bindings first
  sendMidiCmd(MidiCommands.CLEAR_BINDINGS)

  // settings
  Object.values(SettingParamEnum).forEach((id) => {
    relaxedSendParamMidiCc(id, 0, 0, 0, state.settings[id])
  })

  for (let pid = 0; pid < 4; pid++) {
    const patch = state.patches[pid]
    relaxedSendParamMidiCc('lfo', pid, 0, 0, patch.lfo)
    for (let cid = 0; cid < 6; cid++) {
      const ch = patch.channels[cid]

      Object.values(ChannelParamEnum).forEach((id) => {
        relaxedSendParamMidiCc(id, pid, cid, 0, ch[id])
      })

      for (let o = 0; o < 4; o++) {
        Object.values(OperatorParamEnum).forEach((id) => {
          relaxedSendParamMidiCc(id, pid, cid, o, ch.operators[o][id])
        })
      }
    }
  }

  state.bindings.forEach((bindings, index) => {
    bindings.forEach((bi) => {
      // send binding via midi
      sendMidiCmd(BINDING_CMDS[index], 64 + bi)
    })
  })
}

const resetOperator = (op: OperatorId) => {
  const updateAndSync = (id: Param, val: number) => {
    const pid = state.patchIdx
    const cid = state.channelIdx
    setParamValue(id, pid, cid, op, val)
    sendMidiParam(id, pid, cid, op, val)
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
}

const resetChannel = () => {
  const updateAndSync = (id: Param, val: number) => {
    const pid = state.patchIdx
    const cid = state.channelIdx
    setParamValue(id, pid, cid, 0, val)
    sendMidiParam(id, pid, cid, 0, val)
  }

  updateAndSync('lfo', 0)
  updateAndSync('al', 7)
  updateAndSync('fb', 0)
  updateAndSync('ams', 0)
  updateAndSync('fms', 0)
  updateAndSync('st', 3)

  resetOperator(0)
  resetOperator(1)
  resetOperator(2)
  resetOperator(3)
}

// TODO: send crc32 checks periodically or after certain actions
const sendCrc32 = () => {
  const crc32 = calculate_crc32(state)

  for (let index = 0; index < 8; index++) {
    const chunk = (crc32 >> (index * 4)) & 0x0f
    const data = (index << 4) | chunk
    sendMidiCmd(MidiCommands.SEND_CRC32_CHUNK, data)
  }
}

// TODO: udpateParams without sending MIDI out
const dispatch = (action: Action) => {
  switch (action.type) {
    case 'calibration-step':
      sendMidiCmd(MidiCommands.SET_CALIBRATION_STEP, action.step)
      state.calibrationStep = action.step
      break
    case 'change-name':
      state.name = action.name
      break
    case 'provider-ready':
      // return action.savedState ? action.savedState : state
      break
    case 'toggle-param-binding':
      toggleParamBinding(action.id, action.op)
      break
    case 'change-param':
      changeParam(action.id, action.op, action.val)
      break
    case 'toggle-binding':
      state.bindingId =
        action.bindingId === state.bindingId ? undefined : action.bindingId
      break
    case 'bind-all':
      bindAll(action.modulator)
      break
    case 'toggle-seq-step':
      toggleSeqStep(action.voice, action.step)
      break
    case 'reset-channel':
      resetChannel()
      break
    case 'reset-operator':
      resetOperator(action.op)
      break
    case 'change-patch': {
      state.patchIdx = action.index
      break
    }
    case 'move-patch': {
      /*
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
        */

      break
    }
    case 'copy-patch': {
      /*
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
        */

      break
    }

    case 'change-channel': {
      state.channelIdx = action.index
      break
    }
    case 'move-channel': {
      /*
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
        */
      break
    }
    case 'copy-channel': {
      /*
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
        */
      break
    }
    case 'sync-midi': {
      syncMidi()
      sendCrc32()
      break
    }
    case 'save-state': {
      state.bindingId = undefined
      sendMidiCmd(MidiCommands.SAVE_STATE)
      sendCrc32()
      break
    }
    case 'toggle-debug': {
      sendMidiCmd(MidiCommands.TOGGLE_DEBUG)
      break
    }
    case 'verify-checksum': {
      sendCrc32()
      break
    }
    case 'clear-sequence': {
      sendMidiCmd(MidiCommands.CLEAR_SEQ)
      state.settings.sequence = deepClone(initialSequence)
      break
    }
  }
}

const useParamMidi = (id: Param, op: OperatorId) => {
  const snap = useSnapshot(state)
  const pid = snap.patchIdx
  const cid = snap.channelIdx
  const { ch, cc } =
    snap.settings.pm === PlayModeEnum.POLY
      ? getPolyParamMidiCc(id, pid, cid, op)
      : getParamMidiCc(id, pid, cid, op)

  return {
    cc,
    ch,
  }
}

const useBinding = (id: Param, op: OperatorId) => {
  const snap = useSnapshot(state)
  const bindingIndex = getParamBindingIndex(id, op)

  let boundTo: BindingId | undefined = undefined
  if (bindingIndex !== undefined) {
    ; ([0, 1, 2] as const).forEach((mod) => {
      if (snap.bindings[mod].includes(bindingIndex)) {
        boundTo = mod
      }
    })
  }

  return {
    bindingIndex,
    boundTo,
    bindingId: snap.bindingId,
  }
}

const useParamData = (id: Param, op: OperatorId): ParamData => {
  const snap = useSnapshot(state)
  const pid = snap.patchIdx
  const cid = snap.channelIdx
  const meta = getParamMeta(id)

  let value = 0
  if (isSettingParam(id)) {
    value = snap.settings[id]
  }
  if (isPatchParam(id)) {
    value = snap.patches[pid][id]
  }
  if (isChannelParam(id)) {
    value = snap.patches[pid].channels[cid][id]
  }
  if (isOperatorParam(id)) {
    value = snap.patches[pid].channels[cid].operators[op][id]
  }

  return {
    ...meta,
    value,
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

export { state, dispatch, useParamData, useParamMidi, useBinding }
