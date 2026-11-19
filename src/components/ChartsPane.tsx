import { useMemo } from 'react'
import { OTHER_COLOR, seriesColor, useDarkMode } from '../lib/colors'
import { formatAtto, formatCompact } from '../lib/format'
import { PROVIDERS } from '../lib/providers'
import type { SeriesPoint } from '../lib/tracker'
import LiveChart, { type LiveSeries } from './LiveChart'

interface Props {
  series: SeriesPoint[]
}

function ChartsPane({ series }: Props) {
  const dark = useDarkMode()
  const times = useMemo(() => series.map((p) => p.t), [series])

  const size = useMemo<LiveSeries[]>(
    () => [
      { id: 'pending', label: 'pending (all providers)', color: dark ? '#e6e8eb' : '#1c1f24', values: series.map((p) => p.pending) },
      ...PROVIDERS.map((pr, i) => ({
        id: pr.key,
        label: pr.label,
        color: seriesColor(i, dark),
        values: series.map((p) => p.byProvider[pr.key] ?? null),
        thin: true,
      })),
    ],
    [series, dark],
  )

  const fees = useMemo<LiveSeries[]>(
    () => [
      { id: 'base', label: 'base fee', color: seriesColor(4, dark), values: series.map((p) => p.baseFee) },
      { id: 'p90', label: 'premium p90', color: seriesColor(6, dark), values: series.map((p) => p.premium?.p90 ?? null), thin: true },
      { id: 'p50', label: 'premium median', color: seriesColor(6, dark), values: series.map((p) => p.premium?.p50 ?? null) },
      { id: 'p10', label: 'premium p10', color: OTHER_COLOR, values: series.map((p) => p.premium?.p10 ?? null), thin: true },
    ],
    [series, dark],
  )

  return (
    <section className="pane charts-pane">
      <div className="pane-head">
        <h2 className="pane-title">Mempool size</h2>
        <span className="muted">messages; dashed: each provider's own snapshot</span>
      </div>
      <LiveChart times={times} series={size} format={formatCompact} />
      <div className="pane-head">
        <h2 className="pane-title">Fees</h2>
        <span className="muted">attoFIL per gas unit, log scale; premiums of pending messages</span>
      </div>
      <LiveChart times={times} series={fees} format={formatAtto} log />
    </section>
  )
}

export default ChartsPane
