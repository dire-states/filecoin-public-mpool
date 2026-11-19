import { useMemo, useState } from 'react'
import { decodeParams } from '../lib/cbor'
import { seriesColor, useDarkMode } from '../lib/colors'
import { formatAge, formatAtto, formatClock, formatCount, formatFil } from '../lib/format'
import { PROVIDERS, type ProviderKey } from '../lib/providers'
import { methodLabel, waitOf } from '../lib/stats'
import type { SignedMessage } from '../lib/rpc'
import type { Tracker } from '../lib/tracker'

interface Props {
  tracker: Tracker
  slot: string
  snapshots: Record<ProviderKey, Set<string>>
  now: number
}

// Small amounts in attoFIL rather than as "5.013e-8 FIL".
const maxFee = (atto: number) => (atto < 1e14 ? `${formatAtto(atto)} attoFIL` : `${formatFil(atto)} FIL`)

const explorer = (kind: 'message' | 'address', id: string) => `https://filfox.info/en/${kind}/${id}`

// The message as the provider returned it, with its params decoded alongside.
function messageJson(raw: SignedMessage): string {
  const m = raw.Message
  const message = m.Params ? { ...m, ParamsDecoded: decodeParams(m.Params) } : m
  return JSON.stringify({ ...raw, Message: message }, null, 2)
}

function JsonView({ raw }: { raw: SignedMessage }) {
  const json = useMemo(() => messageJson(raw), [raw])
  const [copied, setCopied] = useState(false)
  // The clipboard API needs a secure context (https or localhost).
  const copy = () =>
    void navigator.clipboard
      ?.writeText(json)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  return (
    <>
      <h3 className="sub-title">
        JSON
        <button className="btn" onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </button>
      </h3>
      <pre className="message-json">{json}</pre>
    </>
  )
}

// Everything the page knows about one message slot.
function MessageDetail({ tracker, slot, snapshots, now }: Props) {
  const dark = useDarkMode()
  const t = tracker.messages.get(slot)
  if (!t) return <p className="muted small">No longer tracked: messages are kept for an hour after they leave the mempool.</p>

  const status = t.included
    ? `included at ${formatCount(t.included.height)}`
    : tracker.pending.has(slot)
      ? 'pending'
      : 'no longer listed by any provider'
  const wait = waitOf(t)
  const actor = tracker.actors.get(t.to)

  return (
    <>
      <dl className="message-detail">
        <dt>Status</dt>
        <dd>
          <strong>{status}</strong>
          {wait !== null && (
            <span className="muted">
              {' '}
              after {t.atOpen && '≥'}
              {formatAge(wait)}
            </span>
          )}
          {!t.included && (
            <span className="muted">
              {' '}
              for {t.atOpen && '≥'}
              {formatAge((now - t.firstSeen) / 1000)}
            </span>
          )}
        </dd>
        <dt>CID</dt>
        <dd className="mono">
          <a href={explorer('message', t.cid)} target="_blank" rel="noreferrer">
            {t.cid}
          </a>
          {t.replaced > 0 && (
            <span className="tag" title="Other CIDs seen for this sender and nonce">
              ×{t.replaced + 1}
            </span>
          )}
        </dd>
        <dt>From</dt>
        <dd className="mono">
          <a href={explorer('address', t.from)} target="_blank" rel="noreferrer">
            {t.from}
          </a>{' '}
          <span className="muted">nonce {t.nonce}</span>
        </dd>
        <dt>To</dt>
        <dd className="mono">
          <a href={explorer('address', t.to)} target="_blank" rel="noreferrer">
            {t.to}
          </a>
        </dd>
        <dt>Method</dt>
        <dd>
          {methodLabel(t, tracker.actors)} <span className="muted">#{t.method}{actor === undefined && t.method !== 0 && ', receiver type not known yet'}</span>
        </dd>
        <dt>Value</dt>
        <dd>{formatFil(t.value)} FIL</dd>
        <dt>Gas</dt>
        <dd>
          limit {formatCount(t.gasLimit)} · fee cap {formatAtto(t.feeCap)} · premium {formatAtto(t.premium)}{' '}
          <span className="muted" title="Fee cap × gas limit">
            (at most {maxFee(t.feeCap * t.gasLimit)})
          </span>
        </dd>
        <dt>Seen</dt>
        <dd>
          first {formatClock(t.firstSeen / 1000)}
          {t.atOpen && <span className="muted"> (already pending when the page opened)</span>}, last {formatClock(t.lastSeen / 1000)}
        </dd>
        <dt>Providers</dt>
        <dd className="seen-list">
          {PROVIDERS.map((p, i) => {
            const listed = snapshots[p.key].has(slot)
            const at = t.seenBy[p.key]
            return (
              <span key={p.key}>
                <span className="dot" style={listed ? { background: seriesColor(i, dark) } : undefined} /> {p.label}{' '}
                <span className="muted">{listed ? 'lists it' : at ? `listed ${formatAge((now - at) / 1000)} ago` : 'never listed'}</span>
              </span>
            )
          })}
        </dd>
      </dl>
      <JsonView raw={t.raw} />
    </>
  )
}

export default MessageDetail
