// Figures derived from the tracker's state for the views.
import { actorLabel, methodName } from './methods'
import { PROVIDER_KEYS, type ProviderKey } from './providers'
import type { Tracked, Tracker } from './tracker'

// q-quantile of ascending values, nearest rank.
export function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}

// "miner.SubmitWindowedPoSt"; the method number alone until the receiver's type is known.
export function methodLabel(t: Tracked, actors: Map<string, string>): string {
  const type = actors.get(t.to)
  if (type === undefined) return t.method === 0 ? 'Send' : `…#${t.method}`
  return `${actorLabel(type)}.${methodName(type, t.method)}`
}

// Seconds from first seen to the epoch that included it; 0 if first seen within that epoch.
export function waitOf(t: Tracked): number | null {
  return t.included ? Math.max(0, t.included.time - t.firstSeen / 1000) : null
}

export function pendingList(tr: Tracker): Tracked[] {
  return [...tr.pending].map((slot) => tr.messages.get(slot)!)
}

export interface Coverage {
  epochs: number
  messages: number
  seen: number
}

// Messages on chain that a polled mempool had shown before, over the epochs that count.
export function coverage(tr: Tracker, lastEpochs = Infinity): Coverage {
  const counted = tr.tipsets.filter((ts) => ts.counted).slice(-lastEpochs)
  return {
    epochs: counted.length,
    messages: counted.reduce((a, ts) => a + ts.messages, 0),
    seen: counted.reduce((a, ts) => a + ts.seen, 0),
  }
}

export interface WaitStats {
  label: string
  count: number
  p50: number
  p90: number
}

function waitStats(label: string, waits: number[]): WaitStats {
  const sorted = [...waits].sort((a, b) => a - b)
  return { label, count: sorted.length, p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) }
}

// Included messages whose wait is known: first seen after the page's first snapshot.
export const timed = (included: Tracked[]) => included.filter((t) => !t.atOpen)

export function includedList(tr: Tracker): Tracked[] {
  return [...tr.messages.values()].filter((t) => t.included).sort((a, b) => b.included!.height - a.included!.height || a.firstSeen - b.firstSeen)
}

export function waitsBy(included: Tracked[], key: (t: Tracked) => string): WaitStats[] {
  const groups = new Map<string, number[]>()
  for (const t of included) {
    const k = key(t)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(waitOf(t)!)
  }
  return [...groups].map(([label, waits]) => waitStats(label, waits)).sort((a, b) => b.count - a.count)
}

export function overallWait(included: Tracked[]): WaitStats | null {
  return included.length ? waitStats('all', included.map((t) => waitOf(t)!)) : null
}

// Wait times per decade band of the gas premium in attoFIL ("100K–1M"), lowest band first.
export function waitsByPremium(included: Tracked[]): WaitStats[] {
  const exp = (t: Tracked) => (t.premium > 0 ? Math.floor(Math.log10(t.premium)) : -1)
  const label = (e: number) => (e < 0 ? '0' : `${compactPow(e)}–${compactPow(e + 1)}`)
  const order = new Map(included.map((t) => [label(exp(t)), exp(t)]))
  return waitsBy(included, (t) => label(exp(t))).sort((a, b) => order.get(a.label)! - order.get(b.label)!)
}

function compactPow(e: number): string {
  const unit = ['', 'K', 'M', 'B', 'T'][Math.min(4, Math.floor(e / 3))]
  return `${10 ** (e - 3 * Math.min(4, Math.floor(e / 3)))}${unit}`
}

export interface ProviderView {
  key: ProviderKey
  // Pending slots this provider lists.
  listed: number
  // Pending slots no other provider lists.
  only: number
}

export function providerViews(tr: Tracker): ProviderView[] {
  return PROVIDER_KEYS.map((key) => {
    let listed = 0
    let only = 0
    for (const slot of tr.pending) {
      if (!tr.providers[key].snapshot.has(slot)) continue
      listed++
      if (PROVIDER_KEYS.every((k) => k === key || !tr.providers[k].snapshot.has(slot))) only++
    }
    return { key, listed, only }
  })
}

export interface SenderBacklog {
  from: string
  pending: number
  lowestNonce: number
  // ms since the oldest of its pending messages was first seen.
  oldestAge: number
  // That message was already pending when the page opened, so oldestAge is a lower bound.
  atOpen: boolean
}

// Senders with several messages pending, longest-waiting first.
export function backlogs(pending: Tracked[], now: number, min = 5): SenderBacklog[] {
  const by = new Map<string, Tracked[]>()
  for (const t of pending) {
    if (!by.has(t.from)) by.set(t.from, [])
    by.get(t.from)!.push(t)
  }
  return [...by]
    .filter(([, ts]) => ts.length >= min)
    .map(([from, ts]) => {
      const oldest = ts.reduce((a, t) => (t.firstSeen < a.firstSeen ? t : a))
      return {
        from,
        pending: ts.length,
        lowestNonce: Math.min(...ts.map((t) => t.nonce)),
        oldestAge: now - oldest.firstSeen,
        atOpen: oldest.atOpen,
      }
    })
    .sort((a, b) => b.oldestAge - a.oldestAge)
}
