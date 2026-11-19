// Polls the providers while the tab is visible and keeps what the page shows: every message slot seen
// in a mempool, each provider's latest snapshot, the tipsets since the page opened, and a 5 s series.
import { ACTOR_CODES, ACTOR_CODES_NV } from './actorCodes'
import { ACTOR_CODES_URL, PROVIDERS, type Provider, type ProviderKey } from './providers'
import { rpc, slotOf, type BlockMessages, type Cid, type SignedMessage, type TipSet } from './rpc'
import { percentile } from './stats'

export const TICK_MS = 5000
// Messages included or gone longer than this are dropped, and the series keeps this much.
export const KEEP_MS = 60 * 60 * 1000
const SERIES_POINTS = KEEP_MS / TICK_MS
// A provider failing for longer than this no longer counts towards the pending set.
const STALE_MS = 60 * 1000
const MAX_BACKOFF_MS = 5 * 60 * 1000
// After a long hidden tab, skip the missed tipsets rather than fetch them all.
const MAX_CATCHUP = 10
const ACTOR_CONCURRENCY = 4
// A failed actor lookup is retried after this.
const ACTOR_RETRY_MS = 60 * 1000

export interface Tracked {
  slot: string
  cid: string
  from: string
  to: string
  nonce: number
  method: number
  // attoFIL
  value: number
  gasLimit: number
  feeCap: number
  premium: number
  // ms
  firstSeen: number
  lastSeen: number
  // Last time each provider listed it, ms.
  seenBy: Partial<Record<ProviderKey, number>>
  // In a provider's first snapshot: already waiting for an unknown time, so firstSeen is a lower bound.
  atOpen: boolean
  // Other CIDs seen for the slot: replacements, usually with a higher premium.
  replaced: number
  included: { height: number; time: number } | null
  // As the provider returned it, for the JSON view.
  raw: SignedMessage
}

export interface ProviderState {
  lastOk: number | null
  latencyMs: number | null
  // Messages in the latest snapshot.
  count: number | null
  polls: number
  errors: number
  lastError: string | null
  failStreak: number
  backoffUntil: number
  snapshot: Set<string>
}

export interface TipsetRecord {
  height: number
  // Unix seconds of the epoch.
  time: number
  baseFee: number
  messages: number
  // Messages that were in a polled mempool before this tipset.
  seen: number
  // Whether the page was open long enough before this epoch for it to count towards coverage.
  counted: boolean
}

export interface SeriesPoint {
  // Unix seconds.
  t: number
  pending: number
  // Snapshot size of the provider polled at this tick.
  byProvider: Partial<Record<ProviderKey, number>>
  baseFee: number | null
  premium: { p10: number; p50: number; p90: number } | null
}

export interface Head {
  height: number
  time: number
  baseFee: number
}

const emptyProvider = (): ProviderState => ({
  lastOk: null,
  latencyMs: null,
  count: null,
  polls: 0,
  errors: 0,
  lastError: null,
  failStreak: 0,
  backoffUntil: 0,
  snapshot: new Set(),
})

// What the views render from: a new object on every change, holding the tracker that changed.
export interface Snapshot {
  readonly tracker: Tracker
  readonly version: number
}

export class Tracker {
  readonly startedAt = Date.now()
  messages = new Map<string, Tracked>()
  providers = Object.fromEntries(PROVIDERS.map((p) => [p.key, emptyProvider()])) as Record<ProviderKey, ProviderState>
  tipsets: TipsetRecord[] = []
  series: SeriesPoint[] = []
  head: Head | null = null
  // Slots pending now: in a usable snapshot and not included.
  pending = new Set<string>()
  paused = false
  // Actor type per receiver address; missing = not looked up yet.
  actors = new Map<string, string>()
  private snapshot: Snapshot = { tracker: this, version: 0 }

  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  // Bumped on every start, so a tick still waiting on the network from before a pause stops there.
  private run = 0
  private turn = 0
  private actorTurn = 0
  private actorFailed = new Map<string, number>()
  private processed: number | null = null
  private chainBusy = false
  private actorQueue: string[] = []
  private actorsActive = 0
  private codes = new Map(Object.entries(ACTOR_CODES))
  private codesLoaded = false

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getSnapshot = () => this.snapshot

  // Runs while the tab is visible and not paused.
  start() {
    document.addEventListener('visibilitychange', this.onVisibility)
    this.onVisibility()
  }

  stop() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.halt()
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.onVisibility()
    this.emit()
  }

  get active() {
    return this.running
  }

  private onVisibility = () => {
    if (!document.hidden && !this.paused) {
      if (!this.running) {
        this.running = true
        void this.tick(++this.run)
      }
    } else this.halt()
  }

  private halt() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.emit()
  }

  private emit() {
    this.snapshot = { tracker: this, version: this.snapshot.version + 1 }
    for (const fn of this.listeners) fn()
  }

  private async tick(run: number) {
    const started = Date.now()
    const ready = PROVIDERS.filter((p) => this.providers[p.key].backoffUntil <= started)
    let polled: Provider | null = null
    if (ready.length) {
      // One mempool snapshot per tick in rotation, and the head from the next provider in line.
      polled = ready[this.turn % ready.length]
      const headFrom = ready[(this.turn + 1) % ready.length]
      this.turn++
      await Promise.all([this.pollMpool(polled), this.pollHead(headFrom)])
    }
    if (run !== this.run || !this.running) return
    this.updatePending()
    this.record(polled)
    this.prune()
    this.emit()
    void this.advanceChain()
    this.timer = setTimeout(() => void this.tick(run), Math.max(0, TICK_MS - (Date.now() - started)))
  }

  private failed(st: ProviderState, err: unknown) {
    st.errors++
    st.failStreak++
    st.lastError = err instanceof Error ? err.message : String(err)
    st.backoffUntil = Date.now() + Math.min(MAX_BACKOFF_MS, TICK_MS * 2 ** st.failStreak)
  }

  private async pollMpool(p: Provider) {
    const st = this.providers[p.key]
    const t0 = performance.now()
    st.polls++
    try {
      const msgs = await rpc<SignedMessage[]>(p.url, 'MpoolPending', [null], 20000)
      const now = Date.now()
      // Each provider's first snapshot lists messages that were waiting before the page opened.
      const first = st.lastOk === null
      st.latencyMs = Math.round(performance.now() - t0)
      st.lastOk = now
      st.count = msgs.length
      st.failStreak = 0
      st.lastError = null
      const snapshot = new Set<string>()
      for (const sm of msgs) snapshot.add(this.see(sm, p.key, now, first))
      st.snapshot = snapshot
    } catch (err) {
      this.failed(st, err)
    }
  }

  private see(sm: SignedMessage, provider: ProviderKey, now: number, first: boolean): string {
    const m = sm.Message
    const slot = slotOf(m)
    const cid = sm.CID['/']
    const t = this.messages.get(slot)
    if (t) {
      t.lastSeen = now
      t.seenBy[provider] = now
      if (t.cid !== cid && !t.included) {
        t.replaced++
        Object.assign(t, fields(sm))
      }
      this.queueActor(t.to)
      return slot
    }
    this.messages.set(slot, {
      slot,
      ...fields(sm),
      firstSeen: now,
      lastSeen: now,
      seenBy: { [provider]: now },
      atOpen: first,
      replaced: 0,
      included: null,
    })
    this.queueActor(m.To)
    return slot
  }

  private async pollHead(p: Provider) {
    this.providers[p.key].polls++
    try {
      const ts = await rpc<TipSet>(p.url, 'ChainHead', [])
      if (!this.head || ts.Height > this.head.height) {
        this.head = { height: ts.Height, time: ts.Blocks[0].Timestamp, baseFee: Number(ts.Blocks[0].ParentBaseFee) }
      }
    } catch (err) {
      this.failed(this.providers[p.key], err)
    }
  }

  private updatePending() {
    const now = Date.now()
    const pending = new Set<string>()
    for (const p of PROVIDERS) {
      const st = this.providers[p.key]
      if (st.lastOk === null || (st.failStreak > 0 && now - st.lastOk > STALE_MS)) continue
      for (const slot of st.snapshot) if (!this.messages.get(slot)?.included) pending.add(slot)
    }
    this.pending = pending
  }

  private record(polled: Provider | null) {
    const premiums: number[] = []
    for (const slot of this.pending) premiums.push(this.messages.get(slot)!.premium)
    premiums.sort((a, b) => a - b)
    const byProvider: SeriesPoint['byProvider'] = {}
    if (polled && this.providers[polled.key].failStreak === 0) byProvider[polled.key] = this.providers[polled.key].count!
    // A new array per point, so the charts see the change.
    this.series = [...this.series.slice(1 - SERIES_POINTS), {
      t: Date.now() / 1000,
      pending: this.pending.size,
      byProvider,
      baseFee: this.head?.baseFee ?? null,
      premium: premiums.length
        ? { p10: percentile(premiums, 0.1), p50: percentile(premiums, 0.5), p90: percentile(premiums, 0.9) }
        : null,
    }]
  }

  private prune() {
    const cutoff = Date.now() - KEEP_MS
    for (const [slot, t] of this.messages) {
      if (t.included ? t.included.time * 1000 < cutoff : !this.pending.has(slot) && t.lastSeen < cutoff) this.messages.delete(slot)
    }
    const keepFrom = Math.floor(cutoff / 1000)
    this.tipsets = this.tipsets.filter((ts) => ts.time >= keepFrom)
  }

  // Reads the tipsets up to one below the head, so each has all its blocks, and marks their
  // messages included.
  private async advanceChain() {
    if (this.chainBusy || !this.head) return
    this.chainBusy = true
    try {
      // Tipsets up to the first head were selected before the page opened.
      if (this.processed === null) this.processed = this.head.height
      const last = this.head.height - 1
      if (last - this.processed > MAX_CATCHUP) this.processed = last - MAX_CATCHUP
      for (let h = this.processed + 1; h <= last && this.running; h++) {
        if (!(await this.readTipset(h))) break
        this.processed = h
        this.emit()
      }
    } finally {
      this.chainBusy = false
    }
  }

  // false if no provider answered; the height is retried on the next tick.
  private async readTipset(height: number): Promise<boolean> {
    const now = Date.now()
    const ready = PROVIDERS.filter((p) => this.providers[p.key].backoffUntil <= now)
    for (let i = 0; i < ready.length; i++) {
      const p = ready[(this.turn + i) % ready.length]
      try {
        const ts = await rpc<TipSet>(p.url, 'ChainGetTipSetByHeight', [height, null])
        // A null round: the node returns the tipset below.
        if (ts.Height !== height) return true
        const blocks = await Promise.all(ts.Cids.map((c: Cid) => rpc<BlockMessages>(p.url, 'ChainGetBlockMessages', [c])))
        const time = ts.Blocks[0].Timestamp
        // A message can be in several blocks of a tipset; it counts once.
        const slots = new Set<string>()
        for (const b of blocks) {
          for (const m of b.BlsMessages) slots.add(slotOf(m))
          for (const sm of b.SecpkMessages) slots.add(slotOf(sm.Message))
        }
        let seen = 0
        for (const slot of slots) {
          const t = this.messages.get(slot)
          if (!t) continue
          seen++
          if (!t.included) t.included = { height, time }
          this.pending.delete(slot)
        }
        this.tipsets.push({
          height,
          time,
          baseFee: Number(ts.Blocks[0].ParentBaseFee),
          messages: slots.size,
          seen,
          // A message waits up to an epoch; the first epoch after opening is only partly covered.
          counted: time * 1000 >= this.startedAt + 30_000,
        })
        return true
      } catch {
        // Try the next provider.
      }
    }
    return false
  }

  private queueActor(addr: string) {
    if (this.actors.has(addr) || this.actorQueue.includes(addr)) return
    if (Date.now() - (this.actorFailed.get(addr) ?? 0) < ACTOR_RETRY_MS) return
    this.actorQueue.push(addr)
    this.drainActors()
  }

  private drainActors() {
    while (this.actorsActive < ACTOR_CONCURRENCY && this.actorQueue.length) {
      const addr = this.actorQueue.shift()!
      this.actorsActive++
      void this.lookupActor(addr).finally(() => {
        this.actorsActive--
        this.drainActors()
      })
    }
  }

  private async lookupActor(addr: string) {
    const ready = PROVIDERS.filter((p) => this.providers[p.key].backoffUntil <= Date.now())
    const p = ready[this.actorTurn++ % Math.max(1, ready.length)] ?? PROVIDERS[0]
    try {
      const a = await rpc<{ Code: Cid }>(p.url, 'StateGetActor', [addr, null])
      let type = this.codes.get(a.Code['/'])
      if (!type && !this.codesLoaded) {
        await this.loadCodes()
        type = this.codes.get(a.Code['/'])
      }
      this.actors.set(addr, type ?? 'unknown')
    } catch (err) {
      // A receiver that doesn't exist yet, e.g. a first transfer to a new address. Other errors are
      // retried after a while, when the address shows up again.
      if (/actor not found/i.test(String(err))) this.actors.set(addr, 'unknown')
      else this.actorFailed.set(addr, Date.now())
    }
    this.emit()
  }

  // Code CIDs of network versions newer than the generated table.
  private async loadCodes() {
    this.codesLoaded = true
    try {
      const nv = await rpc<number>(ACTOR_CODES_URL, 'StateNetworkVersion', [null])
      for (let v = ACTOR_CODES_NV + 1; v <= nv; v++) {
        const codes = await rpc<Record<string, Cid>>(ACTOR_CODES_URL, 'StateActorCodeCIDs', [v])
        for (const [name, cid] of Object.entries(codes)) this.codes.set(cid['/'], name)
      }
    } catch {
      // Unknown types show as 'unknown'.
    }
  }
}

function fields(sm: SignedMessage) {
  const m = sm.Message
  return {
    cid: sm.CID['/'],
    from: m.From,
    to: m.To,
    nonce: m.Nonce,
    method: m.Method,
    value: Number(m.Value),
    gasLimit: m.GasLimit,
    feeCap: Number(m.GasFeeCap),
    premium: Number(m.GasPremium),
    raw: sm,
  }
}
