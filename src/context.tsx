import { compress, decompress } from 'lzutf8'
import React, {
  Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from 'react'
import MidiIO from './midi-io'
import { calculateEnvelopePoints } from './utils/envelopePoints'

type ContextValue = { state: State; dispatch: React.Dispatch<Action> }
const CV2612Context = React.createContext<ContextValue>(null)

/*
 * A Patch is the state of the YM2612 regarding sound design.
 * What defines a patch is the value of the whole parameters set,
 * which can be defined by a set of CC values.
 */
const bindingsMap: Record<BindingKey, number> = { x: 110, y: 111, z: 112 }

type BindingKey = 'x' | 'y' | 'z'
type Bindings = Record<BindingKey, number[]>
type Ccs = Record<number, number>
type State = {
  bindingKey?: BindingKey
  bindings: Bindings
  envelopes: Record<number, string>
  patches: Ccs[][]
  settings: Ccs
  patchIdx: number
  channelIdx: number
}
type Action =
  | {
      type: 'provider-ready'
      savedState: State
    }
  | {
      type: 'touch-param'
      patchIdx: number
      cc: number
    }
  | {
      type: 'update-param'
      patchIdx: number
      channelIdx: number
      cc: number
      val: number
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
      op: number
    }
  | {
      type: 'change-patch'
      index: number
    }
  | {
      type: 'move-patch'
      index: number
      before: number
    }
  | {
      type: 'copy-patch'
      source: number
      target: number
    }
  | {
      type: 'change-channel'
      index: number
    }
  | {
      type: 'move-channel'
      index: number
      before: number
    }
  | {
      type: 'copy-channel'
      source: number
      target: number
    }
  | {
      type: 'sync-midi'
    }
  | {
      type: 'save-patch'
    }

const getInitialState = (): State => {
  const state: State = {
    bindings: { x: [], y: [], z: [] },
    envelopes: {},
    patchIdx: 0,
    patches: [],
    settings: {},
    channelIdx: 0,
  }

  for (let i = 0; i < 4; i++) {
    const channels = []

    for (let i = 0; i < 6; i++) {
      const ccs = {
        20: 7 << (7 - 3), // al
        21: 0, // fb
        22: 0, // ams
        23: 0, // fms
        24: 3 << (7 - 2), // st
      }
      for (let op = 0; op < 4; op++) {
        ccs[`${30 + op * 10 + 0}`] = 127 // ar
        ccs[`${30 + op * 10 + 1}`] = 0 // d1
        ccs[`${30 + op * 10 + 2}`] = 0 // sl
        ccs[`${30 + op * 10 + 3}`] = 0 // d2
        ccs[`${30 + op * 10 + 4}`] = 127 // rr
        ccs[`${30 + op * 10 + 5}`] = 0 // tl
        ccs[`${30 + op * 10 + 6}`] = 32 // mul
        ccs[`${30 + op * 10 + 7}`] = 64 // det
        ccs[`${30 + op * 10 + 8}`] = 0 // rs
        ccs[`${30 + op * 10 + 9}`] = 0 // am
      }
      channels.push(ccs)
    }
    channels[0][1] = 0 // lfo

    state.patches.push(channels)
  }

  // add globals settings
  state.settings[90] = 0 /// play mode
  state.settings[91] = 64 // led brigtness
  state.settings[92] = 0 // Midi Receive Channel
  state.settings[93] = 0 // Attenuverter mode
  state.settings[94] = 64 // transpose
  state.settings[95] = 64 // tuning
  state.settings[118] = 0 // blend zone
  state.settings[119] = 0 // blend

  return state
}

const initialState = getInitialState()

const updateEnvelope = (ccs: Ccs, op: number) => {
  const ar = ccs[30 + 10 * op + 0] / 127
  const d1 = ccs[30 + 10 * op + 1] / 127
  const sl = ccs[30 + 10 * op + 2] / 127
  const d2 = ccs[30 + 10 * op + 3] / 127
  const rr = ccs[30 + 10 * op + 4] / 127
  const tl = ccs[30 + 10 * op + 5] / 127

  return calculateEnvelopePoints({ ar, d1, sl, d2, rr, tl })
}

const touchParam = (state: State, patchIdx: number, cc: number) => {
  if (state.bindingKey) {
    const bindings = { ...state.bindings }

    const exists = bindings[state.bindingKey].includes(cc)

    if (exists) {
      bindings[state.bindingKey] = bindings[state.bindingKey].filter(
        (i) => i !== cc
      )
    } else {
      bindings[state.bindingKey].push(cc)
    }

    // re-send cc value (of first channel) just to make it the lastParameter
    const patch = state.patches[patchIdx]
    MidiIO.sendCC(0, cc, patch[0][cc])
    // bind parameter
    MidiIO.sendCC(0, bindingsMap[state.bindingKey], exists ? 0 : 127)

    return { ...state, bindings }
  }
  return state
}

const updateParam = (
  state: State,
  patchIdx: number,
  channelIdx: number,
  cc: number,
  val: number
) => {
  const patch = state.patches[patchIdx]

  // update patch state
  patch[channelIdx][cc] = val

  MidiIO.sendCC(channelIdx, cc, val)

  const envelopes = { ...state.envelopes }

  // does this parameter change an envelope?
  if (cc >= 30 && cc < 70 && cc % 10 <= 5) {
    // get operator index from cc
    const op = Math.floor((cc - 30) / 10)

    envelopes[op] = updateEnvelope(patch[channelIdx], op)
  }

  return { ...state, envelopes }
}

const updateEnvelopes = (state: State) => {
  const envelopes = { ...state.envelopes }
  const patch = state.patches[state.patchIdx]
  const ch = state.channelIdx

  // TODO: do not asume envelopes have changed
  for (let op = 0; op < 4; op++) {
    envelopes[op] = updateEnvelope(patch[ch], op)
  }

  return { ...state, envelopes }
}

type SyncCcsArgs = {
  channel: number
  bindings?: Bindings
  ccs: Ccs
}

const syncCcs = ({ channel, bindings, ccs }: SyncCcsArgs) => {
  Object.entries(ccs).forEach(([key, val]) => {
    const cc = parseInt(key, 10)
    // sync midi cc
    MidiIO.sendCC(channel, cc, val)
    if (bindings) {
      // sync bindings
      MidiIO.sendCC(0, 110, bindings.x.includes(cc) ? 127 : 0)
      MidiIO.sendCC(0, 111, bindings.y.includes(cc) ? 127 : 0)
      MidiIO.sendCC(0, 112, bindings.z.includes(cc) ? 127 : 0)
    }
  })
}

type SyncPatchArgs = {
  patch: Ccs[]
  index: number
  bindings?: Bindings
}
const syncPatch = ({ patch, index, bindings }: SyncPatchArgs) => {
  MidiIO.sendCC(0, 120, index)
  patch.forEach((ccs, channel) => {
    syncCcs({ channel, bindings: channel === 0 ? bindings : undefined, ccs })
  })
}

type SyncPatchesArgs = {
  patches: Ccs[][]
  bindings?: Bindings
}
const syncPatches = ({ patches, bindings }: SyncPatchesArgs) => {
  // sync each patch
  for (let index = 0; index < 4; index++) {
    const patch = patches[index]
    syncPatch({ patch, index, bindings: index === 0 ? bindings : undefined })
  }
}

const syncMidi = (state: State) => {
  syncPatches({ patches: state.patches, bindings: state.bindings })
  // sync settings
  syncCcs({ channel: 0, bindings: state.bindings, ccs: state.settings })
}

const resetOperator = (state: State, op: number) => {
  const patch = state.patches[state.patchIdx]
  const ch = state.channelIdx

  const updateAndSync = (cc: number, val: number) => {
    // update patch state
    patch[ch][cc] = val
    // sync midi cc
    MidiIO.sendCC(ch, cc, val)
  }

  updateAndSync(30 + op * 10 + 0, 127)
  updateAndSync(30 + op * 10 + 1, 0)
  updateAndSync(30 + op * 10 + 2, 0)
  updateAndSync(30 + op * 10 + 3, 0)
  updateAndSync(30 + op * 10 + 4, 127)
  updateAndSync(30 + op * 10 + 5, 0)

  updateAndSync(30 + op * 10 + 6, 32)
  updateAndSync(30 + op * 10 + 7, 64)
  updateAndSync(30 + op * 10 + 8, 0)
  updateAndSync(30 + op * 10 + 9, 0)

  return state
}

const resetChannel = (state: State) => {
  const patch = state.patches[state.patchIdx]
  const ch = state.channelIdx

  const updateAndSync = (ch: number, cc: number, val: number) => {
    // update patch state
    patch[ch][cc] = val
    // sync midi cc
    MidiIO.sendCC(ch, cc, val)
  }

  updateAndSync(0, 1, 0)
  updateAndSync(ch, 20, 127)
  updateAndSync(ch, 21, 0)
  updateAndSync(ch, 22, 0)
  updateAndSync(ch, 23, 0)
  updateAndSync(ch, 24, 127)

  return resetOperator(
    resetOperator(resetOperator(resetOperator(state, 0), 1), 2),
    3
  )
}

// TODO: udpateParams without sending MIDI out
const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'provider-ready':
      return updateEnvelopes(action.savedState ? action.savedState : state)
    case 'touch-param':
      return touchParam(state, action.patchIdx, action.cc)
    case 'update-param':
      return updateParam(
        state,
        action.patchIdx,
        action.channelIdx,
        action.cc,
        action.val
      )
    case 'toggle-binding':
      return {
        ...state,
        bindingKey:
          action.bindingKey === state.bindingKey
            ? undefined
            : action.bindingKey,
      }
    case 'reset-channel':
      return updateEnvelopes(resetChannel(state))
    case 'reset-operator':
      return updateEnvelopes(resetOperator(state, action.op))
    case 'change-patch': {
      const patchIdx = action.index
      MidiIO.sendCC(0, 120, patchIdx)
      return updateEnvelopes({ ...state, patchIdx })
    }
    case 'move-patch': {
      const { index, before } = action
      const patches = [...state.patches]
      if (index > before) {
        // move backwards: remove and insert
        patches.splice(index, 1)
        patches.splice(before, 0, state.patches[index])
      } else if (index < before - 1) {
        // move forwards: insert and remove
        patches.splice(before, 0, state.patches[index])
        patches.splice(index, 1)
      }
      syncPatches({ patches })
      return updateEnvelopes({ ...state, patches })
    }
    case 'copy-patch': {
      const { source, target } = action
      const patches = [...state.patches]
      patches[target] = patches[source]
      syncPatch({ patch: patches[target], index: target })
      return updateEnvelopes({ ...state, patches })
    }
    case 'change-channel': {
      const channelIdx = action.index
      return updateEnvelopes({ ...state, channelIdx })
    }
    case 'move-channel': {
      const { index, before } = action
      const patches = [...state.patches]
      const patch = [...patches[state.patchIdx]]

      const lfo = patch[0][1]
      // remove LFO to avoid copying it
      delete patch[0][1]

      if (index > before) {
        // move backwards: remove and insert
        patch.splice(index, 1)
        patch.splice(before, 0, patches[state.patchIdx][index])
      } else if (index < before - 1) {
        // move forwards: insert and remove
        patch.splice(before, 0, patches[state.patchIdx][index])
        patch.splice(index, 1)
      }

      // restore LFO
      patch[0][1] = lfo

      syncPatch({ patch, index: state.patchIdx })

      patches[state.patchIdx] = patch
      return updateEnvelopes({ ...state, patches })
    }
    case 'copy-channel': {
      const { source, target } = action
      const patches = [...state.patches]
      const patch = [...patches[state.patchIdx]]
      patch[target] = patch[source]

      // remove LFO, just in case it got copied over
      delete patch[target][1]
      patches[state.patchIdx] = patch
      syncCcs({ channel: target, ccs: patch[target] })
      return updateEnvelopes({ ...state, patches })
    }
    case 'sync-midi':
      syncMidi(state)
      return state
    case 'save-patch': {
      MidiIO.sendCC(0, 121, 127) // value is not read anyway
      const savedState = { ...state, bindinKey: undefined }
      // reactLocalStorage.set("savedState", JSON.stringify(savedState))
      return savedState
    }
    default:
      throw new Error('Invalid action type')
  }
}

const encodeState = (state: State) => {
  const patches = state.patches.reduce(
    (acc, p) =>
      acc +
      p.reduce(
        (acc, ccs) =>
          acc +
          Object.values(ccs).reduce(
            (acc, val: number) => acc + val.toString(16).padStart(2, '0'),
            ''
          ),
        ''
      ),
    ''
  )

  const bindings = Object.values(state.bindings).reduce(
    (acc, p) =>
      `${acc}|${p.reduce(
        (pacc, ccs) => pacc + ccs.toString(16).padStart(2, '0'),
        ''
      )}`,
    ''
  )

  const settings = Object.values(state.settings).reduce(
    (acc, val: number) => acc + val.toString(16).padStart(2, '0'),
    ''
  )

  const output = compress(`${patches}${bindings}|${settings}`, {
    outputEncoding: 'Base64',
  })

  return output
}

const decodeState = (str: string) => {
  const output = decompress(str, {
    inputEncoding: 'Base64',
  })

  const values = output.split('|').map((s: string) =>
    s
      .split(/(.{2})/)
      .filter((s: string) => s)
      .map((s: string) => parseInt(s, 16))
  )

  const { patches, bindings, settings } = { ...initialState }

  const patchValues = values.shift()
  patches.forEach((p) => {
    p.forEach((ch) => {
      Object.keys(ch).forEach((k) => {
        if (patchValues.length) {
          ch[k] = patchValues.shift()
        }
      })
    })
  })

  Object.keys(bindings).forEach((k) => {
    const bindingValues = values.shift()
    if (bindingValues) {
      bindings[k] = [...bindingValues]
    }
  })

  const settingsValues = values.shift()
  if (settingsValues) {
    Object.keys(settings).forEach((k) => {
      if (settingsValues.length) {
        settings[k] = settingsValues.shift()
      }
    })
  }

  return { patches, bindings, settings }
}

let saveId = null
const CV2612Provider = ({ children }) => {
  const [state, dispatch] = useReducer<Reducer<State, Action>>(
    reducer,
    initialState
  )
  const value = useMemo(() => ({ state, dispatch }), [state])

  const doSaveState = useCallback(() => {
    const str = encodeState(state)

    // push the state
    window.history.pushState(null, null, `#${str}`)
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
      // const str = await reactLocalStorage.get("savedState")
      // const savedState = str ? JSON.parse(str) : null
      // dispatch({ type: "provider-ready", savedState })
      try {
        const parts = window.location.hash.split('#')
        const str = parts[1]
        const decodedState = decodeState(str)
        const savedState = { ...state, ...decodedState }
        dispatch({ type: 'provider-ready', savedState })
      } catch (e) {
        dispatch({ type: 'provider-ready', savedState: state })
      }
    })()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <CV2612Context.Provider value={value}>{children}</CV2612Context.Provider>
  )
}

export { CV2612Context, CV2612Provider, BindingKey }
