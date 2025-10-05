import {
  ChannelParamEnum,
  MidiCommands,
  OperatorParamEnum,
  SettingParamEnum,
} from './enums'
import MidiIO from './midi-io'
import { calculate_crc32 } from './utils/checksum'
import {
  getParamBindingIndex,
  getParamMeta,
  getParamMidiCc,
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
  lb: 5,
  tr: 32,
  pm: 0,
  tu: 64,
  rc: 0,
  stp: 7,
  vs: 8,
  portamento: 0,
  pbu: 2,
  pbd: 12,
  mmx: 2,
  mmy: 2,
  mmz: 2,
  sequence: initialSequence,
}

const CURRENT_VERSION = 10
const initialState: State = {
  version: CURRENT_VERSION,
  name: 'New Patch',
  bindings: [[], [], []],
  patchIdx: 0,
  patchIdxs: [0],
  channelIdx: 0,
  channelIdxs: [0],
  calibrationStep: 0,
  routing: [3, 3, 3, 3, 3, 3],
  settings: initialSettings,
  library: initialLibrary as Channel[],
  patches: [initialPatch, initialPatch, initialPatch, initialPatch],
}

const getInitialState = () => {
  const lastStateStr = localStorage.getItem('lastState')
  if (lastStateStr !== null) {
    const lastState = JSON.parse(lastStateStr)
    if (lastState.version === CURRENT_VERSION) {
      return lastState as State
    } else {
      // TODO: migrate a previous version?
      console.error(
        `MISSING MIGRATION FROM ${lastState.version} to ${CURRENT_VERSION}`,
      )
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
  ;([0, 1, 2] as const).forEach((mod) => {
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
  } else if (isPatchParam(id)) {
    state.patches[pid][id] = value
  } else if (isChannelParam(id)) {
    state.patches[pid].channels[cid][id] = value
  } else if (isOperatorParam(id)) {
    state.patches[pid].channels[cid].operators[op][id] = value
  }
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

const bindAll = (modulator?: number) => {
  // clear all bindings first
  sendMidiCmd(MidiCommands.CLEAR_BINDINGS)
  // clear bindings state
  state.bindings = [[], [], []]

  // if this was a "clear bindings" only cmd, then return
  if (modulator === undefined) return

  // FIXME!
  // const params: Param[] = ['lfo', 'al', 'fms', 'ams', 'fb']
  const params: Param[] = ['al', 'fms', 'ams', 'fb']
  params.forEach((id) => {
    const bi = getParamBindingIndex(id, 0)
    if (bi) {
      state.bindings[modulator].push(bi)
    }
  })

  const opParams: Param[] = ['ar', 'd1', 'sl', 'd2', 'rr', 'tl', 'mul', 'det']
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

  // send sequence
  sendMidiCmd(MidiCommands.CLEAR_SEQ)
  state.settings.sequence.forEach((seq, voice) => {
    seq.forEach((step_on, step_index) => {
      if (step_on) {
        sendMidiCmd(MidiCommands.SET_SEQ_STEP_ON, voice * 16 + step_index)
      }
    })
  })

  // routing
  for (let cid = 0; cid < 6; cid++) {
    relaxedSendParamMidiCc('lr', 0, cid, 0, state.routing[cid])
  }

  // patches
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

  sendCrc32()
}

const syncCurrentChannel = () => {
  const pid = state.patchIdx
  const cid = state.channelIdx

  const patch = state.patches[pid]
  relaxedSendParamMidiCc('lfo', pid, 0, 0, patch.lfo)
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
  updateAndSync('lr', 3)

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

const saveState = () => {
  state.bindingId = undefined
  sendMidiCmd(MidiCommands.SAVE_STATE)
  sendCrc32()
}

const clearSequence = () => {
  sendMidiCmd(MidiCommands.CLEAR_SEQ)
  state.settings.sequence = deepClone(initialSequence)
}

const useParamMidi = (id: Param, op: OperatorId) => {
  const snap = useSnapshot(state)
  const pid = snap.patchIdx
  const cid = snap.channelIdx
  const { ch, cc } = getParamMidiCc(id, pid, cid, op)

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
    ;([0, 1, 2] as const).forEach((mod) => {
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

const useParamValue = (id: Param, op: OperatorId): number => {
  const snap = useSnapshot(state)
  const pid = snap.patchIdx
  const cid = snap.channelIdx

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

  return value
}

const setCalibrationStep = (step: number) => {
  sendMidiCmd(MidiCommands.SET_CALIBRATION_STEP, step)
  state.calibrationStep = step
}

const instrumentName = (pid: number, cid: number) => {
  const ch = state.patches[pid].channels[cid]
  const index = state.library.findIndex((inst) => inst.name === ch.name)
  let changed = false
  if (index !== -1) {
    changed = JSON.stringify(ch) !== JSON.stringify(state.library[index])
  }
  return `${ch.name}${changed ? ' (*)' : ''}`
}

const useInstrumentName = () => {
  const snap = useSnapshot(state)

  const ch = snap.patches[snap.patchIdx].channels[snap.channelIdx]
  const index = snap.library.findIndex((inst) => inst.name === ch.name)
  let changed = false
  if (index !== -1) {
    changed = JSON.stringify(ch) !== JSON.stringify(snap.library[index])
    console.log(ch.operators[0], snap.library[index].operators[0])
  }
  return `${ch.name}${changed ? ' (*)' : ''}`
}

export {
  state,
  instrumentName,
  useInstrumentName,
  setCalibrationStep,
  useParamValue,
  useParamMidi,
  useBinding,
  sendMidiParam,
  syncCurrentChannel,
  clearSequence,
  toggleSeqStep,
  toggleParamBinding,
  bindAll,
  syncMidi,
  sendCrc32,
  saveState,
  resetChannel,
  resetOperator,
  setParamValue,
}
