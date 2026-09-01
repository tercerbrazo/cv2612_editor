/*
 * Tests for the instrument importers (TFI/VGI/DMP) and the DMP writer.
 * Run with: node scripts/test-import.mjs
 * (Node >= 22.18 strips the TS types of the imported modules natively.)
 *
 * Fixtures are synthesized from the published format specs (vgmrips /
 * Plutiedev / DMP_SPECS.txt), cross-checked against the reference parser
 * in rhargreaves/deflemask-preset-viewer. The two historical traps these
 * tests exist to freeze:
 *   - operator order: the files store S1,S3,S2,S4 — which IS this
 *     editor's operators[] order (firmware maps op index straight to the
 *     register slot), so a correct import does NOT reorder.
 *   - detune: files use 0..6 with 3 = neutral; the editor, files and sync
 *     stay in 0..6 — the firmware remaps to the chip's DT1 register.
 */
import assert from 'node:assert/strict'
import { clampFileDt } from '../src/utils/detune.ts'
import { readTfi } from '../src/utils/readTfi.ts'
import { readVGI } from '../src/utils/readVgi.ts'
import { readDmp } from '../src/utils/readDmp.ts'
import { writeDmp } from '../src/utils/writeDmp.ts'

let passed = 0
const ok = (name) => {
  passed++
  console.log(`ok - ${name}`)
}

// ---------------------------------------------------------------------------
// detune conversion
// ---------------------------------------------------------------------------
{
  // detune stays in the file domain (0..6); the firmware remaps to the chip.
  // clampFileDt only guards the range (7, which no format uses, -> 6).
  for (let dt = 0; dt <= 6; dt++) {
    assert.equal(clampFileDt(dt), dt, `clampFileDt(${dt}) passes through`)
  }
  assert.equal(clampFileDt(7), 6, 'out-of-range 7 clamps to 6')
  ok('detune: clampFileDt keeps the 0..6 file domain')
}

// ---------------------------------------------------------------------------
// TFI
// ---------------------------------------------------------------------------
const tfiOp = (i) => [
  // mul, dt, tl, rs, ar, dr, d2r, rr, sl, ssg — distinct per op
  1 + i, 3 + (i === 1 ? 2 : 0), 10 * i, i % 4, 31 - i, 5 + i, 2 + i, 15 - i, i, 0,
]
{
  const bytes = new Uint8Array([2, 5, ...tfiOp(0), ...tfiOp(1), ...tfiOp(2), ...tfiOp(3)])
  const inst = readTfi(bytes)
  assert.ok(inst, 'TFI should parse')
  assert.equal(inst.al, 2)
  assert.equal(inst.fb, 5)
  assert.equal(inst.fms, 0)
  assert.equal(inst.ams, 0)
  // no reorder: file op i lands in operators[i]
  for (let i = 0; i < 4; i++) {
    const op = inst.operators[i]
    assert.equal(op.mul, 1 + i, `op${i} mul`)
    assert.equal(op.tl, 10 * i, `op${i} tl`)
    assert.equal(op.ar, 31 - i, `op${i} ar`)
    assert.equal(op.d1, 5 + i, `op${i} d1`)
    assert.equal(op.d2, 2 + i, `op${i} d2`)
    assert.equal(op.rr, 15 - i, `op${i} rr`)
    assert.equal(op.sl, i, `op${i} sl`)
    assert.equal(op.am, 0, `op${i} am (TFI has none)`)
  }
  // dt: ops use file 3 (neutral) except op1 which uses 5 (+2)
  assert.equal(inst.operators[0].det, 3, 'neutral file dt 3 stays 3')
  assert.equal(inst.operators[1].det, 5, 'file dt 5 stays 5')
  assert.equal(readTfi(bytes.subarray(0, 41)), null, 'short TFI rejected')
  ok('TFI: 42-byte layout, field mapping, detune')
}

// ---------------------------------------------------------------------------
// VGI
// ---------------------------------------------------------------------------
{
  // TFI-style ops but DR byte carries AM in bit 7; byte 2 is %00AA0FFF
  const vgiOp = (i, am) => {
    const o = tfiOp(i)
    const dr = o[5] | (am ? 0x80 : 0)
    return [o[0], o[1], o[2], o[3], o[4], dr, o[6], o[7], o[8], o[9]]
  }
  const fmsAms = (2 << 4) | 5 // AMS=2 (bits 4-5), FMS=5 (bits 0-2)
  const bytes = new Uint8Array([
    4, 3, fmsAms,
    ...vgiOp(0, false), ...vgiOp(1, true), ...vgiOp(2, false), ...vgiOp(3, true),
  ])
  const inst = readVGI(bytes)
  assert.ok(inst, 'VGI should parse')
  assert.equal(inst.al, 4)
  assert.equal(inst.fb, 3)
  assert.equal(inst.fms, 5, 'FMS from bits 0-2')
  assert.equal(inst.ams, 2, 'AMS from bits 4-5')
  assert.equal(inst.operators[1].am, 1, 'AM flag from DR bit 7')
  assert.equal(inst.operators[1].d1, 6, 'DR without the AM bit')
  assert.equal(inst.operators[1].det, 5, 'file dt 5 stays 5')
  ok('VGI: FMS/AMS bit split, AM-in-DR, detune')
}

// ---------------------------------------------------------------------------
// DMP v11 and v9
// ---------------------------------------------------------------------------
const dmpOp = (i) => [
  // mul, tl, ar, dr, sl, rr, am, rs, dt, d2r, ssg
  1 + i, 20 + i, 31 - i, 6 + i, 7 + i, 15 - i, i % 2, i % 4, i === 2 ? 1 : 3, 4 + i, 0,
]
{
  const body = [7, 6, 5, 1, ...dmpOp(0), ...dmpOp(1), ...dmpOp(2), ...dmpOp(3)]
  const v11 = new Uint8Array([0x0b, 0x02, 0x01, ...body])
  const v9 = new Uint8Array([0x09, 0x01, 0x00, ...body])
  const v8 = new Uint8Array([0x08, 0x01, 0x00, ...body])
  for (const [name, bytes] of [['v11', v11], ['v9', v9], ['v8', v8]]) {
    const inst = readDmp(bytes)
    assert.ok(inst, `DMP ${name} should parse`)
    assert.equal(inst.fms, 7, `${name} fms`)
    assert.equal(inst.fb, 6, `${name} fb`)
    assert.equal(inst.al, 5, `${name} al`)
    assert.equal(inst.ams, 1, `${name} ams`)
    for (let i = 0; i < 4; i++) {
      const op = inst.operators[i]
      assert.equal(op.mul, 1 + i, `${name} op${i} mul`)
      assert.equal(op.tl, 20 + i, `${name} op${i} tl`)
      assert.equal(op.am, i % 2, `${name} op${i} am`)
      assert.equal(op.d2, 4 + i, `${name} op${i} d2`)
    }
    assert.equal(inst.operators[0].det, 3, `${name} neutral dt stays 3`)
    assert.equal(inst.operators[2].det, 1, `${name} file dt 1 stays 1`)
  }
  // wrong system on v11 is rejected
  assert.equal(readDmp(new Uint8Array([0x0b, 0x07, 0x01, ...body])), null,
    'non-Genesis v11 rejected')
  ok('DMP: v8/v9/v11 headers, field mapping, detune')

  // hardening: a truncated (or non-FM) file whose first byte is 0x07 must NOT
  // read undefineds into a non-null instrument — it must be rejected by length.
  assert.equal(readDmp(new Uint8Array([0x07])), null, 'truncated v7 rejected')
  assert.equal(readDmp(new Uint8Array([0x08, 0x01, 0x00, 1, 2, 3])), null,
    'truncated v8 body rejected')
  ok('DMP: a truncated file is rejected, not read as garbage')

  // hardening: out-of-range field bytes are masked to their widths, not passed
  // through to wrap silently at the & 0x7f in sendCC. mul 0xff -> 0x0f, tl -> 0x7f.
  const badOp0 = [0xff, 0xff, ...dmpOp(0).slice(2)]
  const badBody = [0xff, 6, 5, 1, ...badOp0, ...dmpOp(1), ...dmpOp(2), ...dmpOp(3)]
  const bad = readDmp(new Uint8Array([0x0b, 0x02, 0x01, ...badBody]))
  assert.equal(bad.fms, 0x07, 'fms masked to 3 bits')
  assert.equal(bad.operators[0].mul, 0x0f, 'mul masked to 4 bits')
  assert.equal(bad.operators[0].tl, 0x7f, 'tl masked to 7 bits')
  ok('DMP: out-of-range fields are masked to their widths')
}

// ---------------------------------------------------------------------------
// export/import round trip
// ---------------------------------------------------------------------------
{
  const inst = {
    al: 3, fb: 2, fms: 4, ams: 1,
    operators: [0, 1, 2, 3].map((i) => ({
      mul: 2 + i, tl: 30 + i, ar: 28 - i, d1: 3 + i, sl: 5 + i,
      rr: 12 - i, am: i % 2, rs: i % 4, det: [0, 3, 5, 6][i], d2: 6 + i,
    })),
  }
  const back = readDmp(new Uint8Array(writeDmp(inst)))
  assert.ok(back, 'exported DMP should re-import')
  assert.deepEqual(back, inst,
    'a library instrument must survive the export/import round trip exactly')
  ok('DMP writer: byte-exact round trip through readDmp')
}

console.log(`\n== RESULT: ${passed} groups passed ==`)
