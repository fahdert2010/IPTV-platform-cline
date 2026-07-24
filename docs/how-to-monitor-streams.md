# How to Monitor Streams

Use the admin dashboard, API endpoints, and health checks to watch your streams.

## Admin Dashboard

Open http://localhost:3001/admin and log in. The dashboard shows:

- **Active streams** — channels currently being transcoded
- **Viewer count** — connected viewers per channel
- **System stats** — CPU, memory, uptime
- **Health scores** — per-channel quality metrics
- **Recent logs** — real-time log feed

The dashboard updates via Server-Sent Events (SSE) at `/api/admin/events`.

## Health checks

Each channel gets a health score based on:

| Metric | Threshold | Weight |
|--------|-----------|--------|
| Latency | > 500ms = warning | High |
| Packet loss | > 5% = critical | High |
| Segment delay | > 3000ms = warning | Medium |
| Bitrate stability | > 20% variance = warning | Low |

Health is probed every 60 seconds (configurable via `health.checkIntervalMinutes`).

### Check health via API

```bash
# All channels
curl -s http://localhost:3001/api/admin/health | jq

# Single channel
curl -s "http://localhost:3001/api/admin/health?channelId=CHANNEL_ID" | jq

# Manual probe
curl -X POST "http://localhost:3001/api/admin/health/test?channelId=CHANNEL_ID" | jq
```

## Viewer statistics

```bash
# Total viewers
curl -s http://localhost:3001/api/admin/viewers | jq

# Per-channel breakdown
curl -s "http://localhost:3001/api/public/viewers?channelId=CHANNEL_ID" | jq
```

Viewer data includes device type, browser, OS, and bandwidth stats.

## Stream status

```bash
# All stream states
curl -s http://localhost:3001/api/admin/streams | jq

# Single channel
curl -s "http://localhost:3001/api/admin/streams/CHANNEL_ID" | jq
```

States: `stopped`, `starting`, `probing`, `buffering`, `online`, `idle`, `stopping`, `error`.

## Cache metrics

```bash
curl -s http://localhost:3001/api/admin/cache | jq
```

Shows RAM cache hit rate, disk cache usage, segments per channel.

## Logs

```bash
# Recent logs (from memory buffer)
curl -s http://localhost:3001/api/admin/logs | jq

# Log files are written to logs/mubasher-YYYY-MM-DD.log
```

## SSE real-time feed

Connect to `/api/admin/events` for live updates:

```javascript
const es = new EventSource('/api/admin/events');
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // event.type: 'channel:state', 'viewer:connected', 'stream:state', etc.
};
```
