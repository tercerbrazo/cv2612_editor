/*
 * Tests for the Web Serial stk500 flasher (src/utils/ispFlasher.ts).
 * Run with: node scripts/test-ispflasher.mjs  (Node >= 22 strips the TS types.)
 *
 * These freeze the two things that silently corrupt a flash:
 *   - the Intel-HEX parser (wrong address/gap handling writes the wrong byte),
 *   - the exact stk500 command bytes (a wrong SET_DEVICE pagesize drops the
 *     Uno into byte-mode = 10x slower; a wrong mem-type writes flash as eeprom).
 * The hardware protocol is verified end-to-end on the bench; this is the
 * offline guard so a refactor can't drift the bytes unnoticed.
 */
import assert from 'node:assert/strict'
import {
  parseIntelHex,
  FLASH_SIZE,
  PAGE,
  MIN_IMAGE_BYTES,
  SET_DEVICE_CMD,
  loadAddressCmd,
  progPageCmd,
  MEM_FLASH,
  MEM_EEPROM,
} from '../src/utils/ispFlasher.ts'

let passed = 0
const ok = (name) => {
  passed++
  console.log(`ok - ${name}`)
}

// build one Intel-HEX data record (type 00) with a correct checksum
const hexLine = (addr, bytes, type = 0x00) => {
  const b = [bytes.length, (addr >> 8) & 0xff, addr & 0xff, type, ...bytes]
  const sum = b.reduce((a, c) => a + c, 0)
  const cks = (0x100 - (sum & 0xff)) & 0xff
  return ':' + [...b, cks].map((x) => x.toString(16).padStart(2, '0')).join('')
}
const EOF_LINE = ':00000001FF'

// ---------------------------------------------------------------------------
// Intel HEX parser
// ---------------------------------------------------------------------------
{
  const text = [
    hexLine(0x0000, [0xde, 0xad, 0xbe, 0xef]),
    hexLine(0x0100, [0x12, 0x34]),
    EOF_LINE,
    hexLine(0x0200, [0x99]), // after EOF: must be ignored
  ].join('\n')
  const { mem, len } = parseIntelHex(text)
  assert.equal(mem.length, FLASH_SIZE, 'image is full flash size')
  assert.deepEqual([...mem.slice(0, 4)], [0xde, 0xad, 0xbe, 0xef], 'data @0')
  assert.deepEqual([...mem.slice(0x100, 0x102)], [0x12, 0x34], 'data @0x100')
  assert.equal(mem[4], 0xff, 'gap byte is 0xFF')
  assert.equal(mem[0x0fff], 0xff, 'gap before 0x100 is 0xFF')
  assert.equal(len, 0x102, 'len is the highest written address + 1')
  assert.equal(mem[0x200], 0xff, 'record after EOF is ignored')
  ok('parseIntelHex: addresses, gap fill, len, EOF stop')
}

// round-trip: arbitrary bytes -> hex -> parse -> identical
{
  const src = new Uint8Array(300)
  for (let i = 0; i < src.length; i++) src[i] = (i * 7 + 3) & 0xff
  const lines = []
  for (let a = 0; a < src.length; a += 16)
    lines.push(hexLine(a, [...src.slice(a, a + 16)]))
  lines.push(EOF_LINE)
  const { mem, len } = parseIntelHex(lines.join('\r\n')) // CRLF too
  assert.equal(len, 300, 'round-trip len')
  assert.deepEqual([...mem.slice(0, 300)], [...src], 'round-trip bytes match')
  ok('parseIntelHex: round-trips arbitrary data (CRLF)')
}

// non-colon lines are skipped, not fatal
{
  const { len } = parseIntelHex('; a comment\n\n' + hexLine(0, [1, 2, 3]) + '\n' + EOF_LINE)
  assert.equal(len, 3, 'ignores blank/comment lines')
  ok('parseIntelHex: tolerates comment/blank lines')
}

// an HTML error page / empty fetch parses to zero data; the flasher refuses to
// chip-erase below MIN_IMAGE_BYTES so a 404 can't blank-brick a module (H1)
{
  const html = parseIntelHex('<!doctype html><title>404 Not Found</title>')
  assert.equal(html.len, 0, '404 HTML parses to zero data')
  assert.ok(0 < MIN_IMAGE_BYTES, 'empty image is below the erase guard')
  ok('parseIntelHex: garbage/404 -> len 0, under MIN_IMAGE_BYTES')
}

// ---------------------------------------------------------------------------
// stk500 command bytes (freeze them)
// ---------------------------------------------------------------------------
{
  // SET_DEVICE must carry pagesize=128 (bytes 12-13 big-endian) — the whole
  // reason flashing is fast. A zero here = byte-mode = ~10x slower.
  // array[0] is the 0x42 opcode, so ArduinoISP's buff[n] is array[n+1].
  // pagesize = beget16(&buff[12]) -> array indices 13,14.
  assert.equal(SET_DEVICE_CMD[0], 0x42, 'SET_DEVICE opcode')
  assert.equal(SET_DEVICE_CMD[13], 0x00, 'pagesize hi (buff[12])')
  assert.equal(SET_DEVICE_CMD[14], 0x80, 'pagesize lo = 128 (buff[13])')
  assert.equal(SET_DEVICE_CMD[15], 0x04, 'eepromsize hi = 1024 (buff[14])')
  assert.equal(SET_DEVICE_CMD[16], 0x00, 'eepromsize lo (buff[15])')
  assert.equal(SET_DEVICE_CMD.at(-1), 0x20, 'CRC_EOP terminator')
  assert.equal(PAGE, 128, 'flash page size matches SET_DEVICE pagesize')
  ok('SET_DEVICE: pagesize=128 (page-mode), eepromsize=1024, EOP')
}
{
  // LOAD_ADDRESS is little-endian word address
  assert.deepEqual(loadAddressCmd(0x1234), [0x55, 0x34, 0x12, 0x20], 'load addr LE')
  assert.deepEqual(loadAddressCmd(0), [0x55, 0x00, 0x00, 0x20], 'load addr 0')
  ok('loadAddressCmd: little-endian word address')
}
{
  // PROG_PAGE: [0x64, len_hi, len_lo, memtype, ...data, EOP]
  const data = [0xaa, 0xbb]
  assert.deepEqual(
    progPageCmd(MEM_FLASH, data),
    [0x64, 0x00, 0x02, 0x46, 0xaa, 0xbb, 0x20],
    'prog flash page',
  )
  assert.equal(progPageCmd(MEM_EEPROM, data)[3], 0x45, 'eeprom mem-type is E (0x45)')
  const full = progPageCmd(MEM_FLASH, new Array(PAGE).fill(0))
  assert.equal(full[1], 0x00, 'len hi for 128')
  assert.equal(full[2], 0x80, 'len lo for 128')
  assert.equal(full.length, PAGE + 5, 'frame is header(4)+data+EOP')
  ok('progPageCmd: length header, mem-type, EOP')
}

console.log(`\n# ${passed} tests passed`)
