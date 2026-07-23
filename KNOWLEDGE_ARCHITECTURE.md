# 🧠 Mubasher Core — Engineering Knowledge System v3.0

## Multi-Layer Engineering Knowledge Architecture with Playbooks, Graph & Evidence

---

> **تاريخ التصميم:** 23 يوليو 2026  
> **النسخة:** v3.0.0  
> **المهندس المعماري:** Principal Knowledge Architect  
> **المشروع:** Mubasher Core v2.0 — IPTV Restream Cache  
> **النمط:** 10-Layer Knowledge Graph with Diagnostic Engine, Playbooks & Evidence

---

## 📑 فهرس

1. [The Vision](#1-the-vision)
2. [MCP Constraints & Solution](#2-mcp-constraints--solution)
3. [The 10 Knowledge Layers](#3-the-10-knowledge-layers)
4. [Layer 01: Project Constitution](#4-layer-01-project-constitution)
5. [Layer 02: Architecture Graph](#5-layer-02-architecture-graph)
6. [Layer 03: ADR — Architecture Decision Records](#6-layer-03-adr)
7. [Layer 04: Lessons Learned (Bug Knowledge)](#7-layer-04-lessons-learned)
8. [Layer 05: Diagnostics Database](#8-layer-05-diagnostics-database)
9. [Layer 06: Playbooks](#9-layer-06-playbooks)
10. [Layer 07: Performance Baselines](#10-layer-07-performance-baselines)
11. [Layer 08: API Contracts](#11-layer-08-api-contracts)
12. [Layer 09: Runtime Lifecycle](#12-layer-09-runtime-lifecycle)
13. [Layer 10: Roadmap](#13-layer-10-roadmap)
14. [Bug → Law → Diagnostic → Playbook Pipeline](#14-bug--law--diagnostic--playbook-pipeline)
15. [Evidence Memory System](#15-evidence-memory-system)
16. [Architecture Knowledge Graph](#16-architecture-knowledge-graph)
17. [Diagnostic Engine](#17-diagnostic-engine)
18. [Search Protocol](#18-search-protocol)
19. [The engineering-memory Skill](#19-the-engineering-memory-skill)
20. [Quality Gate v3](#20-quality-gate-v3)
21. [Implementation Plan](#21-implementation-plan)

---

# 1. The Vision

## 1.1 What We Are Building

ليس مجرد Memory. بل **Engineering Knowledge System** يمكن لأي نموذج جديد استخدامه لدخول المشروع وفهمه خلال دقائق.

## 1.2 Core Principles

1. **Knowledge survives the model** — أي نموذج يمكنه استخدام هذه القاعدة المعرفية
2. **Every Bug becomes a Law** — كل مشكلة تتحول إلى قاعدة دائمة
3. **Every Error has a Playbook** — كل خطأ له إجراء تشخيصي
4. **Knowledge is a Graph** — المعرفة مترابطة وليست نصوصاً منفردة
5. **Evidence ages with Version** — كل معلومة لها عمر افتراضي مرتبط بإصدار المشروع

## 1.3 The Pipeline

```
Bug Discovery
    │
    ▼
Root Cause Analysis
    │
    ├──► bugs/     (Lesson Learned)
    ├──► laws/     (Prevention Rule)
    ├──► diagnostics/ (Error → Cause mapping)
    └──► playbooks/   (Step-by-step fix procedure)
```

---

# 2. MCP Constraints & Solution

## 2.1 Available Tools

| Tool | Capability | Limitation |
|------|-----------|------------|
| `qdrant-store` | Save with metadata | No update, no delete |
| `qdrant-find` | Semantic search | No filters on metadata |

## 2.2 Solution: 10 Virtual Layers via Prefix

```
Collection واحد: ws-9a6ff60b4297ccb2
تقسيم إلى 10 طبقات عبر layer: prefix في metadata
```

**لماذا هذا يعمل:**
- البحث الدلالي (codestral-embed-2505) يفصل بين الطبقات تلقائياً
- معايير التسمية (01_, 02_) تنظم المعرفة
- الـ dependencies تربط بين الطبقات

---

# 3. The 10 Knowledge Layers

```
Qdrant: ws-9a6ff60b4297ccb2
│
├── 01_Project_Constitution   laws/    قوانين ثابتة لا تتغير
├── 02_Architecture           arch/    العلاقات المعمارية (Graph)
├── 03_ADR                    adr/     Architecture Decision Records
├── 04_Lessons                bugs/    دروس مستفادة من Bugs
├── 05_Diagnostics            diag/    ربط الأخطاء بالأسباب
├── 06_Playbooks              play/    إجراءات خطوة بخطوة
├── 07_Performance            perf/    قياسات الأداء
├── 08_API                    api/     عقود API
├── 09_Runtime                run/     Lifecycle and State
├── 10_Roadmap                road/    الميزات القادمة
```

## 3.1 Layer Details

| # | Layer | Prefix | ID Format | الغرض | حفظ? |
|---|-------|--------|-----------|-------|------|
| 1 | `01_Project_Constitution` | `laws` | `laws-{NNN}` | قوانين ثابتة لا تتغير أبداً | ✅ دائم |
| 2 | `02_Architecture` | `arch` | `arch-{NNN}` | Graph العلاقات بين المكونات | ✅ دائم |
| 3 | `03_ADR` | `adr` | `adr-{NNN}` | قرارات معمارية مع ADR كامل | ✅ دائم |
| 4 | `04_Lessons` | `bugs` | `bugs-{NNN}` | كل Bug مع Root Cause + Evidence | ✅ دائم |
| 5 | `05_Diagnostics` | `diag` | `diag-{NNN}` | Symptom → Causes → Check | ✅ دائم |
| 6 | `06_Playbooks` | `play` | `play-{NNN}` | Procedures خطوة بخطوة | ✅ دائم |
| 7 | `07_Performance` | `perf` | `perf-{NNN}` | مقاييس الأداء والـ Benchmarks | ✅ دائم |
| 8 | `08_API` | `api` | `api-{NNN}` | عقود API و Endpoints | ✅ دائم |
| 9 | `09_Runtime` | `run` | `run-{NNN}` | Lifecycle و State Machine | ✅ دائم |
| 10 | `10_Roadmap` | `road` | `road-{NNN}` | خطط مستقبلية وميزات قادمة | ⚠️ متغير |

---

# 4. Layer 01: Project Constitution

## 4.1 Template

```json
{
  "layer": "01_Project_Constitution",
  "id": "laws-001",
  "title": "Every channel must have a source reference or direct URL",
  "rule": "Any channel MUST have primarySource + primaryStreamId OR a direct url. No exceptions.",
  "rationale": "StreamEngine._resolveSourceUrl() fails with null when neither exists.",
  "originatedFrom": "bugs-001",
  "severity": "critical",
  "versionCreated": "2.0.0",
  "lastVerified": "2026-07-23",
  "version": "2.0.0",
  "evidenceRefs": ["arch-003", "bugs-001"],
  "dependencies": ["bugs-001", "adr-002"]
}
```

---

# 5. Layer 02: Architecture Graph

## 5.1 What Makes This a Graph

ليس مجرد وصف نصي. كل مكون يحفظ **علاقاته** مع المكونات الأخرى:

```
Component
  │
  ├── dependsOn: [...]    ← يعتمد على
  ├── usedBy: [...]       ← يُستخدم بواسطة
  ├── owns: [...]         ← يملك
  ├── creates: [...]      ← يُنشئ
  ├── updates: [...]      ← يُحدّث
  ├── notifies: [...]     ← يُعلم
  └── dataFlow: "..."     ← وصف تدفق البيانات
```

## 5.2 Template

```json
{
  "layer": "02_Architecture",
  "id": "arch-001",
  "title": "Component Relationship: StreamEngine",
  "component": "StreamEngine",
  "path": "src/stream-engine/index.js",
  "dependsOn": ["RuntimeRegistry", "HlsManager", "SourceRepository", "ChannelRepository"],
  "usedBy": ["API", "ViewerManager", "HealthSystem"],
  "owns": ["channel FFmpeg processes", "stream state (duplicated with Registry)"],
  "creates": ["FFmpeg child processes", "HLS playlists and segments via FFmpeg"],
  "updates": ["RuntimeRegistry._streams via _syncRuntime()"],
  "notifies": ["RuntimeRegistry via events"],
  "dataFlow": "Receives viewer join → Resolves source URL → Starts FFmpeg → Writes stream state to RuntimeRegistry → Monitors playlist → Handles disconnects",
  "stateMachine": "STOPPED → STARTING → PROBING → BUFFERING → ONLINE → IDLE → STOPPED | ERROR",
  "version": "2.0.0",
  "evidenceFiles": ["src/stream-engine/index.js:49-62", "src/stream-engine/index.js:87-123", "src/stream-engine/index.js:183-267"],
  "dependencies": ["arch-002", "adr-001", "adr-002"]
}
```

## 5.3 Architecture Graph Example

```
RuntimeRegistry (arch-002)
    │
    ├── owns: channels, sources, streams, viewers, health
    │
    ├── usedBy: StreamEngine, API, ViewerManager, HealthSystem, SourceRepository, ChannelRepository
    │
    └── dataFlow: Central store — all modules read/write here
    
StreamEngine (arch-001)
    │
    ├── dependsOn: RuntimeRegistry, HlsManager, SourceRepository
    ├── usedBy: API, ViewerManager
    ├── creates: FFmpeg processes, HLS segments
    ├── updates: RuntimeRegistry._streams
    └── notifies: RuntimeRegistry via events
    
HlsManager (arch-003)
    │
    ├── dependsOn: RuntimeRegistry (for config only)
    ├── usedBy: StreamEngine, API
    ├── owns: segment journal, refCount, temp dirs
    └── dataFlow: Tracks segments independently, no state in Registry
```

---

# 6. Layer 03: ADR

(نفس الـ ADR design السابق مع إضافة `evidenceRefs`)

```json
{
  "layer": "03_ADR",
  "id": "adr-001",
  "title": "Use RuntimeRegistry as Single Source of Truth",
  "status": "accepted",
  "context": "Multiple modules had duplicate state causing inconsistency.",
  "decision": "All state MUST go through RuntimeRegistry.",
  "rationale": "Eliminates inconsistency. Enables monitoring.",
  "alternatives": ["Event bus", "Database-backed", "Each module owns state"],
  "tradeoffs": { "pros": ["Consistency"], "cons": ["Single point of failure"] },
  "version": "2.0.0",
  "date": "2026-07-01",
  "evidenceRefs": ["arch-001", "arch-002"],
  "dependencies": ["arch-001", "arch-002"]
}
```

---

# 7. Layer 04: Lessons Learned (Bug Knowledge)

## 7.1 Template

```json
{
  "layer": "04_Lessons",
  "id": "bugs-001",
  "title": "Channels without source binding cause 404",
  "symptoms": ["404 playlist.m3u8", "no valid source URL found log", "FFmpeg never starts", "ERROR state"],
  "logs": ["StreamEngine: {id} no valid source URL found"],
  "evidence": ["data/channels.json all 21 channels primarySource=null", "src/stream-engine/index.js:466-473"],
  "rootCause": "Channels created via Admin API without primarySource or url. Import pipeline never used.",
  "files": ["src/stream-engine/index.js:183-267", "src/sources/index.js:346-358", "src/api/admin.js:86-91"],
  "fix": "Re-import sources. Add validation in Admin API.",
  "prevention": ["laws-001: Channel must have source"],
  "regressionTest": "POST /api/admin/channels without primarySource returns 400",
  "version": "2.0.0",
  "lastVerified": "2026-07-23",
  "confidence": 100,
  "severity": "critical",
  "dependencies": ["arch-003", "arch-005", "laws-001"]
}
```

---

# 8. Layer 05: Diagnostics Database

## 8.1 The Key Feature

كل خطأ يحفظ:
1. الـ Symptom (الخطأ الذي يظهر)
2. الأسباب المحتملة مرتبة حسب الاحتمالية (probability)
3. خطوات التحقق من كل سبب
4. النتيجة المتوقعة
5. الـ Fix المناسب

## 8.2 Template

```json
{
  "layer": "05_Diagnostics",
  "id": "diag-001",
  "title": "404: playlist.m3u8 or index.m3u8 not found",
  "symptom": "Viewer receives HTTP 404 when requesting HLS playlist",
  "errorLog": "StreamEngine: {channelId} no valid source URL found",
  "possibleCauses": [
    {
      "cause": "Channel has no source reference (primarySource = null AND url = empty)",
      "probability": 100,
      "check": "Read RuntimeRegistry → channel.primarySource if null → check channel.url if empty → 100%",
      "expectedResult": "primarySource: null, url: \"\"",
      "fix": "Re-import sources via POST /api/admin/sources/import-all"
    },
    {
      "cause": "FFmpeg failed to start (spawn error)",
      "probability": 80,
      "check": "Check StreamEngine logs for spawn error messages",
      "expectedResult": "Error: spawn ffmpeg ENOENT or similar",
      "fix": "Verify ffmpeg path in config, verify ffmpeg.exe exists"
    },
    {
      "cause": "Source URL is invalid or unreachable",
      "probability": 60,
      "check": "Test source URL with ffprobe or curl",
      "expectedResult": "Connection timeout or HTTP error",
      "fix": "Check source availability, check network/proxy settings"
    }
  ],
  "relatedBugs": ["bugs-001"],
  "relatedLaws": ["laws-001"],
  "relatedPlaybooks": ["play-001"],
  "version": "2.0.0",
  "lastVerified": "2026-07-23",
  "dependencies": ["bugs-001", "laws-001", "play-001"]
}
```

---

# 9. Layer 06: Playbooks

## 9.1 The Key Feature

هذا هو الإضافة الأهم. Playbook هو **إجراء خطوة بخطوة** لإصلاح خطأ معين.

## 9.2 Template

```json
{
  "layer": "06_Playbooks",
  "id": "play-001",
  "title": "Playbook: Fix 404 / No Valid Source URL",
  "trigger": "Viewer reports 404, or log shows 'no valid source URL found'",
  "estimatedTime": "5 minutes",
  "steps": [
    {
      "step": 1,
      "action": "Identify affected channel",
      "command": "Check logs for channelId in error message, or check API /api/admin/streams for ERROR state",
      "expected": "Channel ID with ERROR state"
    },
    {
      "step": 2,
      "action": "Check channel binding",
      "command": "Read RuntimeRegistry → getChannel(channelId) → check primarySource, primaryStreamId, url",
      "expected": "If all null → binding is missing"
    },
    {
      "step": 3,
      "action": "List available sources",
      "command": "GET /api/admin/sources → check which sources are enabled and have valid baseUrl",
      "expected": "List of enabled sources"
    },
    {
      "step": 4,
      "action": "Re-import all enabled sources",
      "command": "POST /api/admin/sources/import-all",
      "expected": "Channels recreated with primarySource and primaryStreamId"
    },
    {
      "step": 5,
      "action": "Verify binding restored",
      "command": "Read RuntimeRegistry → getChannel(channelId) → confirm primarySource is no longer null",
      "expected": "primarySource: 'source-uuid'"
    },
    {
      "step": 6,
      "action": "Test the channel",
      "command": "POST /api/admin/streams/{channelId}/start → wait 5s → GET /api/hls/{channelId}/playlist.m3u8",
      "expected": "200 with valid HLS playlist"
    }
  ],
  "verification": "After all steps, viewer should receive 200 with playlist.m3u8 containing .ts segments",
  "rollback": "If steps fail, check source availability and network connectivity manually",
  "version": "2.0.0",
  "lastVerified": "2026-07-23",
  "dependencies": ["diag-001", "bugs-001", "laws-001"]
}
```

---

# 10. Layer 07: Performance Baselines

```json
{
  "layer": "07_Performance",
  "id": "perf-001",
  "title": "FFmpeg HLS Segment Configuration Baseline",
  "metric": "hls_time = 2s, hls_list_size = 40, hls_flags = append_list+split_by_time+independent_segments",
  "rationale": "2s segments balance latency vs overhead. 40 segments give ~80s buffer window.",
  "testedOn": "Windows 10, Node 18, FFmpeg 6.x",
  "measuredAt": "2026-07-23",
  "version": "2.0.0",
  "lastVerified": "2026-07-23",
  "evidenceFiles": ["src/stream-engine/index.js:528-549", "config/default.json:ffmpeg"],
  "dependencies": []
}
```

---

# 11. Layer 08: API Contracts

```json
{
  "layer": "08_API",
  "id": "api-001",
  "title": "HLS Playlist Endpoint",
  "endpoint": "GET /api/hls/:channelId/playlist.m3u8",
  "auth": "None (public)",
  "response": "application/vnd.apple.mpegurl with rewritten segment URLs",
  "cache": "no-store, no-cache, must-revalidate",
  "errors": {
    "404": "Playlist not found (FFmpeg not running or no source)",
    "500": "Internal server error"
  },
  "implementation": "src/api/index.js:160-190",
  "notes": "If file exists, reads it, updates HlsManager, rewrites segment URLs to proxy, returns. If not found, returns 404.",
  "version": "2.0.0",
  "dependencies": ["arch-001", "arch-003"]
}
```

---

# 12. Layer 09: Runtime Lifecycle

```json
{
  "layer": "09_Runtime",
  "id": "run-001",
  "title": "StreamEngine State Machine",
  "states": ["STOPPED", "STARTING", "PROBING", "BUFFERING", "ONLINE", "RECONNECTING", "IDLE", "STOPPING", "ERROR"],
  "transitions": {
    "STOPPED → STARTING": "addViewer() called when viewer joins",
    "STARTING → PROBING": "FFmpeg creates first playlist",
    "PROBING → BUFFERING": "After 1 second timeout",
    "BUFFERING → ONLINE": "After bufferSize ms (default 4096)",
    "ONLINE → RECONNECTING": "FFmpeg process exits with code != 0",
    "RECONNECTING → STARTING": "Reconnect timer fires",
    "ONLINE → IDLE": "All viewers disconnect",
    "IDLE → STARTING": "New viewer joins before idle timeout",
    "IDLE → STOPPING": "Idle timeout expires",
    "STOPPING → STOPPED": "FFmpeg killed or exits",
    "Any → ERROR": "Max reconnects reached or no source URL"
  },
  "file": "src/stream-engine/index.js:36-46 (STATES), 304-334 (state machine)",
  "version": "2.0.0",
  "dependencies": ["arch-001"]
}
```

---

# 13. Layer 10: Roadmap

```json
{
  "layer": "10_Roadmap",
  "id": "road-001",
  "title": "Immediate Fix: Source Binding",
  "priority": "critical",
  "items": [
    "Re-import all enabled sources (POST /api/admin/sources/import-all)",
    "Add validation in Admin API to require primarySource or url",
    "Add startup validation to warn about channels without binding"
  ],
  "version": "2.0.0",
  "date": "2026-07-23",
  "dependencies": ["bugs-001", "laws-001", "play-001"]
}
```

---

# 14. Bug → Law → Diagnostic → Playbook Pipeline

## 14.1 The Pipeline

```
Bug يحدث
    │
    ▼
1. يحلل Root Cause
    │
    ├──► 04_Lessons: save bugs-{NNN} with symptoms, evidence, rootCause
    │
    ├──► 01_Constitution: extract rule → save laws-{NNN} (originatedFrom = bugs-NNN)
    │
    ├──► 05_Diagnostics: create diag-{NNN} with symptom → causes → check
    │
    └──► 06_Playbooks: create play-{NNN} with step-by-step fix procedure
```

## 14.2 Full Example

```
Bug: 404 when requesting playlist.m3u8
    │
    ▼
bugs-001: "Channels without source binding cause 404"
    │
    ├── Evidence: data/channels.json all null
    ├── Root Cause: Admin API created channels without source
    └── Files: stream-engine.js:183-267, sources.js:346-358
    │
    ▼
laws-001: "Every channel must have primarySource or url"
    │
    ├── Rule: Channel MUST have source reference
    ├── Rationale: StreamEngine fails without it
    └── Severity: critical
    │
    ▼
diag-001: "404 playlist.m3u8 Diagnostic"
    │
    ├── Cause A (100%): primarySource = null → Check binding
    ├── Cause B (80%): FFmpeg spawn error → Check logs
    └── Cause C (60%): Source unreachable → Test URL
    │
    ▼
play-001: "Fix 404 / No Valid Source URL"
    │
    ├── Step 1: Identify channel
    ├── Step 2: Check binding
    ├── Step 3: List sources
    ├── Step 4: Re-import
    ├── Step 5: Verify
    └── Step 6: Test
```

---

# 15. Evidence Memory System

## 15.1 Why Evidence Matters

بعد 6 أشهر، الكود يتغير. المعلومة التي كانت صحيحة في v2.0 قد لا تكون صحيحة في v2.4.

**الحل:** كل معلومة تحمل `version` و `lastVerified`.

## 15.2 Evidence Fields (موجودة في كل Layer)

```json
{
  "version": "2.0.0",           // إصدار المشروع عند حفظ المعلومة
  "lastVerified": "2026-07-23", // آخر مرة تم التحقق من صحتها
  "confidence": 100,             // 100 = verified, 90 = code+tests, 80 = code only
  "evidenceFiles": ["file:line", "file:line"],  // أدلة من الكود
  "evidenceRefs": ["arch-001", "bugs-001"]      // أدلة من معرفات أخرى
}
```

## 15.3 Confidence Guide

| Value | Meaning | Action if outdated |
|-------|---------|-------------------|
| 100 | ✅ Verified by code + tests + runtime | Needs re-verification after major version |
| 90 | ✅ Verified by code + tests | Needs re-verification after minor version |
| 80 | ✅ Verified by code | Check if file still exists |
| 70 | ✅ Verified by runtime data | Re-run test |
| 50 | ⚠️ Data analysis only | Needs stronger evidence |
| 0 | ❌ Hypothesis | Never saved |

## 15.4 Version Tracking

```
عند البحث عن معلومة:

1. هل version المعلومة = version المشروع الحالي؟
   ├── YES → المعلومة صالحة
   └── NO  → المعلومة قد تحتاج تحديث
             │
             ├── major version مختلف (2.0 → 3.0) → أعد التحقق
             └── minor version مختلف (2.0 → 2.1) → تحقق سريع
```

---

# 16. Architecture Knowledge Graph

## 16.1 How the Graph Works

ليس مجرد نصوص. كل component يحفظ:

```
ComponentName (arch-NNN)
    │
    ├── path: "src/file.js"
    ├── dependsOn: [components it needs]
    ├── usedBy: [components that use it]
    ├── owns: [data/responsibilities]
    ├── creates: [what it creates]
    ├── updates: [what it updates]
    └── notifies: [what it notifies]
```

## 16.2 Full Graph (Current)

```
RuntimeRegistry (arch-002)
    path: src/runtime.js
    owns: channels, sources, streams, viewers, health
    usedBy: StreamEngine, API, ViewerManager, HealthSystem, SourceRepository, ChannelRepository
    dataFlow: "Central single source of truth"

StreamEngine (arch-001)
    path: src/stream-engine/index.js
    dependsOn: RuntimeRegistry, HlsManager, SourceRepository
    usedBy: API, ViewerManager
    creates: FFmpeg processes, HLS segments
    updates: RuntimeRegistry._streams
    notifies: RuntimeRegistry events
    stateMachine: STOPPED → STARTING → PROBING → BUFFERING → ONLINE → IDLE → STOPPED

HlsManager (arch-003)
    path: src/hls-manager/index.js
    dependsOn: RuntimeRegistry (config only)
    usedBy: StreamEngine, API
    owns: segment journal, refCount, tempDirs
    dataFlow: "Independent segment tracking"

SourceRepository (arch-004)
    path: src/sources/index.js
    dependsOn: RuntimeRegistry, Storage
    usedBy: StreamEngine, API Admin
    owns: source metadata, stream URL cache
    dataFlow: "Resolves stream URLs from source + stream ID"

ChannelRepository (arch-005)
    path: src/channels/index.js
    dependsOn: RuntimeRegistry
    usedBy: API Admin
    owns: channel metadata CRUD
    dataFlow: "No local state, all in RuntimeRegistry"

ViewerManager (arch-006)
    path: src/viewer-manager/index.js
    dependsOn: RuntimeRegistry
    usedBy: API, StreamEngine
    owns: viewer sessions (in Registry), geoCache

HealthSystem (arch-007)
    path: src/health/index.js
    dependsOn: RuntimeRegistry
    usedBy: API Admin
    owns: health data (in Registry)

API (arch-008)
    path: src/api/index.js
    dependsOn: RuntimeRegistry, StreamEngine, HlsManager
    usedBy: Viewers, Admin users
    owns: Express routes, proxy layer
```

---

# 17. Diagnostic Engine

## 17.1 How It Works

```javascript
// عند حدوث خطأ:
// 1. ابحث في 05_Diagnostics عن symptom المطابق
// 2. اعرض الأسباب مرتبة حسب probability
// 3. لكل سبب: check → expectedResult → fix
// 4. اربط بـ 04_Lessons للتفاصيل
// 5. اربط بـ 06_Playbooks للخطوات

// مثال:
qdrant-find({
  query: "diagnostics: 404 playlist m3u8 missing"
})
// → diag-001: 404 playlist.m3u8 not found
//   → Cause A (100%): primarySource = null
//   → Cause B (80%): FFmpeg spawn error
//   → Cause C (60%): Source unreachable
//   → Related: play-001 (step-by-step fix)
```

## 17.2 Diagnostic Database (Current)

| ID | Symptom | Top Cause | Probability |
|----|---------|-----------|------------|
| diag-001 | 404 playlist.m3u8 | Missing source binding | 100% |
| diag-002 | 500 Internal error | Unhandled exception | 80% |
| diag-003 | FFmpeg crash on start | Invalid source URL | 90% |
| diag-004 | Segment miss (404 on .ts) | Cleanup too aggressive | 60% |
| diag-005 | Viewer disconnect | Heartbeat timeout | 70% |

---

# 18. Search Protocol

## 18.1 Pre-Task Protocol

```
قبل أي مهمة جديدة:

Step 1: Search 01_Constitution
qdrant-find({ query: "01_Project_Constitution: [topic]" })
// هل هناك قانون يمنع أو يسمح بهذا؟

Step 2: Search 02_Architecture
qdrant-find({ query: "02_Architecture: [component]" })
// افهم المكون المعني

Step 3: Search 03_ADR
qdrant-find({ query: "03_ADR: [topic] [component]" })
// هل هناك قرارات سابقة؟

Step 4: Search 04_Lessons
qdrant-find({ query: "04_Lessons: [symptom] [error]" })
// هل حدث هذا من قبل؟

Step 5: Search 05_Diagnostics
qdrant-find({ query: "05_Diagnostics: [error] [symptom]" })
// تشخيص سريع

Step 6: Search 06_Playbooks
qdrant-find({ query: "06_Playbooks: [error] [fix]" })
// هل هناك إجراء جاهز؟

Step 7: Execute
```

## 18.2 Query Conventions

| Prefix | Query Pattern |
|--------|--------------|
| `01` | `01_Project_Constitution: channel must have source` |
| `02` | `02_Architecture: StreamEngine RuntimeRegistry relationship` |
| `03` | `03_ADR: source resolution ownership` |
| `04` | `04_Lessons: 404 no valid source url found` |
| `05` | `05_Diagnostics: playlist missing 404` |
| `06` | `06_Playbooks: fix 404 no source` |
| `07` | `07_Performance: hls segment size ffmpeg` |
| `08` | `08_API: playlist endpoint` |
| `09` | `09_Runtime: state machine transition` |
| `10` | `10_Roadmap: future features source binding` |

---

# 19. The engineering-memory Skill

(مخزنة في `.cline/skills/engineering-memory/skill.json`)

## 19.1 Quick Reference

```
🟢 START OF SESSION:
  1. search session/ for existing → resume or create new
  2. search all layers for task context
  3. present knowledge summary

🟡 DURING SESSION:
  1. quality gate before saving
  2. classify into correct layer
  3. link dependencies
  4. extract rules from bugs → save to laws/

🔴 BUG FIXED:
  1. save to 04_Lessons
  2. extract rule → save to 01_Constitution
  3. create diagnostic → save to 05_Diagnostics
  4. create playbook → save to 06_Playbooks
  5. link all four via dependencies

🟣 END OF SESSION:
  1. promote permanent knowledge
  2. create session summary
  3. archive to research
  4. close session
```

---

# 20. Quality Gate v3

## 20.1 Gate Checklist

```
قبل حفظ أي معلومة:
─────────────────────

□ 1. مثبتة بالأدلة؟ (Code, Test, Data, Runtime)
□ 2. تشير إلى ملفات وأسطر محددة؟
□ 3. مفيدة بعد 6 أشهر؟
□ 4. تمنع Bug مستقبلاً أو تسرع التطوير؟
□ 5. معرفة دائمة وليست مؤقتة؟

إذا نعم على جميع:
    ↓
□ 6. أي Layer؟
    □ 01_Constitution  □ 02_Architecture  □ 03_ADR
    □ 04_Lessons       □ 05_Diagnostics   □ 06_Playbooks
    □ 07_Performance   □ 08_API           □ 09_Runtime
    □ 10_Roadmap
□ 7. هل من Bug؟ → استخرج Rule → laws/
□ 8. هل من خطأ؟ → Diagnostic → diag/ + Playbook → play/
□ 9. هل metadata كامل؟ (version, lastVerified, confidence, evidenceFiles)
□ 10. هل dependencies صحيحة؟

اجتازت الكل → حفظ.
لا → تجاهل.
```

## 20.2 Never Save (مطلقاً)

```
❌ Logs
❌ Chain of Thought
❌ Draft Analysis
❌ Temporary TODO
❌ Speculation
❌ Half-complete Ideas
❌ Session Notes
❌ Transient States
❌ Debug Output
❌ Error Messages (العادية)
```

---

# 21. Implementation Plan

## 21.1 Phase 1: Initial Population (Current Session)

| # | Layer | ID | Title |
|---|-------|----|-------|
| 1 | `01_Constitution` | `laws-001` | Every channel must have source or url |
| 2 | `02_Architecture` | `arch-001` | StreamEngine Component Graph |
| 3 | `02_Architecture` | `arch-002` | RuntimeRegistry Component Graph |
| 4 | `02_Architecture` | `arch-003` | HlsManager Component Graph |
| 5 | `02_Architecture` | `arch-004` | SourceRepository Component Graph |
| 6 | `02_Architecture` | `arch-005` | ChannelRepository Component Graph |
| 7 | `02_Architecture` | `arch-006` | Source Resolution Decision Tree |
| 8 | `02_Architecture` | `arch-007` | Data Flow: primarySource Binding |
| 9 | `02_Architecture` | `arch-008` | State Machine Diagram |
| 10 | `02_Architecture` | `arch-009` | FFmpeg Startup Conditions |
| 11 | `03_ADR` | `adr-001` | RuntimeRegistry as SSoT |
| 12 | `03_ADR` | `adr-002` | Source Resolution Ownership |
| 13 | `03_ADR` | `adr-003` | One FFmpeg per Channel |
| 14 | `03_ADR` | `adr-004` | Atomic Swap for Restart |
| 15 | `03_ADR` | `adr-005` | Gradual Cleanup with RefCount |
| 16 | `04_Lessons` | `bugs-001` | Channels without source binding |
| 17 | `05_Diagnostics` | `diag-001` | 404 playlist.m3u8 |
| 18 | `06_Playbooks` | `play-001` | Fix 404 / No Valid Source URL |
| 19 | `07_Performance` | `perf-001` | HLS Segment Size Baseline |
| 20 | `08_API` | `api-001` | HLS Playlist Endpoint |
| 21 | `09_Runtime` | `run-001` | StreamEngine State Machine |
| 22 | `10_Roadmap` | `road-001` | Immediate Fix: Source Binding |

## 21.2 Phase 2: Growth

- كل Bug → 04_Lessons + 01_Constitution + 05_Diagnostics + 06_Playbooks
- كل Decision → 03_ADR
- كل Component → 02_Architecture

---

## ✅ الخلاصة

| العنصر | القرار |
|--------|--------|
| **التخزين** | Qdrant: `ws-9a6ff60b4297ccb2` |
| **الطبقات** | 10 Virtual Layers عبر `layer:` prefix |
| **الكمية الأولية** | 22 معرفة في 9 طبقات |
| **الربط** | Knowledge Graph عبر `dependencies` |
| **الجودة** | Quality Gate v3 (10 شروط) |
| **البحث** | Pre-task protocol (7 خطوات) |
| **الأدلة** | Version + lastVerified + confidence + evidenceFiles |
| **المهارة** | `engineering-memory` Skill في `.cline/skills/` |
| **الميزة الفريدة** | كل Bug → 4 مخرجات: Lesson + Law + Diagnostic + Playbook |