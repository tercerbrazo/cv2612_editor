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
import { subscribe as vanillaSubscribe } from 'valtio/vanilla'
import { deepClone } from 'valtio/utils'
import initialLibraryJson from './instruments.json'
const INIT_INSTRUMENT_ID = 'sys_init'

const SC_IDXS = [0, 1, 2, 3] as const
const CH_IDXS = [0, 1, 2, 3, 4, 5] as const
const OP_IDXS = [0, 1, 2, 3] as const
const SETTING_PARAMS = Object.values(SettingParamEnum)
const CHANNEL_PARAMS = Object.values(ChannelParamEnum)
const OPERATOR_PARAMS = Object.values(OperatorParamEnum)

//todo: redo library json with new data shape
const initialLibrary: Library = Object.fromEntries(
  (initialLibraryJson as unknown as (Instrument & { name: string })[]).map(
    ({ name, ...instrument }) => {
      const id = name === 'Init' ? INIT_INSTRUMENT_ID : crypto.randomUUID()

      const entry: LibraryEntry = {
        id,
        instrument,
        name,
        system: true,
        hash: hashInstrument(instrument),
      }

      return [id, entry]
    },
  ),
)

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

const initialInstrument = initialLibrary[INIT_INSTRUMENT_ID].instrument
const initialScene = {
  lfo: 0,
  channels: Array(6).fill({ ...initialInstrument, origin: INIT_INSTRUMENT_ID }),
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

const createPatch = (name: string) => {
  const id = crypto.randomUUID()
  return {
    id,
    name,
    routing: [3, 3, 3, 3, 3, 3],
    scenes: [initialScene, initialScene, initialScene, initialScene],
  } as Patch
}

const initialPatch = createPatch('Init')

const initialPatches = {
  [initialPatch.id]: initialPatch,
}

const CURRENT_VERSION = 14
const initialState: State = {
  version: CURRENT_VERSION,
  bindings: [[], [], []],
  settings: initialSettings,
  library: initialLibrary,
  patches: initialPatches,
  pid: initialPatch.id,
  selection: [{ sid: 0, cid: 0 }],
  showBrowser: false,
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

const syncInstrument = (
  sid: SceneId,
  cid: ChannelId,
  inst: Instrument,
  prevInst: Instrument,
) => {
  for (const id of CHANNEL_PARAMS) {
    if (inst[id] === prevInst[id]) continue
    sendMidiParam(id, sid, cid, 0, inst[id])
  }
  for (const oid of OP_IDXS) {
    const operator = inst.operators[oid]
    const prevOperator = prevInst.operators[oid]
    for (const id of OPERATOR_PARAMS) {
      if (operator[id] === prevOperator[id]) continue
      sendMidiParam(id, sid, cid, oid, operator[id])
    }
  }
}

vanillaSubscribe(state, (ops) => {
  ops.forEach((op) => {
    const [type, oppath, value, prev] = op
    const path = oppath as string[]

    if (type !== 'set') {
      return
    }
    console.log(path, value, prev)

    if (path[0] === 'settings') {
      if (path[1] === 'sequence') {
        // the clear sequence is already handled
        if (path.length !== 4) return

        const voice = Number(path[2])
        const step = Number(path[3])

        const val = voice * 16 + step

        sendMidiCmd(
          prev === 0
            ? MidiCommands.SET_SEQ_STEP_ON
            : MidiCommands.SET_SEQ_STEP_OFF,
          val,
        )
      } else {
        const param = path[1] as SettingParam
        sendMidiParam(param, 0, 0, 0, value as number)
      }
    }

    if (path[0] === 'patches') {
      switch (path.length) {
        case 4:
          {
            const cid = Number(path[3]) as SceneId
            const newRouting = value as Routing
            if (newRouting !== prev) {
              sendMidiParam('lr', 0, cid, 0, newRouting)
            }
          }
          break
        case 5:
          {
            const cid = Number(path[3]) as SceneId
            if (value !== prev) {
              sendMidiParam('lfo', 0, cid, 0, value as number)
            }
          }
          break
        case 6:
          {
            const sid = Number(path[3]) as SceneId
            const cid = Number(path[5]) as ChannelId
            const channel = value as Instrument
            const prevChannel = prev as Instrument
            syncInstrument(sid, cid, channel, prevChannel)
          }
          break
        case 7:
          {
            const sid = Number(path[3]) as SceneId
            const cid = Number(path[5]) as ChannelId
            const id = path[6] as ChannelParam
            if (value !== prev) {
              sendMidiParam(id, sid, cid, 0, value as number)
            }
          }
          break
        case 9:
          {
            const sid = Number(path[3]) as SceneId
            const cid = Number(path[5]) as ChannelId
            const oid = Number(path[7]) as OperatorId
            const id = path[8] as ChannelParam
            console.log(sid, cid, oid, id, value, prev)
            if (value !== prev) {
              sendMidiParam(id, sid, cid, oid, value as number)
            }
          }
          break
        default:
          break
      }
    }

    if (path[0] === 'pid') {
      const patch = state.patches[value as string]
      const prevPatch = state.patches[prev as string]
      for (const cid of CH_IDXS) {
        if (patch.routing[cid] === prevPatch.routing[cid]) continue
        sendMidiParam('lr', 0, cid, 0, patch.routing[cid])
      }
      for (const sid of SC_IDXS) {
        const scene = patch.scenes[sid]
        const prevScene = prevPatch.scenes[sid]
        if (scene.lfo !== prevScene.lfo) {
          sendMidiParam('lfo', sid, 0, 0, scene.lfo)
        }
        for (const cid of CH_IDXS) {
          const channel = scene.channels[cid]
          const prevChannel = prevScene.channels[cid]
          syncInstrument(sid, cid, channel, prevChannel)
        }
      }
    }
  })
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

const setParamValue = (
  id: Param,
  sid: SceneId,
  cid: ChannelId,
  op: OperatorId,
  value: number,
) => {
  const scene = state.patches[state.pid].scenes[sid]
  if (isSettingParam(id)) {
    state.settings[id] = value
  } else if (isSceneParam(id)) {
    scene[id] = value
  } else if (isChannelParam(id)) {
    scene.channels[cid][id] = value
  } else if (isOperatorParam(id)) {
    scene.channels[cid].operators[op][id] = value
  }
}

const updateParam = (id: Param, op: OperatorId, value: number) => {
  state.selection.forEach((s) => {
    setParamValue(id, s.sid, s.cid, op, value)
  })
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
  console.log('sending ', ch, cc, ccVal)
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

const syncMidi = () => {
  // clear all bindings first
  sendMidiCmd(MidiCommands.CLEAR_BINDINGS)

  // settings
  for (const id of SETTING_PARAMS) {
    sendMidiParam(id, 0, 0, 0, state.settings[id])
  }

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
  for (const cid of CH_IDXS) {
    sendMidiParam('lr', 0, cid, 0, state.patches[state.pid].routing[cid])
  }

  // scenes
  for (const sid of SC_IDXS) {
    const scene = state.patches[state.pid].scenes[sid]
    sendMidiParam('lfo', sid, 0, 0, scene.lfo)
    for (const cid of CH_IDXS) {
      const ch = scene.channels[cid]

      for (const id of CHANNEL_PARAMS) {
        sendMidiParam(id, sid, cid, 0, ch[id])
      }

      for (const o of OP_IDXS) {
        for (const id of OPERATOR_PARAMS) {
          sendMidiParam(id, sid, cid, o, ch.operators[o][id])
        }
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
    updateParam(k as OperatorParam, op, v)
  })
}

const resetChannel = () => {
  assignFromLibrary(INIT_INSTRUMENT_ID)
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
    return snap.patches[snap.pid].scenes[s.sid].channels[s.cid]
  })

  if (isSettingParam(id)) {
    const value = snap.settings[id]
    return { ccHint, value, mixed: false }
  } else if (isSceneParam(id)) {
    const value = snap.patches[state.pid].scenes[snap.selection[0].sid][id]
    const mixed = snap.selection.some(
      (s) => snap.patches[state.pid].scenes[s.sid][id] !== value,
    )
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

function addToLibrary(name: string, inst?: Instrument) {
  const instrument = deepClone(inst ? inst : initialInstrument)
  const id = crypto.randomUUID()

  state.library[id] = {
    id,
    instrument,
    hash: hashInstrument(instrument),
    system: false,
    name,
  }

  return id
}

function isChannelDirty(ch: Snapshot<Channel>, lib: Snapshot<Library>) {
  return hashInstrument(ch) !== lib[ch.origin].hash
}

const channelName = (ch: Snapshot<Channel>, lib: Snapshot<Library>) =>
  `${lib[ch.origin].name}${isChannelDirty(ch, lib) ? ' (*)' : ''}`

const assignFromLibrary = (id: string) => {
  const inst = state.library[id].instrument
  state.selection.forEach((s) => {
    state.patches[state.pid].scenes[s.sid].channels[s.cid] = {
      ...deepClone(inst),
      origin: id,
    }
  })
}

const assignFromChannel = (sid: number, cid: number) => {
  const ch = state.patches[state.pid].scenes[sid].channels[cid]
  state.selection.forEach((s) => {
    state.patches[state.pid].scenes[s.sid].channels[s.cid] = deepClone(ch)
  })
}

export {
  state,
  channelName,
  useParam,
  updateParam,
  useBinding,
  clearSequence,
  toggleParamBinding,
  bindAll,
  assignFromLibrary,
  assignFromChannel,
  addToLibrary,
  isChannelDirty,
  syncMidi,
  sendCrc32,
  saveState,
  resetChannel,
  resetOperator,
  createPatch,
}
