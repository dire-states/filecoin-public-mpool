import { useMemo, useState } from 'react'
import { seriesColor, useDarkMode } from '../lib/colors'
import { formatAge, formatCount, shortAddr } from '../lib/format'
import { FILFOX, PROVIDERS, type ProviderKey } from '../lib/providers'
import { rpc, slotOf, type SignedMessage } from '../lib/rpc'
import { backlogs, providerViews, type SenderBacklog } from '../lib/stats'
import type { Snapshot, Tracked } from '../lib/tracker'
import MessageDetail from './MessageDetail'

interface Props {
  snap: Snapshot
  pending: Tracked[]
  snapshots: Record<ProviderKey, Set<string>>
  now: number
  selected: string | null
  onSelect: (slot: string | null) => void
}

interface FilfoxSnapshot {
  at: number
  count: number
  // Of the combined pending messages, how many Filfox lists too.
  shared: number
  senders: number
  backlogs: { from: string; pending: number }[]
}

const BACKLOGS_SHOWN = 8

function ProvidersPane({ snap, pending, snapshots, now, selected, onSelect }: Props) {
  const { tracker } = snap
  const dark = useDarkMode()
  const [filfox, setFilfox] = useState<FilfoxSnapshot | { error: string } | 'loading' | null>(null)

  const views = useMemo(() => providerViews(snap.tracker), [snap])
  const stuck = useMemo<SenderBacklog[]>(() => backlogs(pending, now), [pending, now])

  const loadFilfox = async () => {
    setFilfox('loading')
    try {
      const msgs = await rpc<SignedMessage[]>(FILFOX.url, 'MpoolPending', [null], 60000)
      const slots = new Set(msgs.map((sm) => slotOf(sm.Message)))
      const per = new Map<string, number>()
      for (const sm of msgs) per.set(sm.Message.From, (per.get(sm.Message.From) ?? 0) + 1)
      setFilfox({
        at: Date.now(),
        count: msgs.length,
        shared: [...tracker.pending].filter((s) => slots.has(s)).length,
        senders: per.size,
        backlogs: [...per]
          .filter(([, n]) => n >= 50)
          .sort((a, b) => b[1] - a[1])
          .map(([from, n]) => ({ from, pending: n })),
      })
    } catch (err) {
      setFilfox({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <section className="pane providers-pane">
      <div className="pane-section backlogs-section">
        <div className="pane-head">
          <h2 className="pane-title">Backlogs</h2>
          <span className="muted">click a sender for its lowest-nonce message</span>
        </div>
          <div className="pane-body">
          {stuck.length === 0 ? (
            <p className="muted small">No sender has 5 or more messages pending.</p>
          ) : (
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Pending</th>
                  <th>Lowest nonce</th>
                  <th title="Since its oldest pending message was first seen">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {stuck.slice(0, BACKLOGS_SHOWN).map((b) => (
                  <tr
                    key={b.from}
                    className={`selectable${selected === `${b.from}:${b.lowestNonce}` ? ' selected' : ''}`}
                    title="Select its lowest-nonce message"
                    onClick={() => onSelect(`${b.from}:${b.lowestNonce}`)}
                  >
                    <td className="mono" title={b.from}>
                      {shortAddr(b.from)}
                    </td>
                    <td>{formatCount(b.pending)}</td>
                    <td>{b.lowestNonce}</td>
                    <td>
                      {b.atOpen && '≥'}
                      {formatAge(b.oldestAge / 1000)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3
            className="sub-title"
            title="Filfox's mempool holds far more than the others, mostly backlogs of up to 1,000 messages per sender, so it is left out of the combined view and fetched only on request."
          >
            Filfox{' '}
            <button className="btn" onClick={() => void loadFilfox()} disabled={filfox === 'loading'}>
              {filfox === 'loading' ? 'loading ~5 MB…' : 'take a snapshot'}
            </button>
            <span className="muted">not in the combined view</span>
          </h3>
          {filfox && filfox !== 'loading' && 'error' in filfox && <p className="error small">{filfox.error}</p>}
          {filfox && filfox !== 'loading' && !('error' in filfox) && (
            <>
              <p className="small">
                <strong>{formatCount(filfox.count)}</strong> messages from {formatCount(filfox.senders)} senders, at{' '}
                {new Date(filfox.at).toLocaleTimeString('en-GB')}. It lists {formatCount(filfox.shared)} of the{' '}
                {formatCount(tracker.pending.size)} messages pending in the combined view.
              </p>
              {filfox.backlogs.length > 0 && (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Sender with 50+ pending</th>
                      <th>Messages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filfox.backlogs.slice(0, BACKLOGS_SHOWN).map((b) => (
                      <tr key={b.from}>
                        <td className="mono" title={b.from}>
                          {shortAddr(b.from)}
                        </td>
                        <td>{formatCount(b.pending)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
      <div className="pane-section message-section">
        <div className="pane-head">
          <h2 className="pane-title">Message</h2>
          {selected && (
            <button className="btn" onClick={() => onSelect(null)} title="Esc">
              close
            </button>
          )}
        </div>
        <div className="pane-body">
          {selected ? (
            <MessageDetail tracker={tracker} slot={selected} snapshots={snapshots} now={now} />
          ) : (
            <p className="muted small">Select a message in Pending, Recently included or Backlogs above to see it here.</p>
          )}
        </div>
      </div>
      <div className="pane-foot">
        <div className="pane-head">
          <h2 className="pane-title">Providers</h2>
          <span className="muted">one snapshot every 5 s, in turn</span>
        </div>
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Provider</th>
              <th title="Messages in its latest snapshot">Snapshot</th>
              <th title="Pending messages no other provider lists">Only here</th>
              <th>Last answer</th>
              <th>Latency</th>
              <th title="Failed requests of all requests (mempool and head)">Errors</th>
            </tr>
          </thead>
          <tbody>
            {PROVIDERS.map((p, i) => {
              const st = tracker.providers[p.key]
              const v = views.find((x) => x.key === p.key)!
              const failing = st.failStreak > 0
              return (
                <tr key={p.key}>
                  <td>
                    <span className="dot" style={{ background: seriesColor(i, dark) }} /> {p.label}
                  </td>
                  <td>{st.count === null ? '–' : formatCount(st.count)}</td>
                  <td>{st.count === null ? '–' : formatCount(v.only)}</td>
                  <td className={failing ? 'error' : undefined} title={st.lastError ?? undefined}>
                    {st.lastOk === null ? (failing ? 'failing' : '–') : `${formatAge((now - st.lastOk) / 1000)} ago`}
                    {failing && ' ⚠'}
                  </td>
                  <td>{st.latencyMs === null ? '–' : `${formatCount(st.latencyMs)} ms`}</td>
                  <td title={st.lastError ?? undefined}>
                    {st.errors}/{st.polls}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default ProvidersPane
