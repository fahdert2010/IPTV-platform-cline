# Architecture

How Mubasher Core fits together.

## The problem

A typical IPTV deployment runs one FFmpeg process per viewer. 100 viewers on one channel = 100 FFmpeg processes, each decoding the same stream. This wastes CPU, memory, and bandwidth.

## The solution: one FFmpeg, many viewers

Mubasher Core runs exactly one FFmpeg process per channel. That process writes HLS segments to disk. All viewers read from the same cached segments via an HLS proxy layer. The proxy uses reference counting to prevent deleting segments while viewers are downloading them.

```
  Source (IPTV provider)
        |
        v
  ┌─────────────┐
  │ FFmpeg (x1) │  One process per channel
  └──────┬──────┘
         │ writes .ts segments
         v
  ┌─────────────┐
  │ HLS Cache   │  hls/<channelId>/playlist.m3u8
  │ (disk)      │  hls/<channelId>/segment_001.ts
  └──────┬──────┘
         │ proxy + refCount
         v
  ┌─────────────┐
  │ Node.js     │  Express HLS proxy layer
  │ Proxy       │  Rewrites segment URLs
  └──────┬──────┘
         │
    ┌────┴────┐
    v    v    v
  Viewer Viewer Viewer
```

## Module map

```
src/
├── index.js              Entry point — wires everything together
├── runtime.js            RuntimeRegistry — singleton, single source of truth
├── config/               Config loader (deep merge default + user)
├── logger/               Console + file + memory logger
├── storage/              JSON file DB with backup/restore
├── stream-engine/        FFmpeg process manager + state machine
├── hls-manager/          Segment lifecycle + reference counting
├── channels/             Channel metadata CRUD
├── sources/              Source management + M3U parser
├── viewer-manager/       Viewer sessions + device detection
├── health/               Stream health scoring
├── heartbeat/            Viewer timeout detection
├── cache/                Multi-tier cache (RAM + disk)
├── api/                  Express app + admin + public routes
├── utils/                uid, sleep, escapeHtml, formatBytes
├── viewer/               Browser player frontend
└── admin/                Admin dashboard frontend
```

## Data flow

1. **Startup**: `config` loads, `sources` and `channels` load from JSON into `RuntimeRegistry`
2. **Viewer requests channel**: public API starts stream via `stream-engine`, which spawns FFmpeg
3. **FFmpeg writes segments**: `hls-manager` tracks them, validates playlists, handles cleanup
4. **Viewer fetches playlist**: HLS proxy rewrites segment URLs to go through `/api/hls/:channelId/segments/`
5. **Viewer fetches segment**: proxy locks via refcount, serves from disk, unlocks on complete
6. **Viewer disconnects**: heartbeat detects timeout, viewer removed, refcount drops
7. **No viewers left**: idle timeout fires, FFmpeg stops

## Key design decisions

### RuntimeRegistry as single source of truth

Every module reads/writes through `RuntimeRegistry`. No module owns its own data store. This makes the system observable — one object holds all state — but creates a single bottleneck. The registry is an EventEmitter, so modules communicate via events rather than direct calls.

### Lazy startup

FFmpeg doesn't start until the first viewer requests a channel. This saves resources for channels that nobody is watching. The trade-off: first viewer sees a delay while FFmpeg starts and buffers.

### HLS proxy layer

All segment requests go through Node.js. This:
- Protects source URLs from being exposed to viewers
- Enables reference counting (safe segment deletion)
- Allows playlist rewriting (segment URLs point to the proxy)

The cost: every segment passes through Node.js memory. For high viewer counts, this is I/O-bound, not CPU-bound.

### JSON file storage

No database. Channels, sources, and config live as JSON files on disk. This keeps deployment simple (no Postgres, no Redis) but limits write performance. The storage layer includes backup/restore and handles Windows file locking.

### Event-driven communication

Modules emit events through RuntimeRegistry (`channel:state`, `viewer:connected`, `stream:state`). This decouples modules but makes the flow harder to trace — you have to find all listeners to understand what happens when an event fires.

## Trade-offs

| Choice | Benefit | Cost |
|--------|---------|------|
| One FFmpeg per channel | 10x fewer processes | All viewers share quality |
| JSON file storage | Zero dependencies | Limited write throughput |
| HLS proxy layer | Safe cleanup, URL protection | Memory per segment |
| Lazy startup | Save resources | First-viewer delay |
| Event-driven | Loose coupling | Hard to trace flow |
