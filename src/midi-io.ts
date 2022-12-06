const state = {
  ma: null,
  midiOutId: null,
}

const INTERVAL = 20

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Callback = (data: any) => void
const events: Record<string, Callback[]> = {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pub = (event: string, data: any) => {
  if (!events[event]) return
  events[event].forEach((callback) => callback(data))
}

const sub = (event: string, callback: Callback) => {
  if (!events[event]) events[event] = []
  events[event].push(callback)
}

const unsub = (event: string, callback: Callback) => {
  if (events[event]) events[event] = events[event].filter((e) => e !== callback)
}

const setMidiOutId = (id: string) => {
  state.midiOutId = id
}

const refresh = () => {
  const outputs = Array.from(state.ma.outputs.values())

  pub('midiStateChanged', {
    outputs,
  })
}

const init = async () => {
  try {
    const ma = await navigator.requestMIDIAccess()
    state.ma = ma
    ma.onstatechange = refresh
    refresh()
  } catch (e) {
    // do nothing
  }
}

let pendingCCs = 0
const sendCC = async (channel: number, number: number, value: number) => {
  if (!state.ma) return

  const midiOut = state.ma.outputs.get(state.midiOutId)
  if (!midiOut) return

  pendingCCs++
  await sleep(INTERVAL * pendingCCs)
  const msg = [0xb0 + channel, number, value]
  midiOut.send(msg)
  pendingCCs--
  // TODO: log inside an HTML element
  // eslint-disable-next-line no-console
  console.log(`CC ${channel}:${number} -> ${value}`, pendingCCs)
  pub('midiOutProgress', { done: pendingCCs === 0 })
}

export default {
  pub,
  sub,
  unsub,
  setMidiOutId,
  sendCC,
  init,
}
