import { Snapshot } from 'valtio'
import { ChannelParamEnum, OperatorParamEnum } from '../enums'

function fnv1a(h: number, v: number): number {
  h ^= v
  h = Math.imul(h, 0x01000193)
  return h >>> 0
}

function hashInstrument(inst: Instrument | Snapshot<Instrument>): number {
  let h = 0x811c9dc5

  Object.values(ChannelParamEnum).forEach((key) => {
    h = fnv1a(h, inst[key])
  })

  for (let o = 0; o < 4; o++) {
    Object.values(OperatorParamEnum).forEach((key) => {
      h = fnv1a(h, inst.operators[o][key])
    })
  }

  return h >>> 0
}

export { hashInstrument }
