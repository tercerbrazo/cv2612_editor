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
type Patch = Ccs[]
type State = {
  bindingKey?: BindingKey
  bindings: Bindings
  envelopes: Record<number, string>
  patches: Patch[]
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
      ch: number
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
      type: 'change-channel'
      index: number
    }
  | {
      type: 'sync-midi'
    }
  | {
      type: 'save-patch'
    }

const emptyPatch = (): Patch => {
  const ccsPerChannel = []

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
    ccsPerChannel.push(ccs)
  }
  ccsPerChannel[0][1] = 0 // lfo

  return ccsPerChannel
}

const emptyPatches = (): Patch[] => {
  const patches = []
  for (let i = 0; i < 4; i++) {
    patches.push(emptyPatch())
  }
  // add globals to patch A
  patches[0][0][94] = 64 // transpose
  patches[0][0][95] = 64 // tuning
  patches[0][0][119] = 0 // blend
  return patches
}

const initialState: State = {
  bindings: { x: [], y: [], z: [] },
  envelopes: {},
  patches: emptyPatches(),
  patchIdx: 0,
  channelIdx: 0,
}

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
  ch: number,
  cc: number,
  val: number
) => {
  const patch = state.patches[patchIdx]

  // update patch state
  patch[ch][cc] = val

  MidiIO.sendCC(ch, cc, val)

  const envelopes = { ...state.envelopes }

  // does this parameter change an envelope?
  if (cc >= 30 && cc < 70 && cc % 10 <= 5) {
    // get operator index from cc
    const op = Math.floor((cc - 30) / 10)

    envelopes[op] = updateEnvelope(patch[ch], op)
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

const syncMidi = (state: State) => {
  for (let i = 0; i < 4; i++) {
    MidiIO.sendCC(0, 120, i)
    const patch = state.patches[i]
    patch.forEach((ccs, ch) => {
      Object.entries(ccs).forEach(([key, val]) => {
        const cc = parseInt(key, 10)
        // sync midi cc
        MidiIO.sendCC(ch, cc, val)
        if (i === 0 && ch === 0) {
          // sync bindings
          MidiIO.sendCC(0, 110, state.bindings.x.includes(cc) ? 127 : 0)
          MidiIO.sendCC(0, 111, state.bindings.y.includes(cc) ? 127 : 0)
          MidiIO.sendCC(0, 112, state.bindings.z.includes(cc) ? 127 : 0)
        }
      })
    })
  }
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
        action.ch,
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
    case 'change-channel': {
      const channelIdx = action.index
      return updateEnvelopes({ ...state, channelIdx })
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

  const output = compress(`${patches}${bindings}`, {
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

  const { patches, bindings } = { ...initialState }

  const patchValues = values.shift()
  patches.forEach((p) => {
    p.forEach((ch) => {
      Object.keys(ch).forEach((k) => {
        ch[k] = patchValues.shift()
      })
    })
  })

  Object.keys(bindings).forEach((k) => {
    const bindingValues = values.shift()
    bindings[k] = [...bindingValues]
  })

  return { patches, bindings }
}

let saveId = null
function CV2612Provider({ children }) {
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
      const parts = window.location.hash.split('#')
      if (parts.length === 2) {
        const str = parts[1]
        const savedState = { ...state, ...decodeState(str) }
        dispatch({ type: 'provider-ready', savedState })
      }
    })()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <CV2612Context.Provider value={value}>{children}</CV2612Context.Provider>
  )
}

export { CV2612Context, CV2612Provider, BindingKey }
