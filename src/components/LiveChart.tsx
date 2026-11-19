import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useDarkMode } from '../lib/colors'
import { formatClock } from '../lib/format'

export interface LiveSeries {
  id: string
  label: string
  color: string
  values: (number | null)[]
  // Thin dashed line, for secondary series.
  thin?: boolean
}

interface Props {
  // Unix seconds.
  times: number[]
  series: LiveSeries[]
  format: (v: number) => string
  log?: boolean
}

const FONT = '10px system-ui, -apple-system, "Segoe UI", sans-serif'

// 1, 2 and 5 times powers of ten in [min, max]; only powers of ten when the range spans many decades.
function logSplits(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(Math.max(min, 1e-9)))
  const hi = Math.ceil(Math.log10(Math.max(max, 1e-9)))
  const steps = hi - lo > 3 ? [1] : [1, 2, 5]
  const out: number[] = []
  for (let e = lo; e <= hi; e++) for (const m of steps) if (m * 10 ** e >= min && m * 10 ** e <= max) out.push(m * 10 ** e)
  return out
}

function LineKey({ color, thin }: { color: string; thin?: boolean }) {
  return <span className="line-key" style={thin ? { borderTop: `2px dashed ${color}`, height: 0 } : { background: color }} />
}

// Lines over the time the page has been watching; the hover readout shows every series' value.
function LiveChart({ times, series, format, log = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const dark = useDarkMode()
  const [hover, setHover] = useState<{ idx: number; left: number; rect: DOMRect } | null>(null)
  const shape = series.map((s) => `${s.id}:${s.color}:${s.thin}`).join('|')
  // Latest series, read when the chart is rebuilt; their values go through setData below.
  const seriesRef = useRef(series)
  useEffect(() => {
    seriesRef.current = series
  })

  // Rebuilt when the set of series, the theme or the scale changes; new points go through setData.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const css = getComputedStyle(el)
    const muted = css.getPropertyValue('--muted').trim()
    const grid = css.getPropertyValue('--grid').trim()
    const axis = css.getPropertyValue('--axis').trim()
    const opts: uPlot.Options = {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      legend: { show: false },
      cursor: { x: true, y: false, points: { show: false }, drag: { x: false, y: false } },
      scales: {
        x: { time: true },
        y: log ? { distr: 3 } : { range: (_u, _min, max) => [0, Math.max(1, max * 1.05)] },
      },
      axes: [
        {
          stroke: muted,
          font: FONT,
          size: 20,
          space: 64,
          values: (_u, splits) => splits.map((s) => formatClock(s).slice(0, 5)),
          grid: { show: false },
          ticks: { stroke: axis, size: 4 },
        },
        {
          stroke: muted,
          font: FONT,
          size: 44,
          gap: 4,
          splits: log ? (_u, _ax, min, max) => logSplits(min, max) : undefined,
          values: (_u, splits) => splits.map((v) => format(v)),
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
        },
      ],
      series: [
        {},
        ...seriesRef.current.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: s.thin ? 1.5 : 2,
          dash: s.thin ? [4, 3] : undefined,
          spanGaps: true,
          points: { show: false },
        })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            setHover(idx === null || idx === undefined || (u.cursor.left ?? -1) < 0 ? null : { idx, left: u.cursor.left!, rect: u.over.getBoundingClientRect() })
          },
        ],
      },
      padding: [8, 12, 0, 0],
    }
    const u = new uPlot(opts, [[]], el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
  }, [shape, dark, log, format])

  useEffect(() => {
    // A log scale can't show zeros.
    const values = series.map((s) => (log ? s.values.map((v) => (v === null || v <= 0 ? null : v)) : s.values))
    plotRef.current?.setData([times, ...values] as uPlot.AlignedData)
  }, [times, series, log, shape, dark, format])

  let tip = null
  if (hover && hover.idx < times.length) {
    const r = hover.rect
    const x = r.left + hover.left
    const style: React.CSSProperties = x > r.left + r.width / 2 ? { right: window.innerWidth - x + 10 } : { left: x + 10 }
    style.top = r.top
    // Sparse series show their latest value at or before the hovered point.
    const at = (s: LiveSeries) => {
      for (let i = hover.idx; i >= 0 && i > hover.idx - 8; i--) if (s.values[i] !== null) return s.values[i]
      return null
    }
    tip = (
      <div className="chart-tip" style={style}>
        <div className="muted">{formatClock(times[hover.idx])}</div>
        {series.map((s) => {
          const v = at(s)
          return (
            <div key={s.id} className="chart-tip-row">
              <LineKey color={s.color} thin={s.thin} />
              <strong>{v === null ? '–' : format(v)}</strong>
              <span className="muted">{s.label}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.id}>
            <LineKey color={s.color} thin={s.thin} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="chart">
        <div ref={wrapRef} className="chart-plot" />
        {tip}
      </div>
      {times.length < 2 && <p className="chart-empty muted">Collecting…</p>}
    </div>
  )
}

export default LiveChart
