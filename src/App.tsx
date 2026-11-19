import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import './App.css'
import ChartsPane from './components/ChartsPane'
import Header from './components/Header'
import InclusionPane from './components/InclusionPane'
import PendingPane from './components/PendingPane'
import ProvidersPane from './components/ProvidersPane'
import { PROVIDERS, type ProviderKey } from './lib/providers'
import { coverage, pendingList } from './lib/stats'
import { Tracker } from './lib/tracker'

// One tracker for the page's lifetime; StrictMode's double effects only stop and restart it.
const tracker = new Tracker()

// Re-renders every second, for ages and "ago" labels.
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function App() {
  const snap = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot)
  const now = useNow()
  // Slot of the message shown in the Message pane.
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    tracker.start()
    return () => tracker.stop()
  }, [])

  const pending = useMemo(() => pendingList(snap.tracker), [snap])
  const cov = useMemo(() => coverage(snap.tracker), [snap])
  const snapshots = useMemo(
    () => Object.fromEntries(PROVIDERS.map((p) => [p.key, snap.tracker.providers[p.key].snapshot])) as Record<ProviderKey, Set<string>>,
    [snap],
  )

  return (
    <div className="app">
      <Header
        head={tracker.head}
        pending={pending.length}
        cov={cov}
        startedAt={tracker.startedAt}
        now={now}
        active={tracker.active}
        paused={tracker.paused}
        onPause={(p) => tracker.setPaused(p)}
      />
      <PendingPane pending={pending} actors={tracker.actors} snapshots={snapshots} now={now} selected={selected} onSelect={setSelected} />
      <ChartsPane series={tracker.series} />
      <InclusionPane snap={snap} selected={selected} onSelect={setSelected} />
      <ProvidersPane
        snap={snap}
        pending={pending}
        snapshots={snapshots}
        now={now}
        selected={selected}
        onSelect={setSelected}
      />
    </div>
  )
}

export default App
