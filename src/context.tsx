import {
  ChannelParamEnum,
  MidiCommands,
  OperatorParamEnum,
  SettingParamEnum,
} from './enums'
import MidiIO from './midi-io'
import { calculate_crc32 } from './utils/checksum'
import { hashInstrument } from './utils/hashing'
import {
  getParamBindingIndex,
  getParamMeta,
  getParamMidiCc,
  isChannelParam,
  isOperatorParam,
  isSceneParam,
  isSettingParam,
} from './utils/paramsHelpers'

import { Snapshot, proxy, subscribe, useSnapshot } from 'valtio'
import { deepClone } from 'valtio/utils'
import initialLibraryJson from './instruments.json'

// TODO: redo library format
const initialLibrary = (
  initialLibraryJson as unknown as (Instrument & { name: string })[]
).map((i) => ({
  instrument: i,
  name: i.name,
  system: true,
  hash: hashInstrument(i),
})) satisfies Library

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

const initialInstrument = initialLibrary[0].instrument
const initialScene = {
  lfo: 0,
  channels: Array(6).fill({ ...initialInstrument, origin: 0 }),
} as Scene

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

const CURRENT_VERSION = 13
const initialState: State = {
  version: CURRENT_VERSION,
  bindings: [[], [], []],
  selection: [{ sid: 0, cid: 0 }],
  routing: [3, 3, 3, 3, 3, 3],
  settings: initialSettings,
  library: initialLibrary,
  scenes: [initialScene, initialScene, initialScene, initialScene],
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

// TODO: sync midi here
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
  sid: SceneId,
  cid: ChannelId,
  op: OperatorId,
  value: number,
) => {
  if (isSettingParam(id)) {
    state.settings[id] = value
  } else if (isSceneParam(id)) {
    state.scenes[sid][id] = value
  } else if (isChannelParam(id)) {
    state.scenes[sid].channels[cid][id] = value
  } else if (isOperatorParam(id)) {
    state.scenes[sid].channels[cid].operators[op][id] = value
  }
}

const applyParam = (id: Param, op: OperatorId, value: number) => {
  state.selection.forEach((s) => {
    setParamValue(id, s.sid, s.cid, op, value)
    sendMidiParam(id, s.sid, s.cid, op, value)
  })
}

const applyRouting = (cid: ChannelId, l: boolean, r: boolean) => {
  state.routing[cid] = (((r ? 1 : 0) << 1) | (l ? 1 : 0)) as Routing
  sendMidiParam('lr', 0, cid, 0, state.routing[cid])
}

const sendMidiParam = (
  id: Param,
  sid: SceneId,
  cid: ChannelId,
  op: OperatorId,
  val: number,
) => {
  const { bits } = getParamMeta(id)
  const { ch, cc } = getParamMidiCc(id, sid, cid, op)
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

  const params: Param[] = ['lfo', 'al', 'fms', 'ams', 'fb']
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
  sid: number,
  cid: number,
  op: number,
  val: number,
) => {
  sendMidiParam(id, sid as SceneId, cid as ChannelId, op as OperatorId, val)
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

  // scenes
  for (let sid = 0; sid < 4; sid++) {
    const scene = state.scenes[sid]
    relaxedSendParamMidiCc('lfo', sid, 0, 0, scene.lfo)
    for (let cid = 0; cid < 6; cid++) {
      const ch = scene.channels[cid]

      Object.values(ChannelParamEnum).forEach((id) => {
        relaxedSendParamMidiCc(id, sid, cid, 0, ch[id])
      })

      for (let o = 0; o < 4; o++) {
        Object.values(OperatorParamEnum).forEach((id) => {
          relaxedSendParamMidiCc(id, sid, cid, o, ch.operators[o][id])
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

const resetOperator = (op: OperatorId) => {
  Object.entries(initialInstrument.operators[0]).forEach(([k, v]) => {
    applyParam(k as OperatorParam, op, v)
  })
}

const resetChannel = () => {
  assignInstrument(initialInstrument, 0)
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

const useParam = (id: Param, op: OperatorId) => {
  const snap = useSnapshot(state)

  let ccHint = 'mixed CCs'
  if (snap.selection.length === 1) {
    const { sid, cid } = snap.selection[0]
    const { ch, cc } = getParamMidiCc(id, sid, cid, op)
    ccHint = `CC ${ch}:${cc}`
  }

  const selectedChannels = snap.selection.map((s) => {
    return snap.scenes[s.sid].channels[s.cid]
  })

  if (isSettingParam(id)) {
    const value = snap.settings[id]
    return { ccHint, value, mixed: false }
  } else if (isSceneParam(id)) {
    const value = snap.scenes[snap.selection[0].sid][id]
    const mixed = snap.selection.some((s) => snap.scenes[s.sid][id] !== value)
    return { ccHint, value, mixed }
  } else if (isChannelParam(id)) {
    const value = selectedChannels[0][id]
    const mixed = selectedChannels.some((c) => c[id] !== value)
    return { ccHint, value, mixed }
  } else if (isOperatorParam(id)) {
    const value = selectedChannels[0].operators[op][id]
    const mixed = selectedChannels.some((c) => c.operators[op][id] !== value)
    return { ccHint, value, mixed }
  } else {
    console.error('routing cant use useParam hook')
    return { ccHint: '', value: 0, mixed: false }
  }
}

function addToLibrary(inst: Instrument, name = '') {
  const instrument = deepClone(inst)

  state.library.push({
    instrument,
    hash: hashInstrument(instrument),
    system: false,
    name,
  })
}

function isChannelDirty(ch: Snapshot<Channel>, lib: Snapshot<Library>) {
  return hashInstrument(ch) !== lib[ch.origin].hash
}

const channelName = (ch: Snapshot<Channel>, lib: Snapshot<Library>) =>
  `${lib[ch.origin].name}${isChannelDirty(ch, lib) ? ' (*)' : ''}`

const assignInstrument = (inst: Instrument, origin: number) => {
  state.selection.forEach((s) => {
    const prev = state.scenes[s.sid].channels[s.cid]

    // sync
    Object.values(ChannelParamEnum).forEach((id) => {
      if (prev[id] !== inst[id]) {
        relaxedSendParamMidiCc(id, s.sid, s.cid, 0, inst[id])
      }
    })

    for (let o = 0; o < 4; o++) {
      Object.values(OperatorParamEnum).forEach((id) => {
        if (prev.operators[o][id] !== inst.operators[o][id]) {
          relaxedSendParamMidiCc(id, s.sid, s.cid, o, inst.operators[o][id])
        }
      })
    }

    //set
    state.scenes[s.sid].channels[s.cid] = {
      ...deepClone(inst),
      origin,
    }
  })
}

const cloneFromLibrary = (index: number) => {
  assignInstrument(state.library[index].instrument, index)
}

const cloneFromSibling = (sid: number, cid: number) => {
  const ch = state.scenes[sid].channels[cid]
  assignInstrument(ch, ch.origin)
}

export {
  state,
  channelName,
  useParam,
  applyParam,
  applyRouting,
  useBinding,
  clearSequence,
  toggleSeqStep,
  toggleParamBinding,
  bindAll,
  cloneFromLibrary,
  cloneFromSibling,
  addToLibrary,
  isChannelDirty,
  syncMidi,
  sendCrc32,
  saveState,
  resetChannel,
  resetOperator,
}
