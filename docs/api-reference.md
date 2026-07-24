# API Reference

All endpoints on `http://localhost:3001` (configurable via `server.port`).

## Public API (`/api/public`)

No authentication required. Used by the viewer frontend.

### GET /api/public/settings

Returns platform settings: site name, player config, feature flags.

### GET /api/public/channels

List all enabled channels with resolved URLs, state, and health.

**Query params**: none

**Response**:
```json
{
  "channels": [
    {
      "id": "uuid",
      "name": "Channel Name",
      "group": "Sports",
      "url": "http://localhost:3001/api/hls/uuid/index.m3u8",
      "logo": "https://...",
      "state": "online",
      "health": { "score": 85, "latency": 120 }
    }
  ]
}
```

### GET /api/public/channel/:id

Single channel details.

### GET /api/public/channel-health

Health data for a channel.

**Query params**: `id` (channel UUID)

### POST /api/public/heartbeat

Viewer heartbeat — keep-alive from the player.

**Body**:
```json
{
  "channelId": "uuid",
  "clientId": "browser-uuid",
  "stats": { "bufferLength": 4.2, "droppedFrames": 0 }
}
```

### POST /api/public/stream-action/:channelId/start

Start a stream (lazy startup — first viewer triggers FFmpeg).

### POST /api/public/stream-action/:channelId/stop

Stop a viewer's stream reference.

### GET /api/public/viewers

Viewer count. Query param `channelId` for per-channel count.

---

## HLS Proxy (`/api/hls`)

Proxies HLS playlists and segments with reference counting.

### GET /api/hls/:channelId/playlist.m3u8

Returns the HLS playlist with rewritten segment URLs pointing through the proxy. No-cache headers.

### GET /api/hls/:channelId/segments/:segment

Returns an `.ts` segment file. Locks the segment via reference counter (prevents deletion while viewers are downloading). 30-second cache headers.

### GET /api/hls/:channelId/index.m3u8

Lazy startup variant — waits up to 15 seconds for FFmpeg to produce the first playlist, then proxies it.

### GET /api/hls/debug

Debug info for all channels: segment counts, playlist ages, lock states.

### GET /api/hls/debug/:channelId

Debug info for a single channel.

---

## Admin API (`/api/admin`)

Requires HTTP Basic Auth. Default credentials: `admin` / `admin123`.

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Full system snapshot |
| GET | `/api/admin/events` | SSE real-time event stream |

### Channels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/channels` | List all channels |
| POST | `/api/admin/channels` | Create channel |
| GET | `/api/admin/channels/:id` | Get channel |
| PUT | `/api/admin/channels/:id` | Update channel |
| DELETE | `/api/admin/channels/:id` | Delete channel |
| POST | `/api/admin/channels/:id/enable` | Enable channel |
| POST | `/api/admin/channels/:id/disable` | Disable channel |
| POST | `/api/admin/channels/:id/test` | Test channel stream |
| POST | `/api/admin/channels/bulk/enable` | Bulk enable |
| POST | `/api/admin/channels/bulk/disable` | Bulk disable |
| POST | `/api/admin/channels/bulk/delete` | Bulk delete |
| POST | `/api/admin/channels/bulk/test` | Bulk test |

**Create/Update body**:
```json
{
  "name": "Channel Name",
  "url": "rtmp://...",
  "group": "Sports",
  "enabled": true,
  "backupUrls": ["rtmp://backup1", "rtmp://backup2"],
  "codec": "h264",
  "bufferSize": 1024,
  "idleTimeout": 60,
  "customFfmpegArgs": "-preset veryfast"
}
```

### Sources

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/sources` | List all sources |
| POST | `/api/admin/sources` | Create source |
| GET | `/api/admin/sources/:id` | Get source |
| PUT | `/api/admin/sources/:id` | Update source |
| DELETE | `/api/admin/sources/:id` | Delete source |
| POST | `/api/admin/sources/:id/enable` | Enable source |
| POST | `/api/admin/sources/:id/disable` | Disable source |
| POST | `/api/admin/sources/:id/import` | Import channels from source |
| POST | `/api/admin/sources/:id/resync` | Re-sync source |
| POST | `/api/admin/sources/import-all` | Import all enabled sources |
| POST | `/api/admin/sources/import-file` | Upload M3U file |
| POST | `/api/admin/sources/upload` | M3U file upload (multipart) |

### Streams

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/streams` | All stream states |
| GET | `/api/admin/streams/:channelId` | Stream state for channel |
| POST | `/api/admin/streams/:channelId` | Start stream |
| DELETE | `/api/admin/streams/:channelId` | Stop stream |
| POST | `/api/admin/streams/:channelId/restart` | Restart stream |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/health` | Health summary |
| GET | `/api/admin/health/:channelId` | Channel health |
| POST | `/api/admin/health/test` | Probe a stream URL |

### Viewers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/viewers` | All viewers |
| POST | `/api/admin/viewers/:viewerId/kick` | Disconnect viewer |

### Cache

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/cache` | Cache metrics |
| POST | `/api/admin/cache/clear` | Clear cache |

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/config` | Get config |
| PUT | `/api/admin/config` | Update config (dot-notation) |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/system/restart-streams` | Restart all streams |
| POST | `/api/admin/system/gc` | Force garbage collection |

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/logs` | Recent log entries |
| DELETE | `/api/admin/logs` | Clear log buffer |

### Backup & Restore

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/backup` | Backup all collections |
| POST | `/api/admin/restore/:collection` | Restore a collection |

---

## System Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Server version, uptime |
| GET | `/api/health` | Health summary + system stats |
| GET | `/api/proxy/:sourceId/*` | Proxy a source URL |
| POST | `/api/proxy/stream` | Proxy a direct URL |
