/*

This util calculates the checksum of the module state, to be sent to the module

The checksum is a CRC14 of the whole module state, but we first need to layout
the module state in a linear array of bytes matching the module layout.

The module layout is as follows:
 * settings (1)
 * bindings (3)
 * scenes (4)
  
Settings layout: (settings_t)
=============================

typedef struct {
  play_mode_t play_mode;
  midi_channel_t midi_recv_channel;
  uint8_t transpose;
  uint8_t tuning;
  uint8_t led_brightness;
  uint16_t sequence[6];
  uint8_t sequence_steps;
  uint8_t portamento;
  uint8_t pitch_bend_up;
  uint8_t pitch_bend_down;
  uint8_t velocity_sensitivity;
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
} op_bitmask_t;

typedef struct {
  uint8_t LFO : 1;
  uint8_t FB : 1;
  uint8_t ALG : 1;
  uint8_t AMS : 1;
  uint8_t FMS : 1;
  uint8_t __ALIGN : 3;
  op_bitmask_t ops[4];
} ch_bitmask_t;

Scene layout: (scene_t)
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
} scene_t;               // 157 bytes


*/

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
  // scenes + bindings + settings
  const data: number[] = []

  // SCENES
  // =======
  for (let sid = 0; sid < 4; sid++) {
    const scene = state.scenes[sid]
    // lfo_t
    data.push(scene.lfo === 0 ? 0 : scene.lfo | (1 << 3))

    for (let cid = 0; cid < 6; cid++) {
      const ch = scene.channels[cid]

      // ch_fb_alg_t
      data.push(ch.al | (ch.fb << 3))
      // ch_lr_ams_fms_t
      data.push(ch.fms | (ch.ams << 3) | (state.routing[cid] << 6))

      for (let o = 0; o < 4; o++) {
        const op = ch.operators[o]

        // op_dt1_mul_t;
        data.push(op.mul | (op.det << 4))
        // op_tl_t;
        data.push(op.tl)
        // op_rs_ar_t;
        data.push(op.ar | (op.rs << 6))
        // op_am_d1r_t;
        data.push(op.d1 | (op.am << 7))
        // op_d2r_t;
        data.push(op.d2)
        // op_d1l_rr_t;
        data.push(op.rr | (op.sl << 4))
      }
    }
  }

  // BINDINGS
  // ========
  state.bindings.forEach((bindings) => {
    const MASK_SIZE = 6
    const mask = new Array(MASK_SIZE).fill(0)
    for (const bi of bindings) {
      const byteIndex = bi >> 3
      const bitPos = bi & 7
      mask[byteIndex] |= 1 << bitPos
    }
    // append it to the existing data
    data.push(...mask)
  })

  // SETTINGS
  // ========
  const settings = state.settings

  data.push(settings.pm) // play mode
  data.push(settings.rc) // midi recv channel
  data.push(settings.tr) // transpose
  data.push(settings.tu) // tuning
  data.push(settings.lb) // led brightness

  // sequence
  for (let i = 0; i < 6; i++) {
    const seq = state.settings.sequence[i]
    // Convert 16-bit array into a number using reduce
    const value = seq.reduce((acc, bit, j) => acc | ((bit ? 1 : 0) << j), 0)
    // Split into two uint8_t
    const lower = value & 0xff
    const upper = (value >> 8) & 0xff
    data.push(lower)
    data.push(upper)
  }
  data.push(settings.stp) // seq steps
  data.push(settings.portamento) // portamento
  data.push(settings.pbu) // pitch_bend_up;
  data.push(settings.pbd) // pitch_bend_down;
  data.push(settings.vs) // velocity_sensitivity;
  data.push(settings.mmx) // modulation mode x
  data.push(settings.mmy) // modulation mode y
  data.push(settings.mmz) // modulation mode z

  // calculate CRC 32 of the data
  let crc32 = 0
  crc32 = crc32_push(crc32, data)
  return crc32
}

export { calculate_crc32 }
