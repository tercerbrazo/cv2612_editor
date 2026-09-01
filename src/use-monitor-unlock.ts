import { useEffect, useState } from 'react'

// Internal bench tool, gated on the #monitor hash. The URL is the whole state —
// no persisted flag — so removing the hash hides it again.
export const MONITOR_HASH = '#monitor'

export function useMonitorUnlock(): boolean {
  const [unlocked, setUnlocked] = useState(
    () => window.location.hash === MONITOR_HASH,
  )
  useEffect(() => {
    const onHashChange = () =>
      setUnlocked(window.location.hash === MONITOR_HASH)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return unlocked
}
