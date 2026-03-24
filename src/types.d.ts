import type {
  ChannelParamEnum,
  MidiChannelEnum,
  MidiCommands,
  OperatorParamEnum,
  SceneParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from './enums'
import Operator from './operator'

declare global {
  type SceneId = 0 | 1 | 2 | 3
  type ChannelId = 0 | 1 | 2 | 3 | 4 | 5
  type OperatorId = 0 | 1 | 2 | 3
  type BindingId = 0 | 1 | 2 // x | y | z

  type ChannelRef = {
    sid: SceneId
    cid: ChannelId
  }

  type SettingParam = `${SettingParamEnum}`
  type RoutingParam = 'lr'
  type SceneParam = `${SceneParamEnum}`
  type ChannelParam = `${ChannelParamEnum}`
  type OperatorParam = `${OperatorParamEnum}`
  type Param =
    | SettingParam
    | RoutingParam
    | SceneParam
    | ChannelParam
    | OperatorParam

  type ParamMeta = {
    title: string
    max: number
    bits: number
  }

  type Operator = Record<OperatorParam, number>

  type Instrument = Record<ChannelParam, number> & {
    operators: [Operator, Operator, Operator, Operator]
  }

  type Channel = Instrument & {
    origin: string
  }

  type LibraryEntry = {
    id: string
    name: string
    hash: number
    system: boolean
    instrument: Instrument
  }

  type Library = Record<string, LibraryEntry>

  type Scene = {
    lfo: number
    channels: [Channel, Channel, Channel, Channel, Channel, Channel]
  }

  type Settings = Record<SettingParam, number> & {
    sequence: number[][]
  }

  type Bindings = number[] // an array of binding indexes

  type Routing = 0b00 | 0b01 | 0b10 | 0b11

  type Patch = {
    id: string
    name: string
    scenes: [Scene, Scene, Scene, Scene]
    routing: [Routing, Routing, Routing, Routing, Routing, Routing]
  }

  type State = {
    // a way to migrate old persisted states
    version: number

    // actual module state
    settings: Settings
    bindings: [Bindings, Bindings, Bindings]
    patches: Record<string, Patch>

    // currently selected patch id
    pid: string

    // current scenes/channels selection
    selection: ChannelRef[]
    browserOn: boolean
    browserType: 'library' | 'patch'
    browserCategory: string

    // mapping parameters?
    bindingId?: BindingId

    // instruments library
    library: Library
  }
}
