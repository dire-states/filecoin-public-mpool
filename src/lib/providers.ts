// Public mainnet nodes that serve Filecoin.MpoolPending without a key and allow browser requests
// (tested 2026-11-18). None of them serves MpoolSub, so the page polls.
export type ProviderKey = 'glif' | 'zondax' | 'drpc' | 'ankr'

export interface Provider {
  key: ProviderKey
  label: string
  url: string
}

export const PROVIDERS: Provider[] = [
  { key: 'glif', label: 'Glif', url: 'https://api.node.glif.io/rpc/v1' },
  { key: 'zondax', label: 'Zondax', url: 'https://api.zondax.ch/fil/node/mainnet/rpc/v1' },
  { key: 'drpc', label: 'dRPC', url: 'https://filecoin.drpc.org' },
  { key: 'ankr', label: 'Ankr', url: 'https://rpc.ankr.com/filecoin' },
]

export const PROVIDER_KEYS = PROVIDERS.map((p) => p.key)

// Filfox's pool holds thousands of messages (backlogs of 1,000 per sender), about 5.5 MB per
// snapshot: fetched on demand only, and kept out of the combined view.
export const FILFOX = { label: 'Filfox', url: 'https://filfox.info/rpc/v1' }

// The only public node with StateActorCodeCIDs.
export const ACTOR_CODES_URL = 'https://api.zondax.ch/fil/node/mainnet/rpc/v1'
