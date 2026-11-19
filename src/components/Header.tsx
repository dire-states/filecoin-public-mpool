import { formatAge, formatCount } from '../lib/format'
import type { Coverage } from '../lib/stats'
import type { Head } from '../lib/tracker'

interface Props {
  head: Head | null
  pending: number
  cov: Coverage
  startedAt: number
  now: number
  // Polling right now: visible tab, not paused.
  active: boolean
  paused: boolean
  onPause: (paused: boolean) => void
}

function Header({ head, pending, cov, startedAt, now, active, paused, onPause }: Props) {
  return (
    <header className="header">
      <h1>filecoin-mpool</h1>
      <span className="badge">mainnet</span>
      <span className="header-stat">
        <strong>{formatCount(pending)}</strong> pending
      </span>
      {head && (
        <span className="header-stat">
          head <strong>{formatCount(head.height)}</strong> <span className="muted">{formatAge(now / 1000 - head.time)} ago</span>
        </span>
      )}
      {cov.messages > 0 && (
        <span className="header-stat" title="On-chain messages a polled mempool listed before their tipset">
          <strong>{((100 * cov.seen) / cov.messages).toFixed(1)}%</strong> seen before inclusion
        </span>
      )}
      <span className="header-meta">
        <span className={`live-dot ${active ? 'on' : ''}`} />
        {active ? 'live' : paused ? 'paused' : 'stopped while hidden'} · watching for {formatAge((now - startedAt) / 1000)} · only
        what happened while this page is open
      </span>
      <button className="btn" onClick={() => onPause(!paused)}>
        {paused ? 'Resume' : 'Pause'}
      </button>
    </header>
  )
}

export default Header
