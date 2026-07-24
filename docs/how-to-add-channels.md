# How to Add Channels

Add IPTV channels via M3U files, remote URLs, Xtream Codes, or direct stream URLs.

## Via M3U file upload

1. Open Admin → **Sources** → **Upload M3U**
2. Select a local `.m3u` or `.m3u8` file
3. The parser extracts all `#EXTINF` entries: channel name, logo, group, tvg-id
4. Channels are created automatically with source binding

## Via remote M3U URL

1. Admin → **Sources** → **Add Source**
2. Set type to **Remote M3U**
3. Enter the playlist URL
4. Click **Import** — fetches and parses the playlist

Supported attributes: `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`.

## Via direct URL

For a single stream URL (RTMP, RTSP, HLS, etc.):

```bash
curl -X POST http://localhost:3001/api/admin/channels \
  -H "Content-Type: application/json" \
  -u admin:admin123 \
  -d '{
    "name": "My Channel",
    "url": "rtmp://example.com/live/stream",
    "group": "Custom"
  }'
```

The channel is created without a source binding — it uses the direct URL.

## Via Xtream Codes API

1. Admin → **Sources** → **Add Source**
2. Set type to **Xtream Codes**
3. Enter server URL, username, password
4. Import — channels are created from the provider's catalog

## Channel options

Each channel supports these settings (set via API or admin UI):

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Whether the channel is active |
| `group` | — | Grouping label for the viewer UI |
| `backupUrls` | `[]` | Up to 3 backup stream URLs for failover |
| `codec` | — | Preferred codec (h264, h265) |
| `bufferSize` | — | Custom FFmpeg buffer size |
| `idleTimeout` | — | Override global idle stop time |
| `customFfmpegArgs` | — | Extra FFmpeg flags |

## Verify it works

```bash
# List all channels
curl -s http://localhost:3001/api/public/channels | jq '.channels | length'

# Check a specific channel's health
curl -s http://localhost:3001/api/public/channel-health?id=CHANNEL_ID | jq
```

## Troubleshooting

- **"no valid source URL found"** — the channel has no `url` and no source binding. Add one of the above.
- **Import returns 0 channels** — check the M3U file has valid `#EXTINF` lines.
- **Stream won't start** — verify the source URL is reachable: `curl -I <url>`.
