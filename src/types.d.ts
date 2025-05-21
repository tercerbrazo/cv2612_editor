import type {
  ChannelParamEnum,
  MidiChannelEnum,
  MidiCommands,
  OperatorParamEnum,
  PatchParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from './enums'
import Operator from './operator'

declare global {
  type PatchId = 0 | 1 | 2 | 3
  type ChannelId = 0 | 1 | 2 | 3 | 4 | 5
  type OperatorId = 0 | 1 | 2 | 3
  type BindingId = 0 | 1 | 2 // x | y | z

  type SettingParam = `${SettingParamEnum}`
  type RoutingParam = 'lr'
  type PatchParam = `${PatchParamEnum}`
  type ChannelParam = `${ChannelParamEnum}`
  type OperatorParam = `${OperatorParamEnum}`
  type Param =
    | SettingParam
    | RoutingParam
    | PatchParam
    | ChannelParam
    | OperatorParam

  type ParamMeta = {
    title: string
    max: number
    bits: number
  }

  type ParamData = ParamMeta & {
    value: number
  }

  type Operator = Record<OperatorParam, number>

  type Channel = Record<ChannelParam, number> & {
    name: string
    operators: [Operator, Operator, Operator, Operator]
  }

  type Patch = {
    lfo: number
    channels: [Channel, Channel, Channel, Channel, Channel, Channel]
  }

  type Settings = Record<SettingParam, number> & {
    sequence: number[][]
  }

  type Bindings = number[] // an array of binding indexes

  type Routing = 0b00 | 0b01 | 0b10 | 0b11

  type State = {
    // a way to migrate old persisted states
    version: number

    name: string

    // actual module state
    settings: Settings
    patches: [Patch, Patch, Patch, Patch]
    bindings: [Bindings, Bindings, Bindings]
    routing: [Routing, Routing, Routing, Routing, Routing, Routing]

    // current editor parameters page
    patchIdx: PatchId
    channelIdx: ChannelId
    // mapping parameters?
    bindingId?: BindingId
    // TODO: turn into views?
    calibrationStep: number
    instrumentsLoader: boolean

    // instruments library
    library: Channel[]
  }
}
