# Getting Started

This tutorial takes you from zero to watching your first IPTV stream through Mubasher Core.

## What you'll build

A local HLS restream cache that:
- Fetches streams from IPTV sources (M3U playlists, URLs)
- Caches HLS segments on disk so one FFmpeg process serves all viewers
- Provides a browser-based player and admin dashboard

## Prerequisites

- **Node.js >= 18** — [nodejs.org](https://nodejs.org)
- **FFmpeg** — the project bundles `ffmpeg.exe` (Windows); on Linux/macOS install via your package manager
- An IPTV source (M3U/M3U8 playlist URL or local file)

## Step 1: Install dependencies

```bash
npm install
```

Only 3 runtime packages: `express`, `multer`, `uuid`.

## Step 2: Start the server

```bash
npm start
```

You'll see:

```
═══════════════════════════════════════
  Mubasher Core v2.0.0
  Professional IPTV Restream Cache
═══════════════════════════════════════
Port: 3001
Server listening on http://0.0.0.0:3001
```

Open these in your browser:
- **Viewer**: http://localhost:3001/viewer
- **Admin**: http://localhost:3001/admin (login: `admin` / `admin123`)

## Step 3: Add a source

1. Open the Admin dashboard at `/admin`
2. Go to **Sources** and click **Add Source**
3. Paste an M3U playlist URL (or upload a local `.m3u` file)
4. Click **Import** — channels are parsed and added automatically

## Step 4: Watch a stream

1. Go to the **Viewer** page
2. Pick a channel from the list
3. Click play — the player uses HLS.js to buffer from the local cache

The first viewer to request a channel triggers FFmpeg to start. All subsequent viewers share that same process.

## Step 5: Customize (optional)

Copy the default config and tweak it:

```bash
cp config/default.json config/user.json
```

Edit `config/user.json` — it deep-merges with defaults. See [Configuration Reference](configuration.md) for all options.

## What's next

- [Add more channels](how-to-add-channels.md) — M3U files, Xtream Codes, direct URLs
- [Monitor your streams](how-to-monitor-streams.md) — dashboard, health, viewer stats
- [Architecture overview](architecture.md) — how the pieces fit together
