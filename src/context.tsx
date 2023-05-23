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

type ParamMeta = {
  key: string
  title: string
  label: string
  cc: number
  ch: number
  max: number
  bits: number
  options: string[]
  unbounded: boolean
}

// type CtrlData = Omit<CtrlMeta, 'bits'> & { value: number }
type ParamData = ParamMeta & { value: number }

type PatchId = 0 | 1 | 2 | 3
type ChannelId = 0 | 1 | 2 | 3 | 4 | 5
type OperatorId = 0 | 1 | 2 | 3

type ContextValue = {
  getParamData: (id: CtrlId, op: OperatorId) => ParamData
  state: State
  dispatch: React.Dispatch<Action>
}
const CV2612Context = React.createContext<ContextValue>(null)

const bindingsMap: Record<BindingKey, number> = { x: 110, y: 111, z: 112 }

enum SettingCtrlIdEnum {
  PATCH_ZONE = 'pz',
  BLEND = 'bl',
  PLAY_MODE = 'pm',
  LED_BRIGHTNESS = 'lb',
  TRANSPOSE = 'tr',
  TUNNING = 'tu',
  MIDI_RECEIVE_CHANNEL = 'rc',
  ATTENUVERTER_MODE = 'atm',
}

enum PatchCtrlIdEnum {
  LFO = 'lfo',
}

enum ChannelCtrlIdEnum {
  AL = 'al',
  FB = 'fb',
  AMS = 'ams',
  FMS = 'fms',
  ST = 'st',
}

enum OperatorCtrlIdEnum {
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

type SettingCtrlId = `${SettingCtrlIdEnum}`
type PatchCtrlId = `${PatchCtrlIdEnum}`
type ChannelCtrlId = `${ChannelCtrlIdEnum}`
type OperatorCtrlId = `${OperatorCtrlIdEnum}`
type CtrlId = SettingCtrlId | PatchCtrlId | ChannelCtrlId | OperatorCtrlId

type BindingKey = 'x' | 'y' | 'z'
type BindingValue = `${CtrlId}-${OperatorId}`
type Bindings = Record<BindingKey, BindingValue[]>

const isSettingCtrlId = (ctrlId: CtrlId): ctrlId is SettingCtrlId => {
  const keys: string[] = Object.values(SettingCtrlIdEnum)
  return keys.includes(ctrlId)
}

const isPatchCtrlId = (ctrlId: CtrlId): ctrlId is PatchCtrlId => {
  const keys: string[] = Object.values(PatchCtrlIdEnum)
  return keys.includes(ctrlId)
}

const isChannelCtrlId = (ctrlId: CtrlId): ctrlId is ChannelCtrlId => {
  const keys: string[] = Object.values(ChannelCtrlIdEnum)
  return keys.includes(ctrlId)
}

// const isOperatorCtrlId = (ctrlId: CtrlId): ctrlId is OperatorCtrlId => {
//   return ctrlId in OperatorCtrlIdEnum
// }

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
  bindingKey?: BindingKey
  bindings: Bindings
  envelopes: Record<number, string>
  moduleState: ModuleState
  patchIdx: PatchId
  channelIdx: ChannelId
}
type Action =
  | {
      type: 'provider-ready'
      savedState: State
    }
  | {
      type: 'touch-ctrl'
      id: CtrlId
      op: OperatorId
    }
  | {
      type: 'update-ctrl'
      id: CtrlId
      op: OperatorId
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
      op: OperatorId
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
      type: 'save-patch'
    }

const ctrlTitles: Record<CtrlId, string> = {
  pz: 'Patch Zone',
  bl: 'Blend',
  pm: 'Play Mode',
  lb: 'Led Brightness',
  tr: 'Transpose',
  tu: 'Tunning',
  rc: 'Midi Receive Channel',
  atm: 'Attenuverter Mode',
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

const ctrlBitness: Record<
  PatchCtrlId | ChannelCtrlId | OperatorCtrlId,
  number
> = {
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

const getCtrlOptions = (id: CtrlId): string[] => {
  switch (id) {
    case 'pz':
      return ['A- B', 'B - C', 'C - D']
    case 'pm':
      return ['MONO', 'DUO', 'TRIO', 'CHORD', 'CYCLE', 'RAND', 'POLY']
    case 'rc':
      return [
        'OMNI',
        'RESPECT',
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
    case 'atm':
      return ['AUTO', 'OFFSET', 'ATTENUVERTER']
    default:
      return []
  }
}

const getCtrlCh = (id: CtrlId, pid: PatchId, op: OperatorId): number => {
  switch (id) {
    case 'pz':
    case 'bl':
    case 'pm':
    case 'lb':
    case 'tr':
    case 'tu':
    case 'rc':
    case 'atm':
      return 16
    case 'lfo':
    case 'st':
    case 'ams':
    case 'fms':
    case 'al':
    case 'fb':
      return pid * 4
    case 'ar':
    case 'd1':
    case 'sl':
    case 'd2':
    case 'rr':
    case 'tl':
    case 'mul':
    case 'det':
    case 'rs':
    case 'am':
      return pid * 4 + op
    default:
      // shouldn't happen
      return 0
  }
}

const getCtrlCc = (id: CtrlId, cid: ChannelId): number => {
  switch (id) {
    case 'pz':
    case 'bl':
    case 'pm':
    case 'lb':
    case 'tr':
    case 'tu':
    case 'rc':
    case 'atm':
      return 0
    case 'lfo':
      return 9
    case 'al':
      return 10 + cid * 5
    case 'fb':
      return 11 + cid * 5
    case 'ams':
      return 12 + cid * 5
    case 'fms':
      return 13 + cid * 5
    case 'st':
      return 14 + cid * 5
    case 'ar':
      return 40 + cid * 10
    case 'd1':
      return 41 + cid * 10
    case 'sl':
      return 42 + cid * 10
    case 'd2':
      return 43 + cid * 10
    case 'rr':
      return 44 + cid * 10
    case 'tl':
      return 45 + cid * 10
    case 'mul':
      return 46 + cid * 10
    case 'det':
      return 47 + cid * 10
    case 'rs':
      return 48 + cid * 10
    case 'am':
      return 49 + cid * 10
    default:
      // shouldn't happen
      return 0
  }
}

const getCtrlUnbounded = (id: CtrlId): boolean => {
  switch (id) {
    case 'pz':
    case 'pm':
    case 'lb':
    case 'tr':
    case 'tu':
    case 'rc':
    case 'atm':
      return true
    // case 'bl':
    default:
      return false
  }
}

const getKey = (
  id: CtrlId,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId
): string => {
  if (isSettingCtrlId(id)) {
    return `${id}-0-0-0`
  }
  if (isPatchCtrlId(id)) {
    return `${id}-${pid}-0-0`
  }
  if (isChannelCtrlId(id)) {
    return `${id}-${pid}-${cid}-0`
  }
  // isOperatorCtrlId
  return `${id}-${pid}-${cid}-${op}`
}

const decodeKey = (key: string) => {
  const parts = key.split('-')

  return {
    id: parts[0] as CtrlId,
    pid: parseInt(parts[1], 10) as PatchId,
    cid: parseInt(parts[2], 10) as ChannelId,
    op: parseInt(parts[3], 10) as OperatorId,
  }
}

const getParamMeta = (
  id: CtrlId,
  pid: PatchId,
  cid: ChannelId,
  op: OperatorId
): ParamMeta => {
  const key = getKey(id, pid, cid, op)
  const ch = getCtrlCh(id, pid, op)
  const cc = getCtrlCc(id, cid)
  const label: string = id
  const bits = isSettingCtrlId(id) ? 7 : ctrlBitness[id]
  const title = ctrlTitles[id]
  const options = getCtrlOptions(id)
  const unbounded = getCtrlUnbounded(id)
  const max = 127 >> (7 - bits)

  return {
    title,
    label,
    unbounded,
    cc,
    ch,
    max,
    bits,
    options,
    key,
  }
}

const getInitialState = (): State => {
  const state: State = {
    bindings: { x: [], y: [], z: [] },
    envelopes: {},
    patchIdx: 0,
    channelIdx: 0,
    moduleState: {},
  }

  const setParamValue = (
    id: CtrlId,
    patchIdx: PatchId,
    channelIdx: ChannelId,
    op: OperatorId,
    val: number
  ) => {
    const { key } = getParamMeta(id, patchIdx, channelIdx, op)
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
  setParamValue('pm', 0, 0, 0, 0) // play mode
  setParamValue('lb', 0, 0, 0, 64) // led brigtness
  setParamValue('rc', 0, 0, 0, 0) // Midi Receive Channel
  setParamValue('atm', 0, 0, 0, 0) // Attenuverter mode
  setParamValue('tr', 0, 0, 0, 32) // transpose
  setParamValue('tu', 0, 0, 0, 64) // tuning
  setParamValue('bl', 0, 0, 0, 0) // blend

  return state
}

const initialState = getInitialState()

const updateEnvelope = (state: State, op: OperatorId) => {
  const getNormalizedValue = (id: CtrlId) => {
    const { bits, key } = getParamMeta(id, state.patchIdx, state.channelIdx, op)
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

const touchCtrl = (state: State, id: CtrlId, op: OperatorId) => {
  if (state.bindingKey) {
    const bindings = { ...state.bindings }

    const { ch, cc, key, bits } = getParamMeta(
      id,
      state.patchIdx,
      state.channelIdx,
      op
    )
    const bindingValue = `${id}-${op}` as BindingValue
    const exists = bindings[state.bindingKey].includes(bindingValue)

    if (exists) {
      bindings[state.bindingKey] = bindings[state.bindingKey].filter(
        (i) => i !== bindingValue
      )
    } else {
      bindings[state.bindingKey].push(bindingValue)
    }

    // re-send cc value (of first channel) just to make it the lastParameter
    const ccVal = state.moduleState[key] << (7 - bits)
    MidiIO.sendCC(ch, cc, ccVal)
    // bind parameter
    MidiIO.sendCC(0, bindingsMap[state.bindingKey], exists ? 0 : 127)

    return { ...state, bindings }
  }
  return state
}

const updateCtrl = (state: State, id: CtrlId, op: OperatorId, val: number) => {
  const { key, ch, cc, bits } = getParamMeta(
    id,
    state.patchIdx,
    state.channelIdx,
    op
  )

  state.moduleState[key] = val

  const ccVal = val << (7 - bits)
  MidiIO.sendCC(ch, cc, ccVal)

  const envelopes = { ...state.envelopes }

  // does this parameter change an envelope?
  // FIXME:  if (cc >= 30 && cc < 70 && cc % 10 <= 5) {
  envelopes[op] = updateEnvelope(state, op)
  // }

  return { ...state, envelopes }
}

const updateEnvelopes = (state: State) => {
  const envelopes = { ...state.envelopes }

  // TODO: do not asume envelopes have changed
  for (let op = 0; op < 4; op++) {
    envelopes[op] = updateEnvelope(state, op as OperatorId)
  }

  return { ...state, envelopes }
}

const syncMidi = (state: State) => {
  Object.entries(state.moduleState).forEach(([key, val]) => {
    const { id, pid, cid, op } = decodeKey(key)
    const { ch, cc, bits } = getParamMeta(id, pid, cid, op)
    const ccVal = val << (7 - bits)
    // sync midi cc
    MidiIO.sendCC(ch, cc, ccVal)
    // if (bindings) {
    //   // sync bindings
    //   MidiIO.sendCC(0, 110, bindings.x.includes(cc) ? 127 : 0)
    //   MidiIO.sendCC(0, 111, bindings.y.includes(cc) ? 127 : 0)
    //   MidiIO.sendCC(0, 112, bindings.z.includes(cc) ? 127 : 0)
    // }
  })
}

const resetOperator = (state: State, op: OperatorId) => {
  const updateAndSync = (id: CtrlId, val: number) => {
    const { key, ch, cc, bits } = getParamMeta(
      id,
      state.patchIdx,
      state.channelIdx,
      op
    )
    state.moduleState[key] = val
    // sync midi cc
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
  const updateAndSync = (id: CtrlId, val: number) => {
    const { key, ch, cc, bits } = getParamMeta(
      id,
      state.patchIdx,
      state.channelIdx,
      0
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
    3
  )
}

// TODO: udpateParams without sending MIDI out
const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'provider-ready':
      return updateEnvelopes(action.savedState ? action.savedState : state)
    case 'touch-ctrl':
      return touchCtrl(state, action.id, action.op)
    case 'update-ctrl':
      return updateCtrl(state, action.id, action.op, action.val)
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
      return updateEnvelopes({ ...state, patchIdx })
    }
    case 'move-patch': {
      // const { index, before } = action
      // const patches = [...state.patches]
      // if (index > before) {
      //   // move backwards: remove and insert
      //   patches.splice(index, 1)
      //   patches.splice(before, 0, state.patches[index])
      // } else if (index < before - 1) {
      //   // move forwards: insert and remove
      //   patches.splice(before, 0, state.patches[index])
      //   patches.splice(index, 1)
      // }
      // syncPatches({ patches })
      return updateEnvelopes({ ...state })
    }
    case 'copy-patch': {
      // const { source, target } = action
      // const patches = [...state.patches]
      // patches[target] = patches[source]
      // syncPatch({ patch: patches[target], index: target })
      return updateEnvelopes({ ...state })
    }
    case 'change-channel': {
      const channelIdx = action.index
      return updateEnvelopes({ ...state, channelIdx })
    }
    case 'move-channel': {
      // const { index, before } = action
      // // const patches = [...state.patches]
      // const patch = [...patches[state.patchIdx]]

      // if (index > before) {
      //   // move backwards: remove and insert
      //   patch.splice(index, 1)
      //   patch.splice(before, 0, patches[state.patchIdx][index])
      // } else if (index < before - 1) {
      //   // move forwards: insert and remove
      //   patch.splice(before, 0, patches[state.patchIdx][index])
      //   patch.splice(index, 1)
      // }

      // syncPatch({ patch, index: state.patchIdx })

      // patches[state.patchIdx] = patch
      return updateEnvelopes({ ...state })
    }
    case 'copy-channel': {
      // const { source, target } = action
      // // const patches = [...state.patches]
      // const patch = [...patches[state.patchIdx]]
      // patch[target] = patch[source]

      // // remove LFO, just in case it got copied over
      // delete patch[target][1]
      // patches[state.patchIdx] = patch
      // syncCcs({ channel: target, ccs: patch[target] })
      return updateEnvelopes({ ...state })
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
  const str = Object.values(state.moduleState).reduce(
    (acc, val: number) => acc + val.toString(16).padStart(2, '0'),
    ''
  )

  const output = compress(str, {
    outputEncoding: 'Base64',
  })

  return output
}

const decodeState = (output: string) => {
  const str = decompress(output, {
    inputEncoding: 'Base64',
  })

  const values = str
    .split(/(.{2})/)
    .filter((s: string) => s !== '')
    .map((s: string) => parseInt(s, 16))

  const { moduleState, bindings } = { ...initialState }

  Object.keys(moduleState).forEach((k) => {
    moduleState[k] = values.shift()
  })

  return { moduleState, bindings }
}

let saveId = null
const CV2612Provider = ({ children }) => {
  const [state, dispatch] = useReducer<Reducer<State, Action>>(
    reducer,
    initialState
  )

  const value = useMemo(() => {
    const getParamData = (id: CtrlId, op: OperatorId) => {
      const { patchIdx, channelIdx } = state
      const meta = getParamMeta(id, patchIdx, channelIdx, op)

      const { key } = meta
      const value = state.moduleState[key]

      // if (value === undefined) console.log(key, value)

      return {
        ...meta,
        value,
      }
    }

    return { state, getParamData, dispatch }
  }, [state])

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
        const savedState = { ...initialState, ...decodedState }
        dispatch({ type: 'provider-ready', savedState })
      } catch (e) {
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
  BindingValue,
  CtrlId,
  OperatorId,
  PatchId,
  ChannelId,
}
