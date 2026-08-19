import {
  ChannelParamEnum,
  MidiCommands,
  OperatorParamEnum,
  SettingParamEnum,
} from './enums'
import MidiIO from './midi-io'
import { calculate_crc32 } from './utils/checksum'
import { buildSyncMessages } from './utils/syncMessages'
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
import {
  subscribe as vanillaSubscribe,
  unstable_enableOp,
} from 'valtio/vanilla'
import { deepClone } from 'valtio/utils'
import initialLibraryJson from './instruments.json'

// valtio v2: subscribe ops are opt-in
unstable_enableOp()
const INIT_INSTRUMENT_ID = 'sys_init'

const SC_IDXS = [0, 1, 2, 3] as const
const CH_IDXS = [0, 1, 2, 3, 4, 5] as const
const OP_IDXS = [0, 1, 2, 3] as const
const SETTING_PARAMS = Object.values(SettingParamEnum)
const CHANNEL_PARAMS = Object.values(ChannelParamEnum)
const OPERATOR_PARAMS = Object.values(OperatorParamEnum)

//TODO: redo library json with new data shape
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
  // mirrors the firmware's DEFAULT_SETTINGS: a fresh editor and a fresh
  // module must agree, or the very first CRC check reads as a mismatch
  lb: 127,
  tr: 64,
  pm: 0,
  tu: 64,
  rc: 16,
  stp: 4, // firmware DEFAULT_SETTINGS.sequence_steps
  vs: 64,
  portamento: 0,
  pbu: 12,
  pbd: 12,
  mmx: 2,
  mmy: 2,
  mmz: 2,
  qz: 0,
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

const CURRENT_VERSION = 15
const initialState: State = {
  version: CURRENT_VERSION,
  bindings: [[], [], []],
  settings: initialSettings,
  library: initialLibrary,
  patches: initialPatches,
  pid: initialPatch.id,
  selection: [{ sid: 0, cid: 0 }],
  browserOn: false,
  browserCategory: '',
  browserType: 'library',
}

// a persisted/backup state is safe to boot from only if these load-bearing
// fields are structurally intact; a version match alone let a truncated file
// through and bricked the first render (patch.tsx reads patches[pid].scenes)
const isRestorableState = (s: any): boolean =>
  !!s &&
  typeof s === 'object' &&
  !Array.isArray(s) &&
  s.version === CURRENT_VERSION &&
  !!s.patches &&
  typeof s.patches === 'object' &&
  !Array.isArray(s.patches) &&
  typeof s.pid === 'string' &&
  s.pid in s.patches &&
  Array.isArray(s.selection) &&
  s.selection.length > 0 &&
  !!s.settings &&
  typeof s.settings === 'object' &&
  !!s.library &&
  typeof s.library === 'object' &&
  Array.isArray(s.bindings)

const getInitialState = () => {
  const lastStateStr = localStorage.getItem('lastState')
  if (lastStateStr !== null) {
    // bad JSON here would blank the app at load; tolerate it
    let lastState: any = null
    try {
      lastState = JSON.parse(lastStateStr)
    } catch {
      console.error('lastState is corrupt, starting fresh')
    }
    if (isRestorableState(lastState)) {
      // backfill settings added after this state was persisted, so a new
      // setting is not `undefined` on load (it would be sent as NaN on sync)
      return {
        ...lastState,
        settings: { ...initialSettings, ...lastState.settings },
      } as State
    } else if (lastState) {
      // wrong version or structurally broken: boot fresh, never crash on it
      console.error('lastState unusable, starting fresh', lastState.version)
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
            // path[3] is the SCENE index — sending it as the channel routed
            // live lfo edits of scenes B/C/D onto scene A's CC map
            const sid = Number(path[3]) as SceneId
            if (value !== prev) {
              sendMidiParam('lfo', sid, 0, 0, value as number)
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
            // non-midi fields (e.g. origin) also land here; the filter below
            // keeps them off the wire as garbage CCs
            if (CHANNEL_PARAMS.includes(id) && value !== prev) {
              sendMidiParam(id, sid, cid, 0, value as number)
            }
          }
          break
        case 9:
          {
            const sid = Number(path[3]) as SceneId
            const cid = Number(path[5]) as ChannelId
            const oid = Number(path[7]) as OperatorId
            const id = path[8] as OperatorParam
            if (OPERATOR_PARAMS.includes(id) && value !== prev) {
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
  // clamp to the param's declared range: MidiIO.sendCC masks the data byte with
  // & 0x7f, so an out-of-range val (e.g. from a lax instrument import) would wrap
  // to a wrong CC silently. Catch the whole class here rather than per-parser.
  const max = (1 << bits) - 1
  const clamped = val < 0 ? 0 : val > max ? max : val
  if (clamped !== val) {
    console.warn(`param ${id}: value ${val} out of range [0,${max}], clamped`)
  }
  // sync midi cc
  const ccVal = clamped << (7 - bits)
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
    // !== undefined: lfo's binding index is 0, which is falsy
    if (bi !== undefined) {
      state.bindings[modulator].push(bi)
    }
  })

  const opParams: Param[] = ['ar', 'd1', 'sl', 'd2', 'rr', 'tl', 'mul', 'det']
  opParams.forEach((id) => {
    for (let o = 0; o < 4; o++) {
      const bi = getParamBindingIndex(id, o as OperatorId)
      if (bi !== undefined) {
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
  // the message list IS the protocol — see utils/syncMessages.ts, shared
  // with the wire-level tests against the firmware's native suite
  for (const [ch, cc, val] of buildSyncMessages(state)) {
    MidiIO.sendCC(ch, cc, val)
  }
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

// Captures the module's own resting levels (pitch, X/Y/Z, trimmer centres)
// into its EEPROM. Every unit rests at slightly different ADC counts and the
// compiled defaults only fit one of them, so an uncalibrated module plays
// sharp or flat by whatever its own offset is. Needs no telemetry, which
// matters because production firmware ships without it.
const calibrateRests = () => {
  sendMidiCmd(MidiCommands.SET_CALIBRATION_STEP, 9)
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

// restore a Save-Backup json: reject a wrong-version or malformed file (returns
// the reason), else persist it and reboot through the same localStorage path
// getInitialState uses, so the reload gets the version-check and settings backfill
const loadBackup = (raw: string): string | null => {
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'Not a valid JSON file.'
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Not an editor backup.'
  }
  if (parsed.version !== CURRENT_VERSION) {
    return `Backup is version ${parsed.version ?? '?'}; this editor is ${CURRENT_VERSION}.`
  }
  if (!isRestorableState(parsed)) {
    return 'Backup is incomplete or corrupt; not loading it.'
  }
  if (
    !window.confirm(
      'Replace the current editor state with this backup? Unsaved changes are lost.',
    )
  ) {
    return null
  }
  // reload must immediately follow the write: the state subscribe rewrites
  // lastState on any mutation, which would clobber the backup before navigation
  localStorage.setItem('lastState', JSON.stringify(parsed))
  window.location.reload()
  return null
}

export {
  state,
  loadBackup,
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
  calibrateRests,
  resetChannel,
  resetOperator,
  createPatch,
}
