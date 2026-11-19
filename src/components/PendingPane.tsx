import { useMemo, useState } from 'react'
import { seriesColor, useDarkMode } from '../lib/colors'
import { formatAge, formatAtto, formatCount, formatFil, shortAddr } from '../lib/format'
import { PROVIDERS, type ProviderKey } from '../lib/providers'
import { methodLabel } from '../lib/stats'
import type { Tracked } from '../lib/tracker'

type Snapshots = Record<ProviderKey, Set<string>>

interface Props {
  pending: Tracked[]
  actors: Map<string, string>
  snapshots: Snapshots
  now: number
  selected: string | null
  onSelect: (slot: string) => void
}

type SortKey = 'age' | 'method' | 'value' | 'feeCap' | 'premium' | 'gasLimit'

// Senders with this many messages pending show as one row, opened on click.
const GROUP_MIN = 10
const MAX_ROWS = 400

const COLUMNS: { key: SortKey | null; label: string; title?: string; left?: boolean }[] = [
  { key: 'age', label: 'Age', title: 'Since first seen in a polled mempool' },
  { key: null, label: 'From', left: true },
  { key: null, label: 'Nonce' },
  { key: 'method', label: 'Method', left: true },
  { key: 'value', label: 'Value FIL' },
  { key: 'feeCap', label: 'Fee cap', title: 'attoFIL per gas unit' },
  { key: 'premium', label: 'Premium', title: 'attoFIL per gas unit' },
  { key: 'gasLimit', label: 'Gas limit' },
  { key: null, label: 'Seen by', title: 'Providers whose latest snapshot lists it' },
]

// Filled: the provider's latest snapshot lists the message (for a group: any of them); hollow: not.
function SeenBy({ ts, snapshots, dark }: { ts: Tracked[]; snapshots: Snapshots; dark: boolean }) {
  return (
    <span className="seen-by">
      {PROVIDERS.map((p, i) => {
        const listed = ts.filter((t) => snapshots[p.key].has(t.slot)).length
        const title = ts.length > 1 ? `${p.label}: lists ${listed} of ${ts.length}` : `${p.label}: ${listed ? 'listed' : ts[0].seenBy[p.key] ? 'listed earlier' : 'not listed'}`
        return <span key={p.key} className="dot" title={title} style={listed ? { background: seriesColor(i, dark) } : undefined} />
      })}
    </span>
  )
}

function Age({ t, now }: { t: Tracked; now: number }) {
  return (
    <td title={t.atOpen ? 'Already pending when the page opened' : undefined}>
      {t.atOpen && '≥'}
      {formatAge((now - t.firstSeen) / 1000)}
    </td>
  )
}

interface RowProps {
  t: Tracked
  label: string
  snapshots: Snapshots
  now: number
  dark: boolean
  indent?: boolean
  selected: boolean
  onSelect: (slot: string) => void
}

function Row({ t, label, snapshots, now, dark, indent, selected, onSelect }: RowProps) {
  return (
    <tr className={['selectable', indent && 'sub', selected && 'selected'].filter(Boolean).join(' ')} onClick={() => onSelect(t.slot)}>
      <Age t={t} now={now} />
      <td className="mono left" title={t.from}>
        {shortAddr(t.from)}
      </td>
      <td>{t.nonce}</td>
      <td className="method-cell left" title={`to ${t.to}`}>
        {label}
        {t.replaced > 0 && (
          <span className="tag" title="Replaced by a message with the same nonce">
            ×{t.replaced + 1}
          </span>
        )}
      </td>
      <td>{formatFil(t.value)}</td>
      <td>{formatAtto(t.feeCap)}</td>
      <td>{formatAtto(t.premium)}</td>
      <td>{formatAtto(t.gasLimit)}</td>
      <td>
        <SeenBy ts={[t]} snapshots={snapshots} dark={dark} />
      </td>
    </tr>
  )
}

function PendingPane({ pending, actors, snapshots, now, selected, onSelect }: Props) {
  const dark = useDarkMode()
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'age', desc: true })
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const labelled = pending.map((t) => ({ t, label: methodLabel(t, actors) }))
    const matched = q ? labelled.filter(({ t, label }) => label.toLowerCase().includes(q) || t.from.includes(q) || t.to.includes(q)) : labelled
    const value = (r: (typeof labelled)[number]): number | string => {
      switch (sort.key) {
        case 'age':
          return -r.t.firstSeen
        case 'method':
          return r.label
        default:
          return r.t[sort.key]
      }
    }
    const cmp = (a: (typeof labelled)[number], b: (typeof labelled)[number]) => {
      const va = value(a)
      const vb = value(b)
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
      return sort.desc ? -c : c
    }
    // Group large backlogs by sender; a group sorts by its first row.
    const bySender = new Map<string, typeof labelled>()
    for (const r of matched) {
      if (!bySender.has(r.t.from)) bySender.set(r.t.from, [])
      bySender.get(r.t.from)!.push(r)
    }
    const items: { from: string | null; rows: typeof labelled }[] = []
    for (const [from, rs] of bySender) {
      rs.sort(cmp)
      if (rs.length >= GROUP_MIN) items.push({ from, rows: rs })
      else for (const r of rs) items.push({ from: null, rows: [r] })
    }
    items.sort((a, b) => cmp(a.rows[0], b.rows[0]))
    return { items, total: matched.length }
  }, [pending, actors, sort, filter])

  // The rows to render: groups, and the rows of open groups, up to MAX_ROWS.
  const visible = useMemo(() => {
    const out: ({ kind: 'row'; r: (typeof rows.items)[number]['rows'][number]; sub: boolean } | { kind: 'group'; from: string; rs: (typeof rows.items)[number]['rows'] })[] = []
    for (const item of rows.items) {
      if (!item.from) out.push({ kind: 'row', r: item.rows[0], sub: false })
      else {
        out.push({ kind: 'group', from: item.from, rs: item.rows })
        if (open.has(item.from)) for (const r of item.rows) out.push({ kind: 'row', r, sub: true })
      }
      if (out.length >= MAX_ROWS) break
    }
    return out.slice(0, MAX_ROWS)
  }, [rows, open])

  const toggle = (from: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(from)) n.delete(from)
      else n.add(from)
      return n
    })

  return (
    <section className="pane pending-pane">
      <div className="pane-head">
        <h2 className="pane-title">Pending</h2>
        <span className="counts">{formatCount(rows.total)} messages</span>
        <input
          className="filter"
          type="search"
          placeholder="Filter method or address"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  title={c.title}
                  className={[c.key && 'sortable', c.left && 'left'].filter(Boolean).join(' ') || undefined}
                  aria-sort={c.key === sort.key ? (sort.desc ? 'descending' : 'ascending') : undefined}
                  onClick={c.key ? () => setSort((s) => ({ key: c.key!, desc: s.key === c.key ? !s.desc : true })) : undefined}
                >
                  {c.label}
                  {c.key === sort.key && (sort.desc ? ' ↓' : ' ↑')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((v) => {
              if (v.kind === 'row')
                return (
                  <Row
                    key={v.r.t.slot}
                    t={v.r.t}
                    label={v.r.label}
                    snapshots={snapshots}
                    now={now}
                    dark={dark}
                    indent={v.sub}
                    selected={v.r.t.slot === selected}
                    onSelect={onSelect}
                  />
                )
              const nonces = v.rs.map((r) => r.t.nonce)
              return (
                <tr key={`group:${v.from}`} className="group" onClick={() => toggle(v.from)}>
                  <Age t={v.rs.reduce((a, r) => (r.t.firstSeen < a.firstSeen ? r.t : a), v.rs[0].t)} now={now} />
                  <td className="mono left" title={v.from}>
                    {open.has(v.from) ? '▾' : '▸'} {shortAddr(v.from)}
                  </td>
                  <td>
                    {Math.min(...nonces)}–{Math.max(...nonces)}
                  </td>
                  <td colSpan={5} className="left">
                    <strong>{formatCount(v.rs.length)} messages</strong>{' '}
                    <span className="muted">{[...new Set(v.rs.map((r) => r.label))].slice(0, 3).join(', ')}</span>
                  </td>
                  <td>
                    <SeenBy ts={v.rs.map((r) => r.t)} snapshots={snapshots} dark={dark} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.total === 0 && <p className="empty muted">{pending.length ? 'No match.' : 'Waiting for the first snapshot…'}</p>}
        {visible.length >= MAX_ROWS && <p className="empty muted">First {MAX_ROWS} rows; filter to narrow down.</p>}
      </div>
    </section>
  )
}

export default PendingPane
