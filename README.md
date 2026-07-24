# Mubasher Core — Local IPTV Restream Cache Server

## 📋 Description / الوصف

**English:**  
Mubasher Core is a high-performance Local IPTV Restream Cache Server built with Node.js and Express. It acts as a middleware between IPTV sources and viewers: one FFmpeg process per channel serves all viewers from a local HLS cache, eliminating redundant transcoding and reducing bandwidth.

**العربية:**  
Mubasher Core هو خادم إعادة بث مع تخزين مؤقت (Cache) لأنظمة IPTV. يعمل كوسيط بين مصادر IPTV والمشاهدين: عملية FFmpeg واحدة لكل قناة تخدم جميع المشاهدين من كاش HLS محلي، مما يلغي الترميز المتكرر ويقلل استهلاك النطاق.

---

## 🏗️ Architecture / الهيكل المعماري

```
mubasher-core/
├── src/
│   ├── index.js          # Entry point
│   ├── config/           # Configuration loader (JSON)
│   ├── logger/           # Logger (console + file + memory)
│   ├── storage/          # JSON database (CRUD + backup + restore)
│   ├── api/              # Express REST API (public + admin)
│   ├── ffmpeg/           # FFmpeg process manager
│   ├── heartbeat/        # Viewer heartbeat tracker
│   ├── sources/          # M3U/M3U8 playlist parser & importer
│   ├── channels/         # Channel management with backup URLs
│   ├── health/           # Stream probing via ffprobe
│   ├── player/           # Browser HLS.js player manager
│   ├── utils/            # Utility functions
│   ├── viewer/           # Viewer web interface
│   └── admin/            # Admin web interface
├── config/
│   ├── default.json      # Default configuration
│   └── user.json         # User overrides (auto-generated)
├── public/
│   ├── admin/            # Admin static assets
│   └── viewer/           # Viewer static assets
├── data/                 # JSON database files
├── logs/                 # Log files
└── hls/                  # HLS cache output
```

---

## 📦 Modules / الوحدات

| Module | Status | Description |
|--------|--------|-------------|
| **Config** | ✅ Complete | Load/save JSON config with deep merge, dot-notation access |
| **Logger** | ✅ Complete | Console + file + memory logging with levels and colors |
| **Storage** | ✅ Complete | JSON file DB with atomic writes, backup, restore |
| **API** | 🏗️ Structure | Express routes defined, handlers pending |
| **FFmpeg** | 🏗️ Structure | Process manager class defined, implementation pending |
| **Heartbeat** | 🏗️ Structure | Viewer tracker class defined, implementation pending |
| **Sources** | 🏗️ Structure | M3U parser and importer class defined, implementation pending |
| **Channels** | 🏗️ Structure | Channel CRUD and group management class defined, implementation pending |
| **Health** | 🏗️ Structure | ffprobe stream tester class defined, implementation pending |
| **Player** | 🏗️ Structure | HLS.js browser manager defined, implementation pending |
| **Viewer** | 🏗️ Structure | HTML/CSS scaffold, JS pending |
| **Admin** | 🏗️ Structure | HTML scaffold, JS/CSS pending |
| **Utils** | ✅ Complete | uid, sleep, escapeHtml, formatBytes, isValidUrl, etc. |

---

## 🔌 API Routes / مسارات API

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | System health check |
| GET | `/api/public/settings` | Public viewer settings |
| GET | `/api/public/channels` | Enabled channels list |
| GET | `/api/public/channel-health?id=` | Channel stream health |
| POST | `/api/public/heartbeat` | Viewer heartbeat |
| GET | `/api/public/stream/:id.m3u8` | HLS playlist |
| GET | `/api/public/stream/:id/:segment` | HLS segment |

### Admin (Basic Auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/dashboard` | System statistics |
| GET/POST/PUT/DELETE | `/api/admin/channels` | Channel CRUD |
| GET/POST/PUT/DELETE | `/api/admin/sources` | Source CRUD |
| POST | `/api/admin/sources/:id/import` | Import channels from source |
| POST | `/api/admin/sources/import-all` | Import all enabled sources |
| GET | `/api/admin/streams` | Active stream statuses |
| POST | `/api/admin/streams/:id/stop` | Stop a stream |
| POST | `/api/admin/health/test` | Test a stream URL |
| GET/PUT | `/api/admin/config` | Configuration management |
| GET/DELETE | `/api/admin/logs` | Log management |
| POST | `/api/admin/backup` | Backup all collections |
| POST | `/api/admin/restore/:collection` | Restore a collection |

---

## 🚀 Getting Started / كيفية التشغيل

### Prerequisites / المتطلبات
- Node.js >= 18
- FFmpeg + FFprobe installed and in PATH

### Installation / التثبيت
```bash
npm install
```

### Run / التشغيل
```bash
npm start
# or
node src/index.js
```

Server starts at `http://localhost:3001`

### Configuration / الإعدادات
Edit `config/default.json` or create `config/user.json` with overrides.

---

## ⚙️ Configuration / الإعدادات

All settings are in `config/default.json`. Key sections:

| Section | Key Settings |
|---------|-------------|
| `server` | port, host, maxPayloadSize |
| `ffmpeg` | path, ffprobePath, hlsTime, hlsListSize, threads |
| `stream` | hlsRoot, idleStopSeconds, maxRestarts, autoRestartCrashed |
| `cache` | maxDiskUsageMb, autoCleanupIntervalMinutes, maxSegmentsPerChannel |
| `heartbeat` | intervalMs, viewerTimeoutSeconds |
| `log` | level (debug/info/warn/error), console, file, memory |
| `admin` | username, password, sessionTimeoutMinutes |
| `sources` | importConcurrency, timeoutMs, maxChannelsPerSource |
| `health` | checkIntervalMinutes, timeoutMs, concurrentChecks |

---

## 🧱 Core Concept / المفهوم الأساسي

```
Viewer 1 ──┐
Viewer 2 ──┤
Viewer 3 ──┤──> One FFmpeg Process ──> HLS Cache ──> All viewers served
Viewer N ──┘
```

- **One FFmpeg per channel** regardless of viewer count
- **-c copy** to avoid re-encoding (CPU efficient)
- **Idle timeout** stops FFmpeg when no viewers
- **Auto-restart** on crash with exponential backoff
- **Backup URLs** for channel failover

---

## 📚 Documentation

| Type | File | Description |
|------|------|-------------|
| Tutorial | [Getting Started](docs/getting-started.md) | Install to first stream |
| How-to | [Add Channels](docs/how-to-add-channels.md) | Import from M3U, URLs, Xtream Codes |
| How-to | [Monitor Streams](docs/how-to-monitor-streams.md) | Dashboard, health, viewer stats |
| How-to | [Troubleshoot](docs/how-to-troubleshoot.md) | Common issues and fixes |
| Reference | [API Reference](docs/api-reference.md) | Complete endpoint listing |
| Reference | [Configuration](docs/configuration.md) | All config options with defaults |
| Explanation | [Architecture](docs/architecture.md) | How the system fits together |
| Explanation | [HLS Proxy](docs/hls-proxy.md) | Segment proxying and reference counting |
| Explanation | [Stream Engine States](docs/stream-engine-states.md) | FFmpeg state machine lifecycle |

---

## 📄 License / الترخيص

MIT