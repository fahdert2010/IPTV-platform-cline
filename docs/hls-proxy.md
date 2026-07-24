# HLS Proxy

How Mubasher Core proxies HLS segments with reference counting.

## Why proxy?

Without a proxy, viewers would fetch segments directly from the `hls/` directory. This has three problems:

1. **URL exposure** — source URLs appear in the player, allowing viewers to bypass the server
2. **Unsafe cleanup** — deleting a segment while a viewer is downloading it corrupts playback
3. **No playlist rewriting** — segment URLs in the playlist point to disk paths, not HTTP URLs

The proxy solves all three.

## How it works

### Playlist rewriting

When FFmpeg writes `playlist.m3u8`, segment URLs look like:

```
#EXTINF:2.000,
segment_0001.ts
#EXTINF:2.000,
segment_0002.ts
```

The proxy rewrites these to:

```
#EXTINF:2.000,
/api/hls/CHANNEL_ID/segments/segment_0001.ts
#EXTINF:2.000,
/api/hls/CHANNEL_ID/segments/segment_0002.ts
```

The viewer never sees the real file path.

### Segment serving with refcount

When a viewer requests a segment:

1. **Lock**: increment the segment's reference counter
2. **Serve**: stream the `.ts` file from disk
3. **Unlock**: decrement the counter when the response finishes

The `hls-manager` tracks refcounts. A segment with `refCount > 0` is never deleted, even during cleanup sweeps.

### Flow

```
Viewer requests /api/hls/:channelId/playlist.m3u8
  → Proxy reads playlist from hls/<channelId>/playlist.m3u8
  → Rewrites segment URLs to /api/hls/:channelId/segments/
  → Returns rewritten playlist with no-cache headers

Viewer requests /api/hls/:channelId/segments/segment_0001.ts
  → Proxy locks segment (refCount++)
  → Streams file from hls/<channelId>/segment_0001.ts
  → On response finish: refCount--
```

### Lazy startup variant

`/api/hls/:channelId/index.m3u8` waits up to 15 seconds for FFmpeg to produce the first playlist. If the stream is starting, it polls every 500ms. This gives the player a single URL that works whether the stream is already running or needs to start.

## Segment lifecycle

```
FFmpeg writes segment
  → hls-manager records in segment journal
  → refCount = 0

Viewer requests segment
  → refCount++
  → Segment is "locked"

Viewer finishes download
  → refCount--

Cleanup sweep (periodic)
  → refCount == 0? → eligible for deletion
  → refCount > 0  → skip (still in use)

Deletion
  → Remove from disk
  → Remove from journal
  → Update playlist (remove entry)
```

## Debugging

```bash
# All channels' HLS state
curl -s http://localhost:3001/api/hls/debug | jq

# Single channel
curl -s "http://localhost:3001/api/hls/debug/CHANNEL_ID" | jq
```

Shows: segments on disk, playlist age, refcounts, misses, deletes.

## Edge cases

- **Concurrent viewers**: multiple viewers downloading the same segment — refcount handles it correctly, segment is served from disk (not buffered per viewer)
- **Rapid channel switching**: viewer switches channels quickly — old segment unlock happens async, new lock happens immediately
- **FFmpeg crash mid-segment**: incomplete `.ts` file on disk — playlist validator catches this and removes the entry
- **Disk full**: cleanup runs but can't delete fast enough — segments accumulate, proxy continues serving existing ones
