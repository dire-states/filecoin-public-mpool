# filecoin-public-mpool

What's waiting in the Filecoin mainnet mempool right now, and how it gets on-chain. The page polls
public RPC nodes while it is open: there's no server and no stored history, so it shows only what
happened since the tab was opened.

Live at https://dire-states.github.io/filecoin-public-mpool/

## Views

- **Pending**: messages waiting now, with age, sender, nonce, `actor.Method`, value, fee cap, premium,
  gas limit and which providers' latest snapshots list them. Senders with 10 or more pending show as one
  row. `≥` marks messages that were already pending when the page opened, so their age is a lower bound.
- **Mempool size and fees**: pending count (all providers combined, and each provider's own snapshot),
  base fee and premium percentiles of pending messages, every 5 s.
- **Inclusion**: the share of on-chain messages a polled mempool listed before their tipset, and the
  wait from first seen to the including epoch, per method and per premium band.
- **Backlogs**: senders with 5 or more pending, and a Filfox snapshot on request.
- **Message**: the message selected in Pending, Recently included or Backlogs (Esc closes it): status,
  CID, addresses, method, gas, when it was seen and which providers list it, and the whole message as
  JSON with a copy button. `ParamsDecoded` is the base64 CBOR `Params` decoded by `src/lib/cbor.ts`:
  byte strings as `0x` hex (for EVM calls, the calldata), CIDs as their raw bytes.
- **Providers**: snapshot size, messages only one provider lists, latency and errors per provider, along
  the bottom of the Message pane.

## Sources

| Provider | Endpoint |
|---|---|
| Glif | `https://api.node.glif.io/rpc/v1` |
| Zondax | `https://api.zondax.ch/fil/node/mainnet/rpc/v1` |
| dRPC | `https://filecoin.drpc.org` |
| Ankr | `https://rpc.ankr.com/filecoin` |
| Filfox | `https://filfox.info/rpc/v1` (on request only) |

All serve `Filecoin.MpoolPending` without a key and allow browser requests (tested 2026-11-18). None
serves `MpoolSub`, so the page polls: one `MpoolPending` every 5 s, rotating through the four providers,
plus `ChainHead` from the next one. Each provider's mempool differs, and Glif load-balances across
several nodes, so the combined pending set is the union of each provider's latest snapshot.

- Polling stops while the tab is hidden or paused.
- A failing provider is backed off (up to 5 min) and drops out of the pending set after 60 s.
- Tipsets are read one epoch below the head (`ChainGetTipSetByHeight`, `ChainGetBlockMessages`); a
  message is identified by sender and nonce, so a replacement with a higher premium counts as the same.
- Filfox's pool holds thousands of messages, mostly backlogs of 1,000 per sender (~5.5 MB per
  snapshot), so it stays out of the combined view.
- A tab uses about 20 KB/s, mostly Glif's uncompressed responses.
- Actor types come from `src/lib/actorCodes.ts` (code CIDs for network versions 16–29). Newer versions
  are loaded from Zondax, the only public node with `StateActorCodeCIDs`. Method names come from
  `src/lib/methods.ts`, shared with [filecoin-message-mix](https://github.com/dire-states/filecoin-message-mix).

## Develop

```sh
npm install
npm run dev
```

## Deploy

GitHub Pages, from `.github/workflows/pages.yml` on every push to `main` (Pages source: GitHub Actions).

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `BASE_PATH` | build | `/` (Pages build: `/filecoin-public-mpool/`) |
