// only enums
enum SettingParamEnum {
  PLAY_MODE = 'pm',
  LED_BRIGHTNESS = 'lb',
  TRANSPOSE = 'tr',
  TUNNING = 'tu',
  MIDI_RECEIVE_CHANNEL = 'rc',
  SEQ_STEPS = 'stp',
  // not used in the editor yet:
  QUANTIZE = 'quantize',
  LEGATO = 'legato',
  VELOCITY = 'velocity',
  PORTAMENTO = 'portamento',
  POLYPHONY = 'polyphony',
}

enum PatchParamEnum {
  LFO = 'lfo',
}

enum ChannelParamEnum {
  AL = 'al',
  FB = 'fb',
  AMS = 'ams',
  FMS = 'fms',
}

enum OperatorParamEnum {
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

enum MidiCommands {
  BIND_X = 101,
  BIND_Y = 102,
  BIND_Z = 103,
  COPY_PATCH = 104,
  MOVE_PATCH = 105,
  COPY_CHANNEL = 106,
  MOVE_CHANNEL = 107,
  SET_SEQ_STEP_ON = 108,
  SET_SEQ_STEP_OFF = 109,
  SAVE_STATE = 110,
  CLEAR_SEQ = 111,
  CLEAR_BINDINGS = 112,
  SET_CALIBRATION_STEP = 113,
  TOGGLE_DEBUG = 114,
  SEND_CRC32_CHUNK = 115,
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

export {
  SettingParamEnum,
  PatchParamEnum,
  ChannelParamEnum,
  OperatorParamEnum,
  MidiCommands,
  PlayModeEnum,
  MidiChannelEnum,
}
