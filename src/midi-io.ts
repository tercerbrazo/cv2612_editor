type SpeedPreset = 'turbo' | 'fast' | 'normal' | 'slow' | 'shitty'
const state: {
  ma?: WebMidi.MIDIAccess
  midiOutId: string
  speedPreset: SpeedPreset
} = {
  ma: undefined,
  midiOutId: '',
  speedPreset: 'normal',
}

const MINIMUM_THROTTLE = 10

const getInterval = () => {
  switch (state.speedPreset) {
    case 'turbo':
      return 1
    case 'fast':
      return 3
    case 'normal':
      return 8
    case 'slow':
      return 20
    case 'shitty':
      return 40
  }
}

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

const setMidiOutId = (midiOutId: string) => {
  state.midiOutId = midiOutId
}

const setSpeedPreset = (speedPreset: SpeedPreset) => {
  state.speedPreset = speedPreset
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

let pendingCount = 0
const messageQueue = new Map()

const sendCC = async (channel: number, number: number, value: number) => {
  if (!state.ma) return

  const midiOut = state.ma.outputs.get(state.midiOutId)
  if (!midiOut) return

  // Create a unique key for each channel-number combination
  let key = `${channel}-${number}`
  if (channel === 15) {
    // but, on channel 15 we send commands, and different values arent just overridables
    key += `-${value}`
  }

  // If there's a pending message for the same channel-number, replace it
  if (messageQueue.has(key)) {
    clearTimeout(messageQueue.get(key))
    pendingCount--
  }

  // Create a new message and add it to the queue
  const msg = [0xb0 + channel, number, value]
  const timeoutId = setTimeout(
    async () => {
      midiOut.send(msg)
      messageQueue.delete(key)
      pendingCount--
      pub('midiOutProgress', { done: pendingCount === 0 })
      // TODO: log inside an HTML element
      // eslint-disable-next-line no-console
      console.log(`CC ${channel}:${number} -> ${value}`, pendingCount)
    },
    getInterval() * pendingCount + MINIMUM_THROTTLE,
  )

  messageQueue.set(key, timeoutId)
  pendingCount++
}

// TODO: where to put this???
init()

export { SpeedPreset }
export default {
  pub,
  sub,
  setMidiOutId,
  setSpeedPreset,
  sendCC,
  init,
}
