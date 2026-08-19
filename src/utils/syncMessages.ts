/*
 * Pure builder for the full-sync MIDI message list. This IS the sync
 * protocol: syncMidi() in context.tsx emits exactly this list through
 * MidiIO, and the wire-level tests (scripts/gen-sync-stream.mjs + the
 * firmware's native suite) replay it against the real firmware parser.
 * Change the sync order or encoding HERE and nowhere else.
 */
import {
  ChannelParamEnum,
  MidiCommands,
  OperatorParamEnum,
  SettingParamEnum,
} from '../enums.ts'
import { calculate_crc32 } from './checksum.ts'
import { getParamMeta, getParamMidiCc } from './paramsHelpers.ts'

// [midi channel, cc number, value] — MidiIO.sendCC arguments
export type CcMessage = [number, number, number]

const SC_IDXS = [0, 1, 2, 3] as const
const CH_IDXS = [0, 1, 2, 3, 4, 5] as const
const OP_IDXS = [0, 1, 2, 3] as const
const SETTING_PARAMS = Object.values(SettingParamEnum)
const CHANNEL_PARAMS = Object.values(ChannelParamEnum)
const OPERATOR_PARAMS = Object.values(OperatorParamEnum)
const BINDING_CMDS = [
  MidiCommands.BIND_X,
  MidiCommands.BIND_Y,
  MidiCommands.BIND_Z,
] as const

const param = (
  id: Param,
  sid: SceneId,
  cid: ChannelId,
  op: OperatorId,
  val: number,
): CcMessage => {
  const { bits } = getParamMeta(id)
  const { ch, cc } = getParamMidiCc(id, sid, cid, op)
  return [ch, cc, val << (7 - bits)]
}

const cmd = (c: MidiCommands, val = 127): CcMessage => [15, c, val]

const buildSyncMessages = (state: State): CcMessage[] => {
  const out: CcMessage[] = []

  // clear all bindings first
  out.push(cmd(MidiCommands.CLEAR_BINDINGS))

  // settings
  for (const id of SETTING_PARAMS) {
    out.push(param(id, 0, 0, 0, state.settings[id]))
  }

  // sequence
  out.push(cmd(MidiCommands.CLEAR_SEQ))
  state.settings.sequence.forEach((seq, voice) => {
    seq.forEach((step_on, step_index) => {
      if (step_on) {
        out.push(cmd(MidiCommands.SET_SEQ_STEP_ON, voice * 16 + step_index))
      }
    })
  })

  // routing
  for (const cid of CH_IDXS) {
    out.push(param('lr', 0, cid, 0, state.patches[state.pid].routing[cid]))
  }

  // scenes
  for (const sid of SC_IDXS) {
    const scene = state.patches[state.pid].scenes[sid]
    out.push(param('lfo', sid, 0, 0, scene.lfo))
    for (const cid of CH_IDXS) {
      const ch = scene.channels[cid]
      for (const id of CHANNEL_PARAMS) {
        out.push(param(id, sid, cid, 0, ch[id]))
      }
      for (const o of OP_IDXS) {
        for (const id of OPERATOR_PARAMS) {
          out.push(param(id, sid, cid, o, ch.operators[o][id]))
        }
      }
    }
  }

  // bindings
  state.bindings.forEach((bindings, index) => {
    bindings.forEach((bi) => {
      out.push(cmd(BINDING_CMDS[index], 64 + bi))
    })
  })

  // crc, low nibble first
  const crc32 = calculate_crc32(state)
  for (let index = 0; index < 8; index++) {
    const chunk = (crc32 >> (index * 4)) & 0x0f
    out.push(cmd(MidiCommands.SEND_CRC32_CHUNK, (index << 4) | chunk))
  }

  return out
}

export { buildSyncMessages }
