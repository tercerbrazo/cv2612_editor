/*
 * Wire-level sync stream generator. Runs the REAL buildSyncMessages over the
 * shared vector states and emits the exact bytes a full SYNC puts on the
 * MIDI cable, as hex fixtures for the firmware's native suite
 * (cv2612_fw test/fixtures/editor_sync_*.hex).
 *
 * Run with: node --experimental-transform-types scripts/gen-sync-stream.mjs [outdir]
 * (the flag compiles the TS enums the sync builder imports)
 * Without outdir it prints to stdout (and always self-checks the CRCs).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculate_crc32 } from '../src/utils/checksum.ts'
import { buildSyncMessages } from '../src/utils/syncMessages.ts'
import { state, EXPECTED } from './vector-states.mjs'

const outdir = process.argv[2]
let failed = false

for (const [name, rich] of [['default', false], ['rich', true]]) {
  const st = state(rich)
  const msgs = buildSyncMessages(st)
  const bytes = []
  for (const [ch, cc, val] of msgs) {
    bytes.push(0xb0 + (ch & 0x0f), cc & 0x7f, val & 0x7f)
  }
  const crc = calculate_crc32(st) >>> 0
  const ok = crc === (EXPECTED[name] >>> 0)
  if (!ok) failed = true
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  const header =
    `# editor full-sync wire bytes, vector "${name}" (${msgs.length} messages, ` +
    `${bytes.length} bytes, crc32 0x${crc.toString(16).padStart(8, '0')})\n` +
    `# regenerate: node scripts/gen-sync-stream.mjs (cv2612_editor repo)\n`
  console.log(
    `${ok ? 'ok -' : 'FAIL'} stream "${name}": ${msgs.length} messages, ` +
      `${bytes.length} bytes, crc32 0x${crc.toString(16).padStart(8, '0')}`,
  )
  if (outdir) {
    writeFileSync(join(outdir, `editor_sync_${name}.hex`), header + hex + '\n')
  } else if (process.env.DUMP) {
    console.log(hex)
  }
}
process.exit(failed ? 1 : 0)
