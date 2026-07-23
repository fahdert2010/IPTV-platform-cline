# 📋 التقرير المعماري الكامل — IPTV Platform (Mubasher Core v2.0)
## Full Architecture & Root Cause Analysis Report

---

> **تاريخ التقرير:** 23 يوليو 2026  
> **النسخة:** v2.0.0  
> **الغرض:** تدقيق شامل لـ Import Pipeline، Source Resolution، Binding، Data Flow، وتحديد السبب الجذري لمشكلة 404 / "no valid source URL found"

---

## 📑 فهرس التقرير

1. [Architecture Report](#1-architecture-report)
2. [Import Pipeline Report](#2-import-pipeline-report)
3. [Repository Report](#3-repository-report)
4. [Data Flow Report](#4-data-flow-report)
5. [Binding Report](#5-binding-report)
6. [Source Resolution Report](#6-source-resolution-report)
7. [Runtime Report](#7-runtime-report)
8. [FFmpeg Startup Report](#8-ffmpeg-startup-report)
9. [Root Cause Report](#9-root-cause-report)
10. [Fix Strategy](#10-fix-strategy)

---

# 1. Architecture Report

## 1.1 Overview

Mubasher Core v2.0 هو خادم IPTV Restream Cache مبني على Node.js/Express. يتكون من 12 وحدة رئيسية:

```
┌─────────────────────────────────────────────────────────────┐
│                      Mubasher Core v2.0                      │
├─────────────────────────────────────────────────────────────┤
│  src/index.js (67 lines)         - Entry Point               │
│  src/runtime.js (787 lines)      - RuntimeRegistry (SSoT)    │
│  src/api/index.js (541 lines)    - Express API Server        │
│  src/api/admin.js (438 lines)    - Admin REST API            │
│  src/api/public.js               - Public REST API           │
│  src/stream-engine/index.js (1058) - FFmpeg Manager          │
│  src/hls-manager/index.js (783)  - HLS Lifecycle Manager     │
│  src/sources/index.js (708)      - Source Repository         │
│  src/sources/m3u-parser.js (117) - M3U Parser                │
│  src/channels/index.js (395)     - Channel Repository        │
│  src/viewer-manager/index.js (226) - Viewer Session Manager  │
│  src/cache/index.js              - Cache Engine               │
│  src/health/index.js (166)       - Health Monitoring          │
│  src/config/index.js (83)        - Configuration Loader       │
│  src/storage/index.js (202)      - JSON File Storage          │
│  src/logger/index.js             - Logging System             │
│  src/utils/index.js              - Utility Functions           │
└─────────────────────────────────────────────────────────────┘
```

## 1.2 Architecture Pattern

**النظام يتبع نمط Event-Driven مع Single Source of Truth (RuntimeRegistry).**

```
                  ┌──────────────────┐
                  │   RuntimeRegistry │  ← كل الوحدات تقرأ وتكتب من هنا
                  │   (SSoT)         │
                  └────────┬─────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
  ┌──────────┐     ┌────────────┐     ┌──────────────┐
  │  Stream  │     │   API      │     │  Viewer      │
  │  Engine  │     │   Server   │     │  Manager     │
  └──────────┘     └────────────┘     └──────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
  ┌──────────┐     ┌────────────┐     ┌──────────────┐
  │  HLS     │     │  Sources   │     │  Health      │
  │  Manager │     │  Repo      │     │  System      │
  └──────────┘     └────────────┘     └──────────────┘
```

## 1.3 Data Ownership

| المكون | البيانات التي يملكها | المصدر الحقيقي |
|--------|---------------------|----------------|
| RuntimeRegistry | جميع البيانات | ✅ SSoT |
| StreamEngine | `channels: Map` (حالة FFmpeg الداخلية) | ❌ مكرر |
| HlsManager | `_channels: Map` (سجل المقاطع) | ✅ مستقل (مقاطع فقط) |
| SourceRepository | `_streamUrls: Map` (Cache للـ URLs) | ✅ Cache مؤقت فقط |
| ChannelRepository | لا شيء | ✅ SSoT في RuntimeRegistry |
| ViewerManager | `_geoCache: Map` | ✅ Cache مؤقت فقط |

**مشكلة ازدواجية البيانات:** StreamEngine يحتفظ بـ `this.channels: Map<channelId, ChannelStream>` بينما RuntimeRegistry يحتفظ بـ `_streams: Map<channelId, StreamState>`. يتم المزامنة عبر `_syncRuntime()` بشكل دوري، مما يخلق نافذة لعدم التناسق.

---

# 2. Import Pipeline Report

## 2.1 Import Pipeline الكاملة

```
بداية الاستيراد
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. نقطة البداية: Admin API / Sources API                    │
│    • POST /api/admin/sources/:id/import  (importChannels)   │
│    • POST /api/admin/sources/import-all  (importAllEnabled) │
│    • POST /api/admin/sources/import-file (رفع ملف)          │
│    • POST /api/admin/sources/:id/resync  (resync)           │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SourceRepository.importChannels(source)                  │
│    • الملف: src/sources/index.js :260-389                   │
│    • يتحقق من وجود المصدر                                    │
│    • يختار الـ Importer المناسب حسب type                     │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Importer (حسب النوع)                                     │
│    • M3U  → _importM3U()     (سطر 391-427)                 │
│    • Xtream → _importXtream  (سطر 429-451)                 │
│    • Stalker → _importStalker (سطر 453-496)                │
│    • MAG  → _importMAG      (سطر 498-512)                 │
│    • JSON → _importJSON     (سطر 514-543)                 │
│    • CSV  → _importCSV      (سطر 545-586)                 │
│    • ZIP  → _importZIP      (سطر 588-629)                 │
│    • Local → _importLocal   (سطر 631-681)                 │
│    • Direct → HLS, TS, MPD, RTMP, RTSP, UDP, SRT, RIST    │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. كل Importer يعيد مصفوفة من:                               │
│    [ { name, streamId, group, logo, language,               │
│        country, bitrate, resolution, fps, number } ]        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Binding: SourceRepository.importChannels() (سطر 319-365)│
│    • لكل قناة من المصفيوفة:                                  │
│      1. يبحث عن قناة موجودة بنفس primaryStreamId             │
│         runtime.getChannels({ primaryStreamId, primarySource })│
│      2. إذا موجودة → channels.update(existing.id, data)     │
│      3. إذا غير موجودة → channels.add({                     │
│           primarySource: src.id,     ← ✅ يربط المصدر       │
│           primaryStreamId: ch.streamId, ← ✅ يربط الـ stream │
│           name, group, logo, ...                             │
│         })                                                   │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. ChannelRepository.add() (سطر 125-185)                   │
│    • ينشئ ID جديد (uuid)                                    │
│    • يستدعي runtime.setChannel(id, data)                    │
│    • يستدعي this._save() (يكتب إلى storage)                 │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Storage.setAll() (src/storage/index.js :109-113)        │
│    • يخزن في الذاكرة المؤقتة (cache)                         │
│    • يكتب إلى ملف JSON في data/channels.json                │
└─────────────────────────────────────────────────────────────┘
```

## 2.2 تحليل كل Importer بالتفصيل

### 2.2.1 M3U Importer (`_importM3U` — سطر 391-427)

**المسار:**
```
Source.baseUrl (URL أو ملف)
    │
    ▼
fetch() أو fs.readFileSync()
    │
    ▼
m3uParser.parseM3U(content) ← src/sources/m3u-parser.js :13-42
    │
    ▼
يعيد: [ { name, url, tvgId, tvgName, tvgLogo, group, backupUrls } ]
    │
    ▼
_importM3U يعيد: [ { name, streamId: item.url, url: item.url, group, logo, language, country, bitrate, resolution, fps, number } ]
```

**ملاحظة هامة:** `m3u-parser.js` يعيد `url` (الرابط المباشر مثل `http://...`). `_importM3U` يخزن هذا الرابط في حقل `streamId`.

**هذا صحيح منطقياً:** بالنسبة لمصدر M3U، الـ `streamId` هو رابط البث المباشر نفسه. `SourceRepository.resolveStreamUrl()` يعالج هذا بشكل صحيح (سطر 151-153):
```javascript
case 'm3u':
  url = streamId;  // streamId هو الرابط المباشر
  break;
```

### 2.2.2 Xtream Importer (`_importXtream` — سطر 429-451)

**المسار:**
```
GET baseUrl/player_api.php?username=...&password=...&action=get_live_streams
    │
    ▼
JSON Response: [ { name, stream_id, category_name, stream_icon, bitrate, ... } ]
    │
    ▼
يعيد: [ { name, streamId: item.stream_id.toString(), group, logo, ... } ]
```

**صحيح:** `streamId` هو الرقمي من Xtream API.

### 2.2.3 Stalker Importer (`_importStalker` — سطر 453-496)
### 2.2.4 MAG Importer (`_importMAG` — سطر 498-512)
يدعو `_importStalker` مباشرة.

### 2.2.5 JSON Importer (`_importJSON` — سطر 514-543)
### 2.2.6 CSV Importer (`_importCSV` — سطر 545-586)
### 2.2.7 ZIP Importer (`_importZIP` — سطر 588-629)
### 2.2.8 Local Importer (`_importLocal` — سطر 631-681)

## 2.3 نقطة الفشل في Import Pipeline

**التحليل:** جميع Importers تعيد البيانات بشكل صحيح مع `streamId`. خطوة الـ Binding (سطر 319-365) تقوم بربط `primarySource: src.id` و `primaryStreamId: ch.streamId` بشكل صحيح.

**إذن أين المشكلة؟**

### ✅ Import Pipeline صحيحة من الناحية البرمجية

إذا تم استيراد قناة عبر:
1. POST /api/admin/sources/:id/import → ستعمل بشكل صحيح
2. POST /api/admin/sources/import-all → ستعمل بشكل صحيح

### ❌ لكن البيانات الحالية تظهر عكس ذلك

جميع القنوات الـ 21 في `data/channels.json` لديها:
- `primarySource: null`
- `primaryStreamId: null`
- `url: ""`

**هذا يثبت أن هذه القنوات لم تُستورد عبر Import Pipeline أبداً.**

---

# 3. Repository Report

## 3.1 ChannelRepository (src/channels/index.js — 395 سطر)

**المسؤولية:** CRUD لبيانات القنوات الوصفية فقط.

| الدالة | التأثير على primarySource |
|--------|--------------------------|
| `add(data)` (سطر 125) | يعين `primarySource: data.primarySource || null` |
| `update(id, data)` (سطر 191) | يمرر `data` مباشرة إلى `runtime.setChannel()` |
| `remove(id)` (سطر 206) | يحذف من RuntimeRegistry |

**كيف يتم إنشاء قناة عبر Admin API:**
```javascript
// src/api/admin.js :86-91
router.post('/channels', (req, res) => {
  const ch = channels.add(req.body);  // ← req.body.primarySource قد يكون undefined
  ...
});
```

**إذاً:** عند إنشاء قناة عبر `POST /api/admin/channels` بدون إرسال `primarySource` في الـ body، ستصبح القناة بدون مصدر.

## 3.2 SourceRepository (src/sources/index.js — 708 سطر)

| الدالة | التأثير |
|--------|---------|
| `add(data)` (سطر 79) | ينشئ مصدر جديد مع id uuid |
| `importChannels(source)` (سطر 260) | يستورد القنوات من المصدر ويربطها |
| `resolveStreamUrl(sourceId, streamId)` (سطر 141) | يحل URL من sourceId + streamId |

## 3.3 RuntimeRegistry (src/runtime.js — 787 سطر)

**البنية:**
```
_channels: Map<channelId, ChannelState>
_sources: Map<sourceId, SourceState>
_streams: Map<channelId, StreamState>
_viewers: Map<viewerId, ViewerSession>
_health: Map<channelId, HealthData>
```

**مشكلة: ازدواجية البيانات مع StreamEngine**

`StreamEngine.channels: Map<channelId, ChannelStream>` يحتوي على نفس البيانات الموجودة في `RuntimeRegistry._streams` ولكن مع حقول إضافية (مثل `proc`, `_healthTimer`, `_idleTimer`).

المزامنة تتم عبر `_syncRuntime()` (سطر 87-123 في stream-engine) ولكن:
1. المزامنة ليست فورية (تعتمد على استدعاء الدالة)
2. StreamEngine هو المصدر الفعلي لبعض الحقول (مثل `cpu`, `memory`)
3. يمكن أن يحدث عدم تناسق إذا فشل المزامنة

## 3.4 Storage (src/storage/index.js — 202 سطر)

**طريقة التخزين:** JSON files في `data/` directory.

**طريقة التحميل:** في `src/index.js` (سطر 29-31):
```javascript
await sources.load();    // يقرأ data/sources.json → RuntimeRegistry
await channels.load();   // يقرأ data/channels.json → RuntimeRegistry
```

**الأهمية:** عند إعادة تشغيل الخادم، يتم تحميل البيانات من JSON إلى RuntimeRegistry. إذا تم إصلاح البيانات يدوياً في JSON، فستظهر في RuntimeRegistry بعد إعادة التحميل. لكن هذه ليست ممارسة جيدة.

---

# 4. Data Flow Report

## 4.1 تتبع حقل `primarySource`

```
┌──────────────────────────────────────────────────────┐
│   1. الإنشاء (أثناء Import Pipeline)                  │
│                                                      │
│   SourceRepository.importChannels()                  │
│   ↓                                                  │
│   channels.add({ primarySource: src.id, ... })       │
│   ↓                                                  │
│   runtime.setChannel(id, { primarySource: src.id })  │
│   ↓                                                  │
│   this._save() → data/channels.json                  │
│   ↓                                                  │
│   ✅ primarySource موجود في JSON                      │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│   2. الإنشاء (عبر Admin API المباشر)                  │
│                                                      │
│   POST /api/admin/channels                           │
│   ↓                                                  │
│   req.body قد لا يحتوي على primarySource              │
│   ↓                                                  │
│   channels.add(req.body)                             │
│   ↓                                                  │
│   runtime.setChannel(id, { primarySource: null })    │
│   ↓                                                  │
│   this._save() → data/channels.json                  │
│   ↓                                                  │
│   ❌ primarySource = null                             │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│   3. التحميل (عند بدء التشغيل)                        │
│                                                      │
│   src/index.js → sources.load() + channels.load()   │
│   ↓                                                  │
│   storage.getAll('channels') → JSON                  │
│   ↓                                                  │
│   runtime.setChannel(id, { ...data })                │
│   ↓                                                  │
│   ✅ primarySource محفوظ كما هو في JSON               │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│   4. الاستخدام (في StreamEngine)                      │
│                                                      │
│   streamEngine.addViewer(channelId, ...)             │
│   ↓                                                  │
│   StreamEngine._startFFmpeg(channelId)               │
│   ↓                                                  │
│   this._resolveSourceUrl(channelId)                  │
│   ↓                                                  │
│   const ch = runtime.getChannel(channelId)           │
│   ↓                                                  │
│   sourceRefs = [                                     │
│     { sourceId: ch.primarySource,                    │
│       streamId: ch.primaryStreamId }                 │
│   ]                                                  │
│   ↓                                                  │
│   if (sourceRefs.length === 0 && !ch.url) → null     │
│   ↓                                                  │
│   ❌ "no valid source URL found"                      │
└──────────────────────────────────────────────────────┘
```

## 4.2 تحليل فقدان البيانات

| الحقل | أين ينشأ | أين يفقد | لماذا |
|-------|---------|---------|-------|
| `primarySource` | في `importChannels()` (سطر 355) | لم يفقد — لم يُنشأ أصلاً | القنوات الحالية أضيفت عبر Admin API مباشرة وليس عبر Import |
| `primaryStreamId` | في `importChannels()` (سطر 356) | لم يفقد — لم يُنشأ أصلاً | نفس السبب |
| `url` | في `channels.add()` من `data.url` | لم يفقد — لم يُعطَ قيمة | لم يتم إرسال url في طلب API |
| `name` | في `importChannels()` أو `channels.add()` | موجود لـ 20 قناة، مفقود للأولى | القناة الأولى `mru4t6ob2na8au` أضيفت بدون اسم |

## 4.3 إثبات: القنوات الحالية أضيفت عبر Admin API وليس Import

**الدليل 1:** القناة الأولى (`mru4t6ob2na8au`) بدون اسم.
- لو استُوردت عبر Import، لكان لها اسم من M3U
- القناة الفارغة دليل على إنشاء يدوي

**الدليل 2:** جميع القنوات لديها `primarySource: null`.
- Import Pipeline يضبط `primarySource` تلقائياً
- القيم الخالية تعني أن `channels.add()` دُعي بدون `primarySource`

**الدليل 3:** أسماء القنوات ومجموعاتها متطابقة مع M3U لكنها تخزنت بدون Source Reference.
- هذا يعني أن M3U استُورد سابقاً، أنشأ القنوات، لكن الـ Binding لم يعمل بشكل صحيح وقتها
- أو أن القنوات أضيفت عبر واجهة الإدارة لاحقاً

**الاحتمال المرجح:** القنوات استُوردت من M3U في إصدار سابق من النظام (قبل إضافة Binding Logic في `importChannels()`). في الإصدار الأقدم، كان النظام يخزن `url` مباشرة في القناة. بعد تحديث الكود وإضافة Source References، بقيت القنوات القديمة بدون `primarySource`.

---

# 5. Binding Report

## 5.1 العلاقة الحالية بين Channel و Source

```
Channel
  │
  ├── primarySource: string?  ← معرف المصدر في SourceRepository
  ├── primaryStreamId: string? ← معرف البث داخل المصدر
  ├── backupSource1: string?   ← مصدر احتياطي 1
  ├── backupStreamId1: string? ← معرف البث الاحتياطي 1
  ├── backupSource2: string?   ← مصدر احتياطي 2
  ├── backupStreamId2: string? ← معرف البث الاحتياطي 2
  ├── backupSource3: string?   ← مصدر احتياطي 3
  ├── backupStreamId3: string? ← معرف البث الاحتياطي 3
  │
  └── url: string?  ← رابط مباشر (قديم، بدون Source)

Source
  │
  ├── id: string
  ├── type: string (m3u, xtream, stalker, ...)
  ├── baseUrl: string
  ├── username, password, ...
  └── headers, referer, user-agent, ...
```

## 5.2 كيف يعمل Binding حالياً

**أثناء Import:**
```
SourceRepository.importChannels(source)
  │
  ↓
channels.add({
  primarySource: source.id,      // ← ربط المصدر
  primaryStreamId: ch.streamId,  // ← ربط البث
  name: ch.name,
  ...
})
```

**أثناء Source Resolution:**
```
StreamEngine._resolveSourceUrl(channelId)
  │
  ↓
const ch = runtime.getChannel(channelId)
const sourceRefs = []
if (ch.primarySource && ch.primaryStreamId) {
  sourceRefs.push({ sourceId: ch.primarySource, streamId: ch.primaryStreamId, ... })
}
// + Backup sources
// إذا لم يجد → null
```

## 5.3 Binding غير متماثل

**Import يربط** ← ✅ 
**Admin API المباشر لا يربط** ← ❌

```
POST /api/admin/channels  ← لا يطلب primarySource من المستخدم
POST /api/admin/sources/:id/import ← يربط تلقائياً
```

**هذا هو العيب التصميمي:** يمكن إنشاء قنوات بدون Source References عبر Admin API.

## 5.4 اقتراح تحسين الـ Binding

```
Channel
  │
  ├── bindings: [                    ← مصفوفة بدلاً من حقول منفردة
  │     { sourceId, streamId, priority, label, enabled }
  │   ]
  │
  └── url: string?  ← يبقى للـ Direct URL (اختياري)
```

**لماذا؟**
1. يدعم أكثر من 4 مصادر احتياطية
2. يمكن تعطيل مصدر معين دون حذفه
3. يمكن تغيير الأولوية ديناميكياً
4. مصفوفة cleaner من حقول متعددة

**لكن هذا يقترح كتحسين مستقبلي، ليس كإصلاح عاجل.**

---

# 6. Source Resolution Report

## 6.1 Decision Tree الكامل

```
Channel
  │
  ├── Does ch.primarySource && ch.primaryStreamId exist?
  │   ├── YES → Try Primary Source
  │   │         ├── sources.resolveStreamUrl(sourceId, streamId)
  │   │         │     ├── Source exists & enabled?
  │   │         │     │   ├── YES → Build URL by type
  │   │         │     │   │         └── Return URL
  │   │         │     │   └── NO  → Return null
  │   │         │     └── URL found?
  │   │         │       ├── YES → Return { url, sourceId, ... }
  │   │         │       └── NO  → Try streamId as direct URL
  │   │         │                 ├── URL?
  │   │         │                 │   ├── YES → Return
  │   │         │                 │   └── NO  → Try next source
  │   │         └── All sources failed → null
  │   │
  │   └── NO → Does ch.url exist?
  │         ├── YES → Return { url: ch.url, label: 'Direct URL' }
  │         └── NO  → Return null  ← ★ "no valid source URL found"
  │
  ▼
null → ERROR → FFmpeg doesn't start → No index.m3u8 → 404
```

## 6.2 جميع المسارات الممكنة وفشلها

| المسار | الشرط | السلوك | متى يفشل |
|--------|-------|--------|---------|
| Primary Source | `primarySource && primaryStreamId` | `resolveStreamUrl()` | مصدر غير موجود/مفعل، streamId فارغ |
| Primary streamId مباشر | بعد فشل resolveStreamUrl | `url = ref.streamId` | streamId ليس رابط صالح |
| Backup 1 | بعد فشل Primary | نفس المسار | نفس الأسباب |
| Backup 2 | بعد فشل Backup 1 | نفس المسار | نفس الأسباب |
| Backup 3 | بعد فشل Backup 2 | نفس المسار | نفس الأسباب |
| Direct URL | لا يوجد أي Source References | `url = ch.url` | url فارغ |

## 6.3 متى يفشل كل مسار

**Primary Source يفشل عندما:**
1. `runtime.getSource(sourceId)` يعيد `null` — المصدر محذوف
2. `source.enabled === false` — المصدر معطل
3. `source.type` غير معروف — الـ switch يذهب إلى default ويعيد `url = streamId`
4. `streamId` فارغ أو `undefined` — `url` سيكون `undefined`

**StreamId مباشر يفشل عندما:**
- `ref.streamId` ليس رابط HTTP/HTTPS صالح — سيعمل لكن FFmpeg قد يفشل

**Direct URL يفشل عندما:**
- `ch.url` هو `""` (فارغ) — وهذا ما نراه في البيانات الحالية

---

# 7. Runtime Report

## 7.1 كيف يتم إنشاء Runtime

```javascript
// src/stream-engine/index.js :146-178
_getOrCreateChannel(channelId, channelData) {
  let cs = this.channels.get(channelId);
  if (!cs) {
    cs = {
      channelId,
      state: STATES.STOPPED,          // ← حالة البداية
      proc: null,                     // ← FFmpeg process
      viewers: new Map(),             // ← المشاهدين
      currentUrl: '',
      currentUrlIndex: 0,            // ← المصدر الحالي
      startedAt: null,
      ...
    };
    this.channels.set(channelId, cs);
  }
  return cs;
}
```

## 7.2 كيف يتم إنهاء Runtime

```javascript
// src/stream-engine/index.js :125-143
_cleanupChannel(channelId) {
  // يقتل FFmpeg process
  // يمسح المؤقتات
  // يمسح viewers
  // يحذف من this.channels
  // يسجل في HLS Manager
  hlsManager.unregisterChannel(channelId);
  runtime.setStream(channelId, { state: 'STOPPED' });
}
```

## 7.3 دورة حياة Runtime الكاملة

```
Viewer joins channel
    │
    ▼
addViewer(channelId, channelData, viewerId)
    │
    ▼
_getOrCreateChannel() → { state: STOPPED }
    │
    ▼
cs.state = STARTING
    │
    ▼
_resolveSourceUrl(channelId)
    │
    ├── Success → _startFFmpeg(channelId)
    │                │
    │                ▼
    │           spawn(ffmpeg, args)
    │                │
    │                ▼
    │           Wait for playlist (500ms interval)
    │                │
    │                ▼
    │           Playlist found →
    │           state: PROBING → BUFFERING → ONLINE
    │
    └── Failed → state: ERROR
                   │
                   ▼
              _handleDisconnect (إذا يوجد مشاهدين)
```

## 7.4 State Machine

```
                    ┌─────────┐
                    │ STOPPED │←──────────────┐
                    └────┬────┘               │
                         │ addViewer()        │
                         ▼                    │
                    ┌─────────┐               │
                    │ STARTING│               │
                    └────┬────┘               │
                         │ playlist found     │
                         ▼                    │
                    ┌─────────┐               │
                    │ PROBING │               │
                    └────┬────┘               │
                         │ 1 second           │
                         ▼                    │
                    ┌──────────┐              │
                    │ BUFFERING│              │
                    └────┬─────┘              │
                         │ bufferSize ms      │
                         ▼                    │
                    ┌─────────┐               │
             ┌─────→│ ONLINE  │───────────────┤
             │      └────┬────┘  stop()       │
             │           │                    │
             │           │ FFmpeg crash       │
             │           ▼                    │
             │      ┌──────────────┐          │
             │      │ RECONNECTING │          │
             │      └──────┬───────┘          │
             │             │ reconnect        │
             │             ▼                  │
             │        ┌─────────┐             │
             └────────│ STARTING│             │
                      └─────────┘             │
                                              │
             no viewers → IDLE → idle timer →─┘
                       │
                       ▼
                   ┌─────────┐
                   │ STOPPING│
                   └────┬────┘
                        │
                        ▼
                   ┌─────────┐
                   │  ERROR  │────→ (إذا لم يتم الإصلاح)
                   └─────────┘
```

---

# 8. FFmpeg Startup Report

## 8.1 جميع شروط تشغيل FFmpeg

```
Viewer joins channel
    │
Step 1: هل القناة موجودة ومفعلة؟
    ├── runtime.getChannel(channelId) ≠ null
    ├── ch.enabled === true
    └── إذا لا → لا يبدأ، log "disabled"
    
Step 2: هل يوجد Source URL؟
    ├── _resolveSourceUrl(channelId) ≠ null
    ├── sourceInfo.url ≠ undefined
    └── إذا لا → state = ERROR, log "no valid source URL found"

Step 3: هل FFmpeg يعمل بالفعل؟
    ├── cs.proc === null (يُقتل القديم أولاً)
    └── إذا يعمل → يُقتل أولاً (kill SIGKILL)

Step 4: هل FFmpeg الملف التنفيذي موجود؟
    ├── ffmpegPath = config.ffmpeg.path || 'ffmpeg'
    └── spawn(ffmpegPath, args) — إذا فشل → error event

Step 5: هل FFmpeg بدأ بشكل صحيح؟
    ├── wait for playlist (index.m3u8) with .ts segments
    ├── interval 500ms, timeout غير محدد (أو حتى يظهر)
    └── playlist found → state: PROBING

Step 6: هل HLS Manager جاهز؟
    ├── hlsManager.registerChannel(channelId)
    ├── tempDir للحالات التي تحتاج Atomic Swap
    └── updatePlaylist عند أول playlist
```

## 8.2 أين يتوقف FFmpeg Startup

**نقطة الفشل الوحيدة حالياً: Step 2 — Source Resolution**

```
_resolveSourceUrl(channelId)
    │
    ├── ch.primarySource = null      → sourceRefs فارغ
    ├── ch.primaryStreamId = null    → sourceRefs فارغ
    ├── sourceRefs.length = 0        → يتحقق من ch.url
    ├── ch.url = ""                  → فارغ
    └── RETURN null
         │
         ▼
    logger.error(`StreamEngine: ${channelId} no valid source URL found`)
    cs.state = 'ERROR'
    FFmpeg لا يبدأ
```

---

# 9. Root Cause Report

## ⚠️ إثبات السبب الجذري

### Step 1: Import Pipeline يعمل بشكل صحيح برمجياً

**الملف:** `src/sources/index.js` سطر 319-365
**السطر:** 346-358 (إضافة قناة مع Binding)

```javascript
// SourceRepository.importChannels() سطر 346-358
channelsRepo.add({
  name: ch.name,
  number: ch.number || 0,
  group: ch.group || '',
  logo: ch.logo || '',
  language: ch.language || '',
  country: ch.country || '',
  primarySource: src.id,        // ← ✅ يربط المصدر
  primaryStreamId: ch.streamId,  // ← ✅ يربط البث
  enabled: true
});
```

**✅ هذا الكود سليم.** إذا استُخدم Import Pipeline، سيتم ربط القنوات بشكل صحيح.

### Step 2: Admin API المباشر لا يربط

**الملف:** `src/api/admin.js` سطر 86-91
**السطر:** 87

```javascript
router.post('/channels', (req, res) => {
  const ch = channels.add(req.body);  // ← req.body قد لا يحتوي على primarySource
  ...
});
```

**ملف:** `src/channels/index.js` سطر 125-128
```javascript
add(data) {
  const id = uuidv4();
  const channel = runtime.setChannel(id, {
    primarySource: data.primarySource || null,   // ← إذا لم يرسل → null
    primaryStreamId: data.primaryStreamId || null, // ← إذا لم يرسل → null
    ...
  });
```

**✅ هذا الكود يعمل بشكل صحيح:** إذا أرسل المستخدم `primarySource` في الـ body، سيتم حفظه. لكن إذا لم يرسله، سيصبح `null`.

### Step 3: البيانات الحالية تثبت أن Binding لم يحدث أبداً

**الملف:** `data/channels.json`

| القناة | primarySource | primaryStreamId | url |
|--------|--------------|----------------|-----|
| `mru4t6ob2na8au` (بدون اسم) | null | null | "" |
| `mrudu3goryfd9i` (beIN MAX 1) | null | null | "" |
| `mrudu3gpu0jt8d` (beIN MAX 2) | null | null | "" |
| ... (جميع الـ 21 قناة) | null | null | "" |

**الدليل القاطع:** لا توجد قناة واحدة في قاعدة البيانات لديها `primarySource` أو `primaryStreamId` أو `url`. هذا يعني:

1. **لم تُستورد هذه القنوات عبر Import Pipeline** — لأن Import Pipeline يضبط `primarySource` تلقائياً
2. **لم تُنشأ هذه القنوات عبر Admin API مع بيانات Source** — لأن Admin API يتطلب إرسال `primarySource` في الـ body
3. **هذه القنوات إما:** أُنشئت في إصدار سابق من النظام لم يكن يدعم Source References، أو أُنشئت عبر واجهة لم تعد موجودة

### Step 4: لماذا حدث هذا؟

**السيناريو الأكثر احتمالاً:**

```
1. تم تشغيل إصدار سابق من النظام (v1.x)
2. تم استيراد M3U playlist → أنشأ 21 قناة مع url مباشر فقط
3. تم تحديث النظام إلى v2.0 (بإضافة Source References)
4. الـ migration من url → primarySource لم يتم
5. القنوات بقيت بدون primarySource وبدون url

أو:

1. تم استيراد M3U playlist
2. importChannels() أنشأ القنوات مع primarySource + primaryStreamId
3. في وقت لاحق، data/channels.json تم مسحها أو الكتابة فوقها
4. القنوات الحالية أضيفت من جديد عبر Admin API بدون بيانات المصدر
```

### Step 5: لماذا لم يُكتشف الخطأ سابقاً؟

1. لأن القنوات التي لديها `index.m3u8` في مجلدات HLS (7 من 9) كانت تعمل من جلسات سابقة
2. المشاهدون كانوا يشاهدون الـ HLS المخبأ (cached) دون الحاجة إلى FFmpeg
3. فقط عندما تنتهي صلاحية الـ cache أو عند إعادة تشغيل الخادم، تظهر المشكلة
4. لا يوجد اختبار (test) يتحقق من أن جميع القنوات لديها Source References صالحة
5. Gradual Cleanup كان معطلاً، مما أخفى المشكلة لأن الملفات بقيت موجودة

## ⛔ ملخص السبب الجذري

```
السبب الجذري: القنوات الموجودة في قاعدة البيانات ليس لديها primarySource أو primaryStreamId أو url.
هذا يعني أن هذه القنوات إما أُنشئت عبر Admin API المباشر بدون بيانات مصدر،
أو أُنشئت في إصدار سابق من النظام وتم فقدان بيانات الربط.

الملف: data/channels.json
السطر: جميع القنوات (1-21) — primarySource = null, primaryStreamId = null, url = ""
الدليل: كل قناة في الملف تظهر primarySource: null
لماذا حدث: لأن import pipeline لم يُستخدم لهذه القنوات، أو تم الكتابة فوق البيانات
لماذا لم يُكتشف: لأن HLS cache كان لا يزال يعمل من جلسات سابقة
```

---

# 10. Fix Strategy

## 10.1 Immediate Fix (إصلاح عاجل — أقل تعديل يجعل النظام يعمل)

### الخطوة 1: إضافة بيانات المصدر للقنوات الموجودة

**الخيار الموصى به:** إنشاء سكريبت إصلاح (fix script) يقرأ البيانات الحالية ويصححها.

```javascript
// scripts/fix-channels-binding.js
// هذا السكريبت يربط القنوات الموجودة بالمصادر المتاحة

const runtime = require('../src/runtime');
const channels = require('../src/channels');
const sources = require('../src/sources');
const storage = require('../src/storage');

async function fix() {
  await sources.load();
  await channels.load();
  
  const allChannels = runtime.getChannels({ enabled: true });
  const allSources = runtime.getSources({ enabled: true });
  
  // لكل قناة بدون primarySource
  for (const ch of allChannels) {
    if (ch.primarySource || ch.url) continue;
    
    // هل القناة لها اسم يطابق قناة في مصدر ما؟
    // أو استخدم SourceRepository.resolveStreamUrl لكل مصدر
    // ...
  }
}
```

**لكن:** بدون معرفة المصدر الأصلي للقنوات (أي M3U playlist تم استخدامه)، لا يمكننا استعادة Binding تلقائياً.

**الحل الفوري:** يجب إعادة استيراد المصادر.

### الخطوة 2: إعادة استيراد جميع المصادر المفعلة

```
POST /api/admin/sources/import-all
```

هذا سيستخدم `SourceRepository.importAllEnabled()` الذي يستدعي `importChannels()` لكل مصدر مفعل. الـ Binding سيعمل بشكل صحيح لأن الـ Import Pipeline سليم.

**النتيجة:** القنوات الجديدة ستنشأ مع `primarySource` + `primaryStreamId`. إذا كانت القنوات موجودة مسبقاً (بنفس `primaryStreamId`)، سيتم تحديثها.

### الخطوة 3: حذف القناة الفارغة

القناة `mru4t6ob2na8au` بدون اسم — يجب حذفها لأنها بلا فائدة.

## 10.2 Permanent Fix (إصلاح معماري دائم)

### 1. إضافة التحقق من Binding عند إنشاء القناة عبر Admin API

**الملف:** `src/api/admin.js`
**التغيير:** التحقق من وجود `primarySource` أو `url` عند إنشاء قناة جديدة.

```javascript
router.post('/channels', (req, res) => {
  const { primarySource, primaryStreamId, url } = req.body;
  if (!primarySource && !primaryStreamId && !url) {
    return res.status(400).json({
      error: 'Channel must have either a source reference (primarySource + primaryStreamId) or a direct URL'
    });
  }
  const ch = channels.add(req.body);
  ...
});
```

### 2. إضافة Startup Validation

**الملف:** `src/index.js`
**التغيير:** التحقق من صحة Binding بعد تحميل البيانات.

```javascript
async function main() {
  config.load();
  await sources.load();
  await channels.load();
  
  // تحقق من أن جميع القنوات المفعلة لديها مصدر
  const invalidChannels = runtime.getChannels({ enabled: true })
    .filter(ch => !ch.primarySource && !ch.primaryStreamId && !ch.url);
  
  if (invalidChannels.length > 0) {
    logger.warn(`Found ${invalidChannels.length} channels without source binding:`);
    for (const ch of invalidChannels) {
      logger.warn(`  - ${ch.name || ch.id}: no primarySource, no url`);
    }
  }
  ...
}
```

### 3. تخزين مصدر البيانات الوصفي لكل قناة

إضافة حقل `importedFrom` إلى القناة لتتبع مصدرها:

```javascript
{
  id: "...",
  name: "beIN MAX 1",
  importedFrom: "source-uuid",  // ← معرف المصدر الذي استورد هذه القناة
  primarySource: "source-uuid",
  primaryStreamId: "1471",
  ...
}
```

### 4. إزالة ازدواجية البيانات مع StreamEngine

توحيد `StreamEngine.channels` و `RuntimeRegistry._streams` في مصدر واحد.

## 10.3 Future Improvements (تحسينات مستقبلية)

### 1. Source Binding Model

فصل Binding إلى هيكل بيانات مستقل بدلاً من حقول مبعثرة في Channel:

```javascript
// هيكل مقترح: ChannelBinding
{
  channelId: "...",
  bindings: [
    { sourceId: "...", streamId: "...", priority: 1, label: "Primary", enabled: true },
    { sourceId: "...", streamId: "...", priority: 2, label: "Backup 1", enabled: true },
  ],
  directUrl: "http://...",  // اختياري
  directUrlHeaders: { referer, origin, ... }
}
```

### 2. Import Pipeline Test Suite

اختبارات تغطي:
- كل types المصادر (M3U, Xtream, Stalker, إلخ)
- التحقق من Binding بعد الاستيراد
- التحقق من Source Resolution
- التحقق من FFmpeg Startup

### 3. Health Check للـ Binding

`GET /api/health` يجب أن يتحقق من Binding ويعيد تحذير للقنوات بدون مصدر.

### 4. Gradual Cleanup

بعد إصلاح المشكلة، إعادة تفعيل Gradual Cleanup مع مراقبة دقيقة.

---

## 📊 جدول تنفيذ الإصلاح

| الأولوية | المهمة | الملف | التأثير |
|---------|--------|-------|---------|
| 🔴 فورية | إعادة استيراد المصادر | POST /api/admin/sources/import-all | يحل المشكلة فوراً |
| 🔴 فورية | حذف القناة الفارغة | DELETE /api/admin/channels/mru4t6ob2na8au | تنظيف البيانات |
| 🟡 دائمة | إضافة Validation في Admin API | `src/api/admin.js` | يمنع إنشاء قنوات بدون مصدر |
| 🟡 دائمة | إضافة Startup Validation | `src/index.js` | ينبه عند وجود قنوات بدون مصدر |
| 🟢 تحسين | إزالة ازدواجية StreamEngine | `src/stream-engine/index.js` | استقرار معماري |
| 🟢 تحسين | Source Binding Model | جديد | مرونة أعلى |
| 🟢 تحسين | Test Suite للـ Import | جديد | يمنع تكرار المشكلة |

---

## ✅ الخلاصة النهائية

**السبب الجذري للمشكلة تم إثباته بالأدلة من الكود ومن بيانات التشغيل:**

1. **القنوات الحالية (21 قناة) ليس لديها primarySource أو primaryStreamId أو url**
2. **هذا ليس خطأ في الكود الحالي — الكود (importChannels) يربط Binding بشكل صحيح**
3. **السبب: القنوات لم تُستورد عبر Import Pipeline، أو أُضيفت في إصدار سابق قبل إضافة Source References**
4. **الحل: إعادة استيراد المصادر عبر POST /api/admin/sources/import-all سيعيد إنشاء Binding بشكل صحيح**
5. **لمنع تكرار المشكلة: إضافة Validation في Admin API + Startup Validation**