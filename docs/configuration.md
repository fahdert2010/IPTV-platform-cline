# Configuration

All options with defaults. Override in `config/user.json` (deep-merges with `config/default.json`).

## server

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | `"0.0.0.0"` | Bind address |
| `port` | number | `3001` | HTTP port |
| `maxPayloadSize` | string | `"50mb"` | Max request body size |

## ffmpeg

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | string | `"ffmpeg"` | FFmpeg binary path |
| `ffprobePath` | string | `"ffprobe"` | FFprobe binary path |
| `hlsTime` | number | `2` | HLS segment duration (seconds) |
| `hlsListSize` | number | `10` | Number of segments in playlist |
| `hlsDeleteThreshold` | number | `4` | Segments before deletion |
| `gopSeconds` | number | `2` | GOP size (keyframe interval) |
| `threads` | number | `2` | FFmpeg thread count |
| `userAgent` | string | `"Mozilla/5.0 ..."` | User-Agent for source requests |
| `reconnectDelayMs` | number | `3000` | Delay between reconnect attempts |
| `maxReconnectAttempts` | number | `10` | Max reconnect retries before failover |
| `dnsRefreshMs` | number | `60000` | DNS cache refresh interval |

## stream

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hlsRoot` | string | `"hls"` | HLS output directory |
| `idleStopSeconds` | number | `30` | Stop FFmpeg after N seconds with no viewers |
| `maxRestarts` | number | `20` | Max restarts before marking failed |
| `restartBackoffMs` | number | `5000` | Base backoff for restart delays |
| `startupQueueDelayMs` | number | `2000` | Delay between queued stream starts |
| `startupConcurrency` | number | `1` | Max simultaneous stream startups |
| `autoRestartCrashed` | boolean | `true` | Auto-restart FFmpeg on crash |
| `sourceFailStopSeconds` | number | `180` | Cooldown after source failure |
| `blockedStopSeconds` | number | `300` | Cooldown after blocked source |
| `startupBufferSeconds` | number | `4` | Buffer before serving to viewers |
| `lowLatencyMode` | boolean | `false` | HLS low-latency tuning |
| `preloadSegments` | number | `3` | Segments to preload |
| `readAhead` | number | `2` | Read-ahead segments |
| `writeAhead` | number | `2` | Write-ahead segments |
| `concurrentReaders` | number | `10` | Max concurrent segment readers |
| `concurrentWriters` | number | `2` | Max concurrent segment writers |

## cache

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDiskUsageMb` | number | `10240` | Max disk cache per channel (MB) |
| `autoCleanupIntervalMinutes` | number | `15` | Cleanup sweep interval |
| `deleteOldSegmentsAfterMinutes` | number | `5` | Segment age before deletion |
| `maxSegmentsPerChannel` | number | `50` | Max segments per channel |
| `ramBufferSizeMb` | number | `256` | RAM cache size (MB) |
| `diskCacheSizeMb` | number | `5120` | Total disk cache (MB) |
| `retentionTimeMinutes` | number | `10` | Cache retention window |
| `bufferSeconds` | number | `6` | Playback buffer |
| `maxCachedSegments` | number | `100` | Max cached segments |

## heartbeat

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `intervalMs` | number | `10000` | Heartbeat check interval |
| `viewerTimeoutSeconds` | number | `30` | Viewer considered dead after N seconds |

## log

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | string | `"info"` | Log level: error, warn, info, debug |
| `maxFiles` | number | `20` | Max log files before rotation |
| `maxSizeMb` | number | `10` | Max log file size (MB) |
| `console` | boolean | `true` | Log to console |
| `file` | boolean | `true` | Log to file |
| `memory` | boolean | `true` | Log to memory ring buffer |
| `memoryLines` | number | `5000` | Memory buffer size |

## admin

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `username` | string | `"admin"` | Admin username |
| `password` | string | `"admin123"` | Admin password |
| `sessionTimeoutMinutes` | number | `60` | Session timeout |
| `allowCopyUrl` | boolean | `true` | Allow copying stream URL |
| `allowExternalPlayers` | boolean | `true` | Allow external player links |
| `allowVlc` | boolean | `true` | Allow VLC link |
| `allowDownload` | boolean | `false` | Allow stream download |
| `allowScreenshot` | boolean | `false` | Allow screenshots |
| `allowPiP` | boolean | `true` | Allow picture-in-picture |
| `allowFullscreen` | boolean | `true` | Allow fullscreen |
| `allowDevTools` | boolean | `false` | Allow dev tools in player |
| `allowCast` | boolean | `true` | Allow Chromecast |

## sources

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `importConcurrency` | number | `3` | Concurrent source imports |
| `timeoutMs` | number | `30000` | Source fetch timeout |
| `maxChannelsPerSource` | number | `10000` | Max channels per source |

## health

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `checkIntervalMinutes` | number | `1` | Health check interval |
| `timeoutMs` | number | `15000` | Probe timeout |
| `concurrentChecks` | number | `5` | Max concurrent probes |
| `latencyThresholdMs` | number | `500` | Latency warning threshold |
| `packetLossThreshold` | number | `5` | Packet loss warning (%) |
| `segmentDelayThresholdMs` | number | `3000` | Segment delay warning |
| `bitrateStabilityThreshold` | number | `20` | Bitrate variance warning (%) |

## viewer

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxViewersPerChannel` | number | `10000` | Max concurrent viewers |
| `bandwidthSampleIntervalMs` | number | `5000` | Bandwidth measurement interval |
| `geoIpEnabled` | boolean | `false` | Enable GeoIP lookups |

## stats

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `historyMinutes` | number | `60` | Stats retention window |
| `sampleIntervalMs` | number | `10000` | Stats sampling interval |

## Updating at runtime

```bash
# Set a single value
curl -X PUT http://localhost:3001/api/admin/config \
  -H "Content-Type: application/json" \
  -u admin:admin123 \
  -d '{"path": "stream.idleStopSeconds", "value": 60}'
```

Changes persist to `config/user.json` and take effect immediately.
