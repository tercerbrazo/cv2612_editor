const state: {
  ma?: WebMidi.MIDIAccess
  midiOutId: string
} = {
  ma: undefined,
  midiOutId: '',
}

const INTERVAL = 20

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

type EventMap = {
  midiStateChanged: { outputs: WebMidi.MIDIOutput[] }
  midiOutProgress: { done: boolean }
}

type Callback<T extends keyof EventMap> = (data: EventMap[T]) => void

const events: Record<string, Callback<any>[]> = {}

const pub = <T extends keyof EventMap>(event: T, data: EventMap[T]) => {
  if (!events[event]) return
  events[event].forEach((callback) => callback(data))
}

const sub = <T extends keyof EventMap>(event: T, callback: Callback<T>) => {
  if (!events[event]) events[event] = []
  events[event].push(callback)

  // Return an unsubscribe function
  const unsubscribe = () => {
    if (events[event]) {
      events[event] = events[event].filter((e) => e !== callback)
    }
  }

  return unsubscribe
}

// Example usage:

const setMidiOutId = (id: string) => {
  state.midiOutId = id
}

const refresh = () => {
  if (!state.ma) return

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
  setMidiOutId,
  sendCC,
  init,
}
