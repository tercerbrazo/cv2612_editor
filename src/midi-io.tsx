const state = {
  ma: null,
  midiOutId: null,
}

const INTERVAL = 20

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const events = {}

const pub = (event, data) => {
  if (!events[event]) return
  events[event].forEach((callback) => callback(data))
}

const sub = (event, callback) => {
  if (!events[event]) events[event] = []
  events[event].push(callback)
}

const unsub = (event, callback) => {
  if (events[event]) events[event] = events[event].filter((e) => e !== callback)
}

const setMidiOutId = (id) => (state.midiOutId = id)

const init = async () => {
  try {
    const ma = await navigator.requestMIDIAccess()
    state.ma = ma
    ma.onstatechange = refresh
    refresh()
  } catch (e) {
    console.log('Could not access your MIDI devices.')
  }
}

const refresh = () => {
  const outputs = Array.from(state.ma.outputs.values())

  pub('midiStateChanged', {
    outputs,
  })
}

let pendingCCs = 0
const sendCC = async (channel, number, value) => {
  if (!state.ma) return

  const midiOut = state.ma.outputs.get(state.midiOutId)
  if (!midiOut) return

  pendingCCs++
  await sleep(INTERVAL * pendingCCs)
  const msg = [0xb0 + channel, number, value]
  midiOut.send(msg)
  pendingCCs--
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
