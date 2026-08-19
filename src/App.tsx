import React, { lazy, Suspense, useState } from 'react'
import { useSnapshot } from 'valtio'
import Channel from './channel'
import { state } from './context'
import Dropdown from './dropdown'
import { PlayModeEnum } from './enums'
import logo from './logo.png'
import Midi from './midi'
import Patch from './patch'
import Sequencer from './sequencer'
import Slider from './slider'
import { useMonitorUnlock } from './use-monitor-unlock'
import './styles.sass'

// Internal bench tool, lazy so it stays out of the initial bundle until #monitor.
const Monitor = lazy(() => import('./monitor'))

const Header = () => {
  return (
    <div className="two-cols">
      <div className="col">
        <img alt="" style={{ filter: 'invert(1)' }} src={logo} height="80px" />
      </div>
      <div className="col">
        <h3 style={{ textAlign: 'right' }}>CV-2612 Editor</h3>
      </div>
    </div>
  )
}

const Settings = () => {
  return (
    <div className="four-cols">
      <div className="col">
        <Dropdown id="pm" />
        <Dropdown id="rc" />
      </div>
      <div className="col">
        <Slider id="tr" />
        <Slider id="vs" />
      </div>
      <div className="col">
        <Slider id="tu" />
        <Dropdown
          id="qz"
          hint="Snaps the pitch CV to the selected scale. Quantization happens before transpose, so the Transpose setting rotates the scale and picks the key."
        />
      </div>
      <div className="col">
        <Slider id="lb" />
      </div>
    </div>
  )
}

const App = () => {
  const snap = useSnapshot(state)
  const [view, setView] = useState<'editor' | 'monitor'>('editor')
  const monitorUnlocked = useMonitorUnlock()
  // when locked the Monitor tab does not exist, so a stale view falls back to editor
  const activeView = monitorUnlocked ? view : 'editor'

  return (
    <>
      <Header />
      {monitorUnlocked && (
        <nav className="view-tabs">
          {(['editor', 'monitor'] as const).map((v) => (
            <a
              href="/"
              key={v}
              className={view === v ? 'active' : ''}
              onClick={(ev) => {
                ev.preventDefault()
                setView(v)
              }}
            >
              {v === 'editor' ? 'Editor' : 'Monitor'}
            </a>
          ))}
        </nav>
      )}
      <div style={{ display: activeView === 'editor' ? undefined : 'none' }}>
        <Midi />
        <br />
        <Settings />
        {snap.settings.pm === PlayModeEnum.SEQ && <Sequencer />}
        <Patch />
        <br />
        <Channel />
      </div>
      {monitorUnlocked && (
        <Suspense fallback={null}>
          {/* Monitor stays mounted so the serial connection survives tab switches */}
          <Monitor visible={activeView === 'monitor'} />
        </Suspense>
      )}
    </>
  )
}

export default App
