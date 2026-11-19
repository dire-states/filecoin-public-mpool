// A minimal CBOR decoder for message params, to JSON: byte strings as 0x hex, integers beyond 2^53 as
// strings, CIDs (tag 42) as { "/": "0x…" } with their raw bytes.

const hex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

class Reader {
  pos = 0
  private b: Uint8Array
  constructor(b: Uint8Array) {
    this.b = b
  }

  private take(n: number): Uint8Array {
    if (this.pos + n > this.b.length) throw new Error('truncated')
    const out = this.b.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  // The argument of a head byte: a length, a count or the integer itself.
  private arg(info: number): number | bigint {
    if (info < 24) return info
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0
    if (!n) throw new Error(`unsupported additional info ${info}`)
    let v = 0n
    for (const x of this.take(n)) v = (v << 8n) | BigInt(x)
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v
  }

  private len(info: number): number {
    const n = this.arg(info)
    if (typeof n === 'bigint') throw new Error('length too large')
    return n
  }

  item(): unknown {
    const head = this.take(1)[0]
    const major = head >> 5
    const info = head & 31
    switch (major) {
      case 0: {
        const v = this.arg(info)
        return typeof v === 'bigint' ? v.toString() : v
      }
      case 1: {
        const v = this.arg(info)
        return typeof v === 'bigint' ? (-1n - v).toString() : -1 - v
      }
      case 2:
        return hex(this.take(this.len(info)))
      case 3:
        return new TextDecoder().decode(this.take(this.len(info)))
      case 4:
        return Array.from({ length: this.len(info) }, () => this.item())
      case 5: {
        const out: Record<string, unknown> = {}
        for (let i = this.len(info); i > 0; i--) {
          const k = this.item()
          out[typeof k === 'string' ? k : JSON.stringify(k)] = this.item()
        }
        return out
      }
      case 6: {
        const tag = this.arg(info)
        const v = this.item()
        // A CID: a byte string with a leading 0x00 (multibase identity) prefix.
        if (tag === 42 && typeof v === 'string') return { '/': '0x' + v.slice(4) }
        return { tag: String(tag), value: v }
      }
      default: {
        if (info === 20) return false
        if (info === 21) return true
        if (info === 22 || info === 23) return null
        const view = new DataView(this.b.buffer, this.b.byteOffset + this.pos)
        if (info === 25) return this.float16(this.take(2))
        if (info === 26) return (this.take(4), view.getFloat32(0))
        if (info === 27) return (this.take(8), view.getFloat64(0))
        throw new Error(`unsupported simple value ${info}`)
      }
    }
  }

  private float16(b: Uint8Array): number {
    const h = (b[0] << 8) | b[1]
    const exp = (h >> 10) & 31
    const frac = h & 1023
    const v = exp === 0 ? frac * 2 ** -24 : exp === 31 ? (frac ? NaN : Infinity) : (1 + frac / 1024) * 2 ** (exp - 15)
    return h & 0x8000 ? -v : v
  }

  get done() {
    return this.pos === this.b.length
  }
}

// Base64 CBOR params as JSON; { error } when they don't decode.
export function decodeParams(b64: string): unknown {
  try {
    const r = new Reader(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    const v = r.item()
    if (!r.done) throw new Error('trailing bytes')
    return v
  } catch (err) {
    return { error: `params do not decode as CBOR: ${err instanceof Error ? err.message : String(err)}` }
  }
}
