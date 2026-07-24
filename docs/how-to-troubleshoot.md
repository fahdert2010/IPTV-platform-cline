# How to Troubleshoot

Common issues and their fixes.

## Stream won't start

**Symptom**: Player shows buffering, stream never plays.

**Check**:
```bash
# Is FFmpeg available?
ffmpeg -version

# Is the channel enabled?
curl -s http://localhost:3001/api/public/channels | jq '.channels[] | select(.name | contains("Channel Name"))'

# Check stream state
curl -s "http://localhost:3001/api/admin/streams/CHANNEL_ID" | jq
```

**Fixes**:
- FFmpeg not found → set `ffmpeg.path` in `config/user.json`
- Channel disabled → enable via admin UI or `POST /api/admin/channels/:id/enable`
- Source URL unreachable → test with `curl -I <source_url>`
- Source binding missing → [add a source](how-to-add-channels.md)

## "no valid source URL found"

**Cause**: Channel exists but has no `url` and no source binding.

**Fix**: Either set a direct URL or import from a source that binds to the channel.

## High latency / buffering

**Symptom**: Viewers experience frequent buffering.

**Check**:
```bash
curl -s "http://localhost:3001/api/admin/health?channelId=CHANNEL_ID" | jq '.latency'
```

**Fixes**:
- Increase `stream.startupBufferSeconds` (default 4s) for slower connections
- Reduce `ffmpeg.hlsListSize` (default 10) for lower latency
- Enable `stream.lowLatencyMode` for HLS low-latency tuning
- Check network between server and source

## Browser auth popup (WWW-Authenticate)

**Symptom**: Browser shows a login dialog when accessing viewer pages.

**Cause**: The server returns `401` with `WWW-Authenticate` header, triggering native browser auth.

**Fix**: This is a known issue — the admin auth middleware leaks into public routes. Check if your version has the fix in `src/api/index.js`.

## Channel list is empty

**Check**:
```bash
# Are sources loaded?
curl -s http://localhost:3001/api/admin/sources | jq '.length'

# Are channels loaded?
curl -s http://localhost:3001/api/public/channels | jq '.channels | length'
```

**Fix**: Import channels from a source or add them manually. Data persists in `data/channels.json`.

## Server won't start

**Symptom**: `npm start` crashes immediately.

**Check**:
- Port already in use → change `server.port` in config
- Node.js version < 18 → upgrade
- Missing `ffmpeg.exe` → install FFmpeg or set `ffmpeg.path`

## Disk filling up

HLS segments accumulate in the `hls/` directory.

**Fix**:
```bash
# Check usage
du -sh hls/

# Manual cleanup
rm -rf hls/*

# Or configure auto-cleanup
# cache.deleteOldSegmentsAfterMinutes: 5 (default)
# cache.maxDiskUsageMb: 10240 (default)
```

## Logs too verbose

Set log level in config:

```json
{
  "log": {
    "level": "warn"
  }
}
```

Levels: `error`, `warn`, `info`, `debug`.

## Performance tuning

For high channel counts (>50):

1. Increase `stream.startupConcurrency` (default 1)
2. Increase `health.concurrentChecks` (default 5)
3. Set `cache.ramBufferSizeMb` based on available RAM
4. Set `stream.concurrentReaders` and `stream.concurrentWriters` for I/O parallelism
