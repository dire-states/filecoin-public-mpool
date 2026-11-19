export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

// "1 epoch", "3 epochs"
export function plural(n: number, word: string): string {
  return `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// UTC "YYYY-MM-DD HH:MM" for a unix second.
export function formatTime(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

export function formatDate(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

// "45s", "3m 05s", "1h 02m".
export function formatAge(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

// f410fwbt6ud5b…k3wnrk7yq
export function shortAddr(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr
}

// attoFIL as FIL, up to 4 significant digits.
export function formatFil(atto: number): string {
  if (atto === 0) return '0'
  const fil = atto / 1e18
  // Plain decimals, never "3.061e-9".
  return fil >= 1000 ? formatCompact(fil) : fil.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

// attoFIL amounts like gas prices, compact: "798K".
export const formatAtto = formatCompact

// Local "HH:MM:SS" for a unix second.
export function formatClock(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString('en-GB', { hour12: false })
}
