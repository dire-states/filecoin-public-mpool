// Lotus JSON-RPC over HTTP, and the response shapes the page reads.

export interface Cid {
  '/': string
}

export interface LotusMessage {
  Version?: number
  To: string
  From: string
  Nonce: number
  // attoFIL, as decimal strings.
  Value: string
  GasLimit: number
  GasFeeCap: string
  GasPremium: string
  Method: number
  // Base64 CBOR; null or empty when there are none.
  Params?: string | null
  CID: Cid
}

export interface SignedMessage {
  Message: LotusMessage
  Signature?: { Type: number; Data: string }
  CID: Cid
}

export interface TipSet {
  Height: number
  Cids: Cid[]
  Blocks: { Timestamp: number; ParentBaseFee: string }[]
}

export interface BlockMessages {
  BlsMessages: LotusMessage[]
  SecpkMessages: SignedMessage[]
}

let rpcId = 0

export async function rpc<T>(url: string, method: string, params: unknown[], timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: `Filecoin.${method}`, params, id: ++rpcId }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`)
  const body = (await res.json()) as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result as T
}

// Sender and nonce identify a message slot; a replacement (higher premium) keeps the slot, not the CID.
export const slotOf = (m: { From: string; Nonce: number }) => `${m.From}:${m.Nonce}`
