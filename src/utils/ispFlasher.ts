// STK500v1 flasher over Web Serial: host -> Arduino Uno (ArduinoISP @38400)
// -> ATmega328PB over ICSP. Mirrors avrdude/ArduinoISP: a SET_DEVICE with
// pagesize=128 enables page-mode commits (byte-mode is ~10x slower).
//
// The caller owns the port (opened at 38400 by the monitor) and MUST stop the
// telemetry read loop first: flashing needs exclusive reader+writer plus
// setSignals() for the DTR reset that restarts the Uno into ArduinoISP.

export interface FlashablePort {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  setSignals(signals: {
    dataTerminalReady?: boolean
    requestToSend?: boolean
  }): Promise<void>
  getInfo?(): { usbVendorId?: number; usbProductId?: number }
}

export const FLASH_SIZE = 32768
export const PAGE = 128 // 328PB flash page (64 words)
export const TARGET_SIGNATURE = '1e9516'
// a valid image is ~29 KB; anything under this is an empty/error fetch
export const MIN_IMAGE_BYTES = 1024
// The firmware reseeds the factory bank when the EEPROM magic mismatches. We
// don't trust a single computed offset (it drifts with struct layout), so we
// clobber a range that covers it: magic sits just past patches+bindings+
// settings+calibration (~byte 698 of the 700-byte used region).
const MAGIC_CLOBBER_START = 690
const MAGIC_CLOBBER_LEN = 20

const EOP = 0x20
const INSYNC = 0x14
const OK = 0x10
export const MEM_FLASH = 0x46
export const MEM_EEPROM = 0x45

// Pure stk500 command builders, exported so tests freeze the exact bytes.
// SET_DEVICE carries pagesize=128 (bytes 12-13) and eepromsize=1024 (14-15).
export const SET_DEVICE_CMD: readonly number[] = [
  0x42, 0x86, 0, 0, 1, 1, 1, 1, 3, 0xff, 0xff, 0xff, 0xff, 0x00, 0x80, 0x04,
  0x00, 0x00, 0x00, 0x80, 0x00, EOP,
]
export const loadAddressCmd = (wordAddr: number): number[] => [
  0x55, wordAddr & 0xff, (wordAddr >> 8) & 0xff, EOP,
]
export const progPageCmd = (mem: number, data: number[]): number[] => [
  0x64, (data.length >> 8) & 0xff, data.length & 0xff, mem, ...data, EOP,
]

export interface FlashResult {
  bytesWritten: number
  pages: number
  verifyBad: number
  seconds: number
}

export type Progress = (phase: string, done: number, total: number) => void

// --- Intel HEX -> flash image (0xFF filled) ---
export function parseIntelHex(text: string): { mem: Uint8Array; len: number } {
  const mem = new Uint8Array(FLASH_SIZE).fill(0xff)
  let base = 0
  let len = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue
    const b: number[] = []
    for (let i = 1; i + 1 < line.length; i += 2) b.push(parseInt(line.substr(i, 2), 16))
    const n = b[0]
    const addr = (b[1] << 8) | b[2]
    const type = b[3]
    if (type === 0x00) {
      for (let i = 0; i < n; i++) {
        const a = base + addr + i
        if (a < FLASH_SIZE) {
          mem[a] = b[4 + i]
          if (a + 1 > len) len = a + 1
        }
      }
    } else if (type === 0x02) base = ((b[4] << 8) | b[5]) << 4
    else if (type === 0x04) base = ((b[4] << 8) | b[5]) << 16
    else if (type === 0x01) break
  }
  return { mem, len }
}

// --- minimal STK500v1 client bound to one open port ---
class Stk500 {
  private port: FlashablePort
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private buf: number[] = []
  private pump: Promise<void>

  constructor(port: FlashablePort) {
    this.port = port
    this.reader = port.readable!.getReader()
    this.writer = port.writable!.getWriter()
    this.pump = this.read()
  }
  private async read() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value) for (const x of value) this.buf.push(x)
      }
    } catch {
      /* cancelled on release */
    }
  }
  private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  private async take(n: number, timeoutMs: number): Promise<number[]> {
    const dl = Date.now() + timeoutMs
    while (this.buf.length < n && Date.now() < dl) await this.sleep(3)
    return this.buf.splice(0, Math.min(n, this.buf.length))
  }
  // Drop any stale/late bytes from the previous command before sending the next
  // one — otherwise a slow reply desyncs every command after it (and a
  // backgrounded tab's throttled polling makes that easy to hit).
  private async send(bytes: number[]) {
    this.buf.length = 0
    await this.writer.write(new Uint8Array(bytes))
  }
  private async ok(label: string) {
    const r = await this.take(2, 2000)
    if (r.length < 2 || r[0] !== INSYNC || r[1] !== OK)
      throw new Error(`${label} failed: [${r.map((x) => x.toString(16)).join(' ')}]`)
  }

  // DTR pulse resets the Uno; it boots optiboot (~2s) then runs ArduinoISP.
  async reset() {
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: false })
    await this.sleep(120)
    await this.port.setSignals({ dataTerminalReady: true, requestToSend: true })
    await this.sleep(50)
    await this.sleep(2500)
    this.buf.length = 0
  }
  async sync() {
    for (let i = 0; i < 3; i++) {
      await this.send([0x30, EOP])
      await this.ok('sync')
    }
  }
  async enterProgmode() {
    await this.send([0x50, EOP])
    await this.ok('enter_progmode')
  }
  async leaveProgmode() {
    await this.send([0x51, EOP])
    await this.ok('leave_progmode')
  }
  async readSignature(): Promise<string> {
    await this.send([0x75, EOP])
    const r = await this.take(5, 2000)
    return [r[1], r[2], r[3]].map((x) => (x ?? 0).toString(16).padStart(2, '0')).join('')
  }
  async setDevice() {
    await this.send([...SET_DEVICE_CMD])
    await this.ok('set_device')
  }
  async chipErase() {
    // SPI universal 0xAC 0x80; assert the reply and wait out the erase cycle —
    // a silent erase failure would AND bits into the new image.
    await this.send([0x56, 0xac, 0x80, 0x00, 0x00, EOP])
    const r = await this.take(3, 3000)
    if (r.length < 3 || r[0] !== INSYNC || r[2] !== OK)
      throw new Error(`chip_erase failed: [${r.map((x) => x.toString(16)).join(' ')}]`)
    await this.sleep(50)
  }
  private async loadAddress(wordAddr: number) {
    await this.send(loadAddressCmd(wordAddr))
    await this.ok('load_address')
  }
  async progFlashPage(wordAddr: number, data: number[]) {
    await this.loadAddress(wordAddr)
    await this.send(progPageCmd(MEM_FLASH, data))
    await this.ok('prog_page')
  }
  async readFlashPage(wordAddr: number, length: number): Promise<number[]> {
    await this.loadAddress(wordAddr)
    await this.send([0x74, (length >> 8) & 0xff, length & 0xff, MEM_FLASH, EOP])
    const r = await this.take(length + 2, 2000)
    if (r.length < length + 2 || r[0] !== INSYNC || r[length + 1] !== OK)
      throw new Error('read_page failed')
    return r.slice(1, 1 + length)
  }
  async writeEeprom(byteAddr: number, data: number[]) {
    await this.loadAddress(byteAddr >> 1) // ArduinoISP does start = here*2
    await this.send(progPageCmd(MEM_EEPROM, data))
    await this.ok('write_eeprom')
  }
  async close() {
    // cancel the reader first: an in-flight write otherwise keeps the writer
    // lock and wedges the port for the next open
    try {
      await this.reader.cancel()
    } catch {
      /* */
    }
    try {
      this.writer.releaseLock()
    } catch {
      /* */
    }
    await this.pump
  }
}

async function enterIsp(stk: Stk500, onProgress: Progress) {
  onProgress('reset', 0, 1)
  await stk.reset()
  await stk.sync()
  await stk.enterProgmode()
  const sig = await stk.readSignature()
  if (sig !== TARGET_SIGNATURE) throw new Error(`target signature 0x${sig} != 0x${TARGET_SIGNATURE}`)
  await stk.setDevice()
}

// Clobber the EEPROM magic so the firmware reseeds its factory bank on boot.
async function clobberMagic(stk: Stk500) {
  await stk.writeEeprom(MAGIC_CLOBBER_START, new Array(MAGIC_CLOBBER_LEN).fill(0xff))
}

export async function flashFirmware(
  port: FlashablePort,
  hexText: string,
  onProgress: Progress,
): Promise<FlashResult> {
  const { mem, len } = parseIntelHex(hexText)
  // guard BEFORE the chip erase: a 404 HTML page, an empty file or a
  // dev-server fallback parses to zero data; erasing then writing nothing and
  // verifying zero pages would read as a false "flashed + verified".
  if (len < MIN_IMAGE_BYTES)
    throw new Error(`firmware image too small (${len} B) — refusing to erase`)
  const pages = Math.ceil(len / PAGE)
  const stk = new Stk500(port)
  try {
    await enterIsp(stk, onProgress)
    await stk.chipErase()
    const t0 = performance.now()
    for (let i = 0; i < pages; i++) {
      const addr = i * PAGE
      await stk.progFlashPage(addr >> 1, Array.from(mem.slice(addr, addr + PAGE)))
      onProgress('flash', i + 1, pages)
    }
    await clobberMagic(stk)
    let verifyBad = 0
    for (let i = 0; i < pages; i++) {
      const addr = i * PAGE
      const got = await stk.readFlashPage(addr >> 1, PAGE)
      for (let k = 0; k < PAGE; k++)
        if (got[k] !== mem[addr + k]) {
          verifyBad++
          break
        }
      onProgress('verify', i + 1, pages)
    }
    return { bytesWritten: len, pages, verifyBad, seconds: (performance.now() - t0) / 1000 }
  } finally {
    // leave programming mode on every path so a failed flash doesn't hold the
    // target in reset until a power cycle (best-effort: may be desynced)
    try {
      await stk.leaveProgmode()
    } catch {
      /* already failed / desynced */
    }
    await stk.close()
  }
}

// Just reseed: clobber the magic, no flash write.
export async function eraseEeprom(port: FlashablePort, onProgress: Progress): Promise<void> {
  const stk = new Stk500(port)
  try {
    await enterIsp(stk, onProgress)
    await clobberMagic(stk)
  } finally {
    try {
      await stk.leaveProgmode()
    } catch {
      /* best-effort */
    }
    await stk.close()
  }
}
