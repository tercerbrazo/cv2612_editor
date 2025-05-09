import type {
  ChannelParamEnum,
  MidiChannelEnum,
  MidiCommands,
  OperatorParamEnum,
  PatchParamEnum,
  PlayModeEnum,
  SettingParamEnum,
} from './enums'

declare global {
  type PatchId = 0 | 1 | 2 | 3
  type ChannelId = 0 | 1 | 2 | 3 | 4 | 5
  type OperatorId = 0 | 1 | 2 | 3

  type SettingParam = `${SettingParamEnum}`
  type PatchParam = `${PatchParamEnum}`
  type ChannelParam = `${ChannelParamEnum}`
  type OperatorParam = `${OperatorParamEnum}`
  type Param = SettingParam | PatchParam | ChannelParam | OperatorParam
  type BindingKey = 'x' | 'y' | 'z'

  type ParamMeta = {
    title: string
    label: string
    max: number
    bits: number
    options: string[]
    bi?: number
  }

  type ParamData = ParamMeta & {
    value: number
    cc: number
    ch: number
    binding?: BindingKey
  }

  enum PlayModeEnum {
    MONO = 0,
    DUO = 1,
    TRIO = 2,
    CHORD = 3,
    SEQ = 4,
    RAND = 5,
    POLY = 6,
  }

  enum MidiChannelEnum {
    CH1 = 0,
    CH2 = 1,
    CH3 = 2,
    CH4 = 3,
    CH5 = 4,
    CH6 = 5,
    CH7 = 6,
    CH8 = 7,
    CH9 = 8,
    CH10 = 9,
    CH11 = 10,
    CH12 = 11,
    CH13 = 12,
    CH14 = 13,
    CH15 = 14,
    CH16 = 15,
    OMNI = 16,
    FORWARD = 17,
    MULTITRACK = 18,
  }

  /*
   * A ModuleState is the state of the CV2612 regarding sound design.
   * What defines it is the value of the whole parameters set,
   * which can be defined by a set of values.
   * The key is defined as `ctrlId-patchId-channelId-operatorId`
   * but to ensure keys are properly built, we should encode/decode them
   * with the provided helpers
   */
  type ModuleState = Record<string, number>

  type State = {
    name: string
    sequence: number[][]
    bindingKey?: BindingKey
    bindings: Record<BindingKey, number[]>
    moduleState: ModuleState
    patchIdx: PatchId
    channelIdx: ChannelId
    calibrationStep: number
    instrumentsLoader: boolean
  }
}
