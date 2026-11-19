import { useMemo } from 'react'
import { formatAge, formatAtto, formatCount, plural, shortAddr } from '../lib/format'
import { coverage, includedList, methodLabel, overallWait, timed, waitOf, waitsBy, waitsByPremium, type WaitStats } from '../lib/stats'
import type { Snapshot } from '../lib/tracker'

interface Props {
  snap: Snapshot
  selected: string | null
  onSelect: (slot: string) => void
}

const RECENT = 40
const METHODS_SHOWN = 8

function WaitTable({ title, rows }: { title: string; rows: WaitStats[] }) {
  return (
    <table className="data-table compact">
      <thead>
        <tr>
          <th>{title}</th>
          <th>Messages</th>
          <th>Median wait</th>
          <th>p90 wait</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td>{formatCount(r.count)}</td>
            <td>{formatAge(r.p50)}</td>
            <td>{formatAge(r.p90)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function InclusionPane({ snap, selected, onSelect }: Props) {
  const { tracker } = snap
  const view = useMemo(() => {
    const { tracker } = snap
    const included = includedList(tracker)
    const known = timed(included)
    const byMethod = waitsBy(known, (t) => methodLabel(t, tracker.actors))
    return {
      included,
      cov: coverage(tracker),
      recentCov: coverage(tracker, 10),
      all: overallWait(known),
      atOpen: included.length - known.length,
      byMethod: byMethod.slice(0, METHODS_SHOWN),
      moreMethods: byMethod.length - METHODS_SHOWN,
      byPremium: waitsByPremium(known),
    }
  }, [snap])

  const pct = (seen: number, n: number) => (n ? `${((100 * seen) / n).toFixed(n >= 1000 ? 1 : 0)}%` : '–')

  return (
    <section className="pane inclusion-pane">
      <div className="pane-head">
        <h2 className="pane-title">Inclusion</h2>
      </div>
      {/* Fixed: the figures and wait tables; only the list below scrolls. */}
      <div className="inclusion-stats">
        <div className="figures">
          <div className="figure" title="On-chain messages that a polled mempool listed before their tipset">
            <span className="figure-value">{pct(view.cov.seen, view.cov.messages)}</span>
            <span className="muted">
              {view.cov.epochs
                ? `seen before inclusion: ${formatCount(view.cov.seen)} of ${plural(view.cov.messages, 'message')}, ${plural(view.cov.epochs, 'epoch')}`
                : 'seen before inclusion: from the first full epoch on'}
            </span>
          </div>
          {view.cov.epochs > view.recentCov.epochs && (
            <div className="figure">
              <span className="figure-value">{pct(view.recentCov.seen, view.recentCov.messages)}</span>
              <span className="muted">last {plural(view.recentCov.epochs, 'epoch')}</span>
            </div>
          )}
          <div className="figure" title="From first seen to the epoch of the tipset that included it">
            <span className="figure-value">{view.all ? formatAge(view.all.p50) : '–'}</span>
            <span className="muted">median wait{view.all && `, p90 ${formatAge(view.all.p90)}, ${plural(view.all.count, 'message')}`}</span>
          </div>
        </div>
        {view.included.length === 0 ? (
          <p className="empty muted">No inclusions yet: the first tipsets count after about a minute.</p>
        ) : (
          <>
            {view.atOpen > 0 && (
              <p className="muted small">
                {plural(view.atOpen, 'included message')} already pending when the page opened: wait unknown, left out
                below.
              </p>
            )}
            {view.all && (
              <div className="wait-tables">
                <div>
                  <WaitTable title="Method" rows={view.byMethod} />
                  {view.moreMethods > 0 && <p className="muted small">+{plural(view.moreMethods, 'more method')}</p>}
                </div>
                <WaitTable title="Premium (attoFIL)" rows={view.byPremium} />
              </div>
            )}
          </>
        )}
      </div>
      {view.included.length > 0 && (
        <>
          <h3 className="sub-title">Recently included</h3>
          <div className="table-scroll">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Height</th>
                  <th>Waited</th>
                  <th className="left">From</th>
                  <th className="left">Method</th>
                  <th>Premium</th>
                </tr>
              </thead>
              <tbody>
                {view.included.slice(0, RECENT).map((t) => (
                  <tr key={t.slot} className={`selectable${t.slot === selected ? ' selected' : ''}`} onClick={() => onSelect(t.slot)}>
                    <td>{t.included!.height}</td>
                    <td>
                      {t.atOpen && '≥'}
                      {formatAge(waitOf(t)!)}
                    </td>
                    <td className="mono left" title={t.from}>
                      {shortAddr(t.from)}
                    </td>
                    <td className="method-cell narrow left">{methodLabel(t, tracker.actors)}</td>
                    <td>{formatAtto(t.premium)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

export default InclusionPane
