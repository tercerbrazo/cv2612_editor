/*

This util calculates the checksum of the module state, to be sent to the module

The checksum is a CRC14 of the whole module state, but we first need to layout
the module state in a linear array of bytes matching the module layout.

The module layout is as follows:
 * settings (1)
 * bindings (3)
 * patches (4)
  
Settings layout: (settings_t)
=============================

typedef struct {
  play_mode_t play_mode;
  midi_channel_t midi_recv_channel;
  polyphony_t polyphony;
  uint16_t sequence[6];
  uint8_t led_brightness : 7;
  uint8_t quantize : 1;
  uint8_t transpose : 7;
  uint8_t legato : 1;
  uint8_t tuning : 7;
  uint8_t velocity : 1;
  uint8_t portamento : 7;
  uint8_t __RESERVED : 1;
  uint8_t seq_steps : 4;
  uint8_t __ALIGN : 4;
} settings_t;

Bindings layout: (ch_bitmask_t)
===============================
typedef struct {
  uint8_t AR : 1;
  uint8_t D1R : 1;
  uint8_t D1L : 1;
  uint8_t D2R : 1;
  uint8_t TL : 1;
  uint8_t RR : 1;
  uint8_t DT1 : 1;
  uint8_t MUL : 1;
  uint8_t RS : 1;
  uint8_t AM : 1;
  uint8_t __ALIGN : 6;
} op_bitmask_t;

typedef struct {
  uint8_t LFO : 1;
  uint8_t LR : 1;
  uint8_t FB : 1;
  uint8_t ALG : 1;
  uint8_t AMS : 1;
  uint8_t FMS : 1;
  uint8_t __ALIGN : 2;
  op_bitmask_t ops[4];
} ch_bitmask_t;

Patch layout: (patch_t)
========================
typedef union {
  uint8_t REG;
  struct {
    uint8_t MUL : 4;
    uint8_t DT1 : 3;
  } bits;
} op_dt1_mul_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t TL : 7;
  } bits;
} op_tl_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t AR : 5;
    uint8_t RESERVED : 1;
    uint8_t RS : 2;
  } bits;
} op_rs_ar_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t D1R : 5;
    uint8_t RESERVED : 2;
    uint8_t AM : 1;
  } bits;
} op_am_d1r_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t D2R : 5;
  } bits;
} op_d2r_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t RR : 4;
    uint8_t D1L : 4;
  } bits;
} op_d1l_rr_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t SSG_EG : 4;
  } bits;
} op_ssg_eg_t;

typedef struct {
  op_dt1_mul_t DT1_MUL;
  op_tl_t TL;
  op_rs_ar_t RS_AR;
  op_am_d1r_t AM_D1R;
  op_d2r_t D2R;
  op_d1l_rr_t D1L_RR;
} operator_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t ALG : 3;
    uint8_t FB : 3;
  } bits;
} ch_fb_alg_t;

typedef union {
  uint8_t REG;
  struct {
    uint8_t FMS : 3;
    uint8_t AMS : 2;
    uint8_t RESERVED : 1;
    uint8_t LR : 2;
  } bits;
} ch_lr_ams_fms_t;

typedef struct {
  ch_fb_alg_t FB_ALG;
  ch_lr_ams_fms_t LR_AMS_FMS;
  operator_t operators[4]; // 6*4 bytes
} channel_t;               // 26 bytes

typedef union {
  uint8_t REG;
  struct {
    uint8_t LFO_F : 3;
    uint8_t LFO_E : 1;
  } bits;
} lfo_t;

typedef struct {
  lfo_t LFO;
  channel_t channels[6]; // 26*6 bytes
} patch_t;               // 157 bytes


*/

import { encodeKey, getParamMeta } from './paramsHelpers'

const CRC32_POLY = 0x04c11db7

// defined as cpp implementation
const crc32_push = (crc: number, data: number[]) => {
  for (let i = 0; i < data.length; ++i) {
    crc ^= data[i] << 24

    for (let bit = 0; bit < 8; ++bit) {
      if (crc & 0x80000000) {
        crc = (crc << 1) ^ CRC32_POLY
      } else {
        crc <<= 1
      }
    }

    crc >>>= 0 // force unsigned 32-bit
  }

  // force unsigned 32-bit
  return crc >>> 0
}

const calculate_crc32 = (state: State) => {
  const get = (id: Param, pid: number, cid: number, op: number) =>
    state.moduleState[
      encodeKey(id, pid as PatchId, cid as ChannelId, op as OperatorId)
    ]
  const getBinding = (binding: BindingKey, param: Param, op: OperatorId) => {
    const { bi } = getParamMeta(param, state, op)
    if (bi === undefined) return 0
    return state.bindings[binding].includes(bi) ? 1 : 0
  }

  // patches + bindings + settings
  const data: number[] = []

  // PATCHES
  // =======
  for (let pid = 0; pid < 4; pid++) {
    // for each patch

    const lfo = get('lfo', pid, 0, 0)
    // lfo_t
    data.push(lfo === 0 ? 0 : lfo | (1 << 3))

    for (let cid = 0; cid < 6; cid++) {
      // for each channel

      // ch_fb_alg_t
      data.push(get('al', pid, cid, 0) | (get('fb', pid, cid, 0) << 3))
      // ch_lr_ams_fms_t
      data.push(
        get('fms', pid, cid, 0) |
          (get('ams', pid, cid, 0) << 3) |
          (get('st', pid, cid, 0) << 6),
      )

      for (let op = 0; op < 4; op++) {
        // for each operator

        // op_dt1_mul_t;
        data.push(get('mul', pid, cid, op) | (get('det', pid, cid, op) << 4))
        // op_tl_t;
        data.push(get('tl', pid, cid, op))
        // op_rs_ar_t;
        data.push(get('ar', pid, cid, op) | (get('rs', pid, cid, op) << 6))
        // op_am_d1r_t;
        data.push(get('d1', pid, cid, op) | (get('am', pid, cid, op) << 7))
        // op_d2r_t;
        data.push(get('d2', pid, cid, op))
        // op_d1l_rr_t;
        data.push(get('rr', pid, cid, op) | (get('sl', pid, cid, op) << 4))
      }
    }
  }

  // BINDINGS
  // ========
  const bindings = Object.keys(state.bindings) as BindingKey[]
  // ch_bitmask_t
  for (let i = 0; i < bindings.length; i++) {
    const key = bindings[i]
    data.push(
      getBinding(key, 'lfo', 0) |
        (getBinding(key, 'st', 0) << 1) |
        (getBinding(key, 'fb', 0) << 2) |
        (getBinding(key, 'al', 0) << 3) |
        (getBinding(key, 'ams', 0) << 4) |
        (getBinding(key, 'fms', 0) << 5) |
        0,
    )
    for (let i = 0; i < 4; i++) {
      const op = i as OperatorId
      // op_bitmask_t
      data.push(
        getBinding(key, 'ar', op) |
          (getBinding(key, 'd1', op) << 1) |
          (getBinding(key, 'sl', op) << 2) |
          (getBinding(key, 'd2', op) << 3) |
          (getBinding(key, 'tl', op) << 4) |
          (getBinding(key, 'rr', op) << 5) |
          (getBinding(key, 'det', op) << 6) |
          (getBinding(key, 'mul', op) << 7),
      )
      data.push(getBinding(key, 'rs', op) | (getBinding(key, 'am', op) << 1))
    }
  }

  // SETTINGS
  // ========
  // play mode
  data.push(get('pm', 0, 0, 0))
  // midi recv channel
  data.push(get('rc', 0, 0, 0))
  // polyphony
  data.push(get('polyphony', 0, 0, 0))

  // sequence
  for (let i = 0; i < 6; i++) {
    const seq = state.sequence[i]
    // Convert 16-bit array into a number using reduce
    const value = seq.reduce((acc, bit, j) => acc | ((bit ? 1 : 0) << j), 0)
    // Split into two uint8_t
    const lower = value & 0xff
    const upper = (value >> 8) & 0xff
    console.log('seq', i, lower, upper)
    data.push(lower)
    data.push(upper)
  }

  // led brightness + quantize
  data.push(get('lb', 0, 0, 0) | (get('quantize', 0, 0, 0) << 7))
  // transpose + legato
  data.push(get('tr', 0, 0, 0) | (get('legato', 0, 0, 0) << 7))
  // tuning + velocity
  data.push(get('tu', 0, 0, 0) | (get('velocity', 0, 0, 0) << 7))
  // portamento + RESERVED
  data.push(get('portamento', 0, 0, 0))
  // seq steps + __ALIGN
  data.push(get('stp', 0, 0, 0))

  // calculate CRC 32 of the data
  let crc32 = 0
  crc32 = crc32_push(crc32, data)
  return crc32
}

export { calculate_crc32 }
