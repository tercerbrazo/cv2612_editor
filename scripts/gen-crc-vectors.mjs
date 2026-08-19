/*
 * Golden CRC32 vectors for the editor<->firmware sync checksum.
 * Run with: node scripts/gen-crc-vectors.mjs — exits 1 on mismatch.
 * State spec lives in scripts/vector-states.mjs (shared with the firmware).
 */
import { calculate_crc32 } from '../src/utils/checksum.ts'
import { state } from './vector-states.mjs'

const EXPECTED = {
  default: 0x35c8bb8a, // pinned on both sides; the firmware suite asserts the same
  rich: 0x9c57db6e,
}

let failed = false
for (const [name, rich] of [['default', false], ['rich', true]]) {
  const crc = calculate_crc32(state(rich)) >>> 0
  const want = EXPECTED[name] >>> 0
  const ok = crc === want
  if (!ok) failed = true
  console.log(
    `${ok ? 'ok -' : 'FAIL'} vector "${name}": crc32 = 0x${crc
      .toString(16)
      .padStart(8, '0')}${ok ? '' : ` (want 0x${want.toString(16).padStart(8, '0')})`}`,
  )
}
process.exit(failed ? 1 : 0)
