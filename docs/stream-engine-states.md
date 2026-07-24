# Stream Engine States

The FFmpeg process lifecycle in Mubasher Core.

## State machine

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    v                                             │
  STOPPED ──► STARTING ──► PROBING ──► BUFFERING ──► ONLINE      │
                    │                        │          │         │
                    │                        │          │         │
                    │                        │          ▼         │
                    │                        │        IDLE        │
                    │                        │          │         │
                    │                        ▼          │         │
                    │                      ERROR        │         │
                    │                        │          │         │
                    │                        ▼          │         │
                    │                    STOPPING ◄─────┘         │
                    │                        │                    │
                    │                        v                    │
                    │                    STOPPED ◄────────────────┘
                    │
                    └──► RECONNECTING ──► (back to STARTING)
```

## States

| State | FFmpeg | What's happening |
|-------|--------|------------------|
| `STOPPED` | not running | No viewers, process not started |
| `STARTING` | spawning | FFmpeg launched, waiting for initial output |
| `PROBING` | running | Running ffprobe to verify stream metadata |
| `BUFFERING` | running | Waiting for enough segments before serving |
| `ONLINE` | running | Stream is healthy, viewers can connect |
| `IDLE` | running | No viewers, waiting for idle timeout to stop |
| `STOPPING` | shutting down | Graceful shutdown in progress |
| `RECONNECTING` | restarting | Lost source connection, attempting reconnect |
| `ERROR` | not running | Failed after max retries, manual restart needed |

## Transitions

### Lazy startup (STOPPED → ONLINE)

First viewer requests a channel:

1. `STOPPED` → `STARTING`: FFmpeg spawned with source URL and HLS output
2. `STARTING` → `PROBING`: FFmpeg producing output, verify with ffprobe
3. `PROBING` → `BUFFERING`: Stream metadata valid, waiting for segments
4. `BUFFERING` → `ONLINE`: Enough segments buffered, playlist ready

Time to first frame: typically 2-5 seconds depending on `startupBufferSeconds`.

### Idle stop (ONLINE → STOPPED)

1. Last viewer disconnects
2. `ONLINE` → `IDLE`: idle timer starts
3. After `idleStopSeconds` (default 30s): `IDLE` → `STOPPING`
4. FFmpeg killed, cleanup runs
5. `STOPPING` → `STOPPED`

### Failover (ONLINE → RECONNECTING → ONLINE)

Source connection lost:

1. `ONLINE` → `RECONNECTING`: primary source failed
2. Try backup URL 1, then 2, then 3
3. Each attempt: exponential backoff with jitter
4. If backup found → `RECONNECTING` → `STARTING` (new FFmpeg)
5. If all backups fail → `RECONNECTING` → `ERROR`

### Error recovery

`ERROR` state requires manual intervention:
- Restart via admin UI: `POST /api/admin/streams/:channelId/restart`
- Or restart all: `POST /api/admin/system/restart-streams`

`autoRestartCrashed` (default true) automatically restarts if FFmpeg exits unexpectedly.

## Key parameters

| Parameter | Default | Affects |
|-----------|---------|---------|
| `idleStopSeconds` | 30 | How long to keep FFmpeg running after last viewer |
| `startupBufferSeconds` | 4 | How many seconds of segments before serving |
| `maxReconnectAttempts` | 10 | How many reconnect tries before failover |
| `reconnectDelayMs` | 3000 | Base delay between reconnects (exponential backoff) |
| `maxRestarts` | 20 | Max restarts before marking channel as failed |
| `autoRestartCrashed` | true | Auto-restart on unexpected FFmpeg exit |

## Monitoring

```bash
# All stream states
curl -s http://localhost:3001/api/admin/streams | jq

# Single channel
curl -s "http://localhost:3001/api/admin/streams/CHANNEL_ID" | jq
```

State transitions are logged and emitted as events via RuntimeRegistry (`stream:state` event).
