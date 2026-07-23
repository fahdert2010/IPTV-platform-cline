# 🔍 Engine Audit — Mubasher Core Production Readiness Review

## المراجعة الشاملة للمحرك

---

> **التاريخ:** 23 يوليو 2026  
> **المراجع:** Principal Software Architect  
> **النطاق:** StreamEngine, RuntimeRegistry, HlsManager, SourceRepository, ChannelRepository, API, ViewerManager, HealthSystem  
> **الهدف:** تحديد جميع الأخطاء التصميمية، Race Conditions، Memory Leaks، مشاكل Recovery، نقاط الضعف

---

## 📑 فهرس المشاكل

| # | المشكلة | المكون | الخطورة | النوع |
|---|---------|--------|---------|-------|
| 1 | إيقاف مؤقت `_progressTimer` لا يتم تنظيفه عند الكراش | StreamEngine | 🔴 عالية | Memory Leak |
| 2 | `_playlistWatchInterval` لا يتم تنظيفه عند الكراش | StreamEngine | 🔴 عالية | Memory Leak |
| 3 | `_cleanupTimer` في StreamEngine يمسح قنوات قد تحتوي مشاهدين | StreamEngine | 🔴 عالية | Race Condition |
| 4 | ازدواجية البيانات بين `StreamEngine.channels` و `RuntimeRegistry._streams` | StreamEngine + RuntimeRegistry | 🟡 متوسطة | Design |
| 5 | `_syncRuntime()` تمسح القناة من Registry إذا كانت غير موجودة في StreamEngine | StreamEngine | 🔴 عالية | Data Loss |
| 6 | HLS Manager لا يطلق `_validatorTimer` عند الـ shutdown بشكل صحيح | HlsManager | 🟡 متوسطة | Resource Leak |
| 7 | `m3u_file` type غير معالج في SourceRepository (تم الإصلاح) | SourceRepository | 🔴 عالية | Missing Feature |
| 8 | `stalker` type له baseUrl ثابت قد لا يعمل | SourceRepository | 🟡 متوسطة | Logic Error |
| 9 | `testStream` و `probeStream` في Admin API يستخدمان `ch.url` مباشرة بدون Source Resolution | API | 🔴 عالية | Wrong Logic |
| 10 | Lazy Startup في `/hls/:channelId/index.m3u8` لا يمرر `viewerId` حقيقياً | API | 🟡 متوسطة | Design |
| 11 | Atomic Swap يمكن أن يفشل ويترك temp dir مبعثرة | HlsManager | 🟡 متوسطة | Cleanup |
| 12 | `viewer:connected` event في StreamEngine constructor لا يتحقق من وجود viewerId | StreamEngine | 🟡 متوسطة | Edge Case |
| 13 | `_startIdleTimer` يعيد تعيين idleTimer في كل `addViewer` مما يمنع الإيقاف الآلي | StreamEngine | 🟢 منخفضة | Logic |
| 14 | لا يوجد Health Check للـ Binding القنوات | HealthSystem | 🟢 منخفضة | Missing Feature |
| 15 | `getStreamUrl` في ChannelRepository يعيد `null` بدون log | ChannelRepository | 🟢 منخفضة | Debuggability |
| 16 | `shutdown()` في RuntimeRegistry لا يوقف `_pollTimer` (مؤقت system stats) | RuntimeRegistry | 🟢 منخفضة | Cleanup |

---

## 🔴 1. STREAMENGINE: `_progressTimer` لا يُنظف عند الكراش

### الملف: `src/stream-engine/index.js`
### الأسطر: 592-654

**المشكلة:**
عند بدء FFmpeg، يتم إنشاء `_progressTimer` لمراقبة playlist (فاصل زمني 500ms). هذا المؤقت يُنظف فقط في 3 حالات:
1. عند توقف القناة (`cs.state === STOPPED || cs.state === STOPPING`) سطر 593
2. عند اكتشاف الـ playlist (سطر 649)
3. في `proc.on('close')` سطر 684-687

لكن إذا حدث `proc.on('error')` (سطر 727-746) **لا يتم تنظيف `_progressTimer`**.

**الدليل:**
```javascript
// سطر 727-746
proc.on('error', (err) => {
  if (cs._progressTimer) {           // ← يتم تنظيفه هنا
    clearInterval(cs._progressTimer);
    cs._progressTimer = null;
  }
  if (cs._playlistWatchInterval) {
    clearInterval(cs._playlistWatchInterval);
    cs._playlistWatchInterval = null;
  }
  // ...
});
```

✅ هذا **مُعالَج** في الكود الحالي. المؤقتات تُنظف في `error` أيضاً.

### لكن هناك مشكلة حقيقية:

**عند `_handleDisconnect`** (سطر 372-413)، يتم إنشاء `cs._reconnectTimer = setTimeout(...)`. هذا المؤقت:
1. يُنظف في `_startFFmpeg()` سطر 561-565 ✅
2. يُنظف في `stop()` سطر 887 ✅
3. يُنظف في `_cleanupChannel()` سطر 133 ✅
4. لكن المؤقت الجديد `cs._playlistWatchInterval` (سطر 681) **لا يُنظف في `stop()`**

**الدليل:**
```javascript
// سطر 884-888 في stop()
if (cs._healthTimer) { clearInterval(cs._healthTimer); cs._healthTimer = null; }
if (cs._progressTimer) { clearInterval(cs._progressTimer); cs._progressTimer = null; }
if (cs._playlistWatchInterval) { clearInterval(cs._playlistWatchInterval); cs._playlistWatchInterval = null; }
if (cs._reconnectTimer) { clearTimeout(cs._reconnectTimer); cs._reconnectTimer = null; }
```

✅ **مُعالَج أيضاً!** الكود الحالي ينظف جميع المؤقتات عند `stop()`.

### المشكلة الحقيقية التي وجدتها:

**الـ `constructor` يستمع إلى `runtime.on('viewer:connected')` بدون تنظيف عند الـ shutdown:**

```javascript
// سطر 55-61
runtime.on('viewer:connected', (data) => {
  const ch = runtime.getChannel(data.viewer.currentChannel);
  if (ch && ch.enabled) {
    this.addViewer(data.viewer.currentChannel, ch, data.viewerId);
  }
});
```

في `shutdown()` (سطر 1043-1054):
```javascript
shutdown() {
  if (this._cleanupTimer) { clearInterval(this._cleanupTimer); this._cleanupTimer = null; }
  for (const [, cs] of this.channels) {
    // يوقف جميع المؤقتات
  }
  this.stopAll();
  hlsManager.shutdown();
}
```

**🚩 لا يزيل `runtime.on('viewer:connected')` listener.** إذا تم إنشاء StreamEngine جديد بعد shutdown، سيكون هناك مستمعان.

---

## 🔴 2. `_cleanupTimer` يمسح قنوات قد تحتوي مشاهدين

### الملف: `src/stream-engine/index.js`
### الأسطر: 64-74

```javascript
_startCleanup() {
  this._cleanupTimer = setInterval(() => {
    for (const [id, cs] of this.channels) {
      if (cs.state === STATES.STOPPED || cs.state === STATES.ERROR) {
        if (Date.now() - cs.lastStateChange > 120000) {
          this._cleanupChannel(id);    // ← يمسح القناة بالكامل
        }
      }
    }
  }, 30000);
}
```

**المشكلة:** `_cleanupChannel(id)` (سطر 125-143) يمسح القناة من `this.channels` Map بالكامل. إذا حدث أن قناة بحالة ERROR (بسبب فشل مؤقت في المصدر) كان لديها مشاهدين، فسيتم فقدانهم.

**لكن:** الكود يتحقق من `cs.state === STOPPED || cs.state === ERROR` فقط. القنوات في ONLINE لن تُمسح. هذا مقبول لـ ERROR لأن:
- إذا كانت ERROR ولا يوجد مشاهدين → ستنظف تلقائياً بعد 120 ثانية
- إذا كانت ERROR ويوجد مشاهدين → `_handleDisconnect` يجب أن يعيدها إلى RECONNECTING

**🚩 مشكلة حقيقية:** إذا فشل `_resolveSourceUrl()` (لا يوجد source URL)، القناة تنتقل إلى `ERROR` مباشرة (سطر 469-472). `_handleDisconnect` لا يُستدعى لأنه لا يوجد مصدر ليحاول مرة أخرى. المشاهدون يعلقون. بعد 120 ثانية، `_cleanupChannel` يمسحهم.

---

## 🔴 3. `_syncRuntime()` تمسح القناة من Registry إذا كانت غير موجودة في StreamEngine

### الملف: `src/stream-engine/index.js`
### الأسطر: 87-93

```javascript
_syncRuntime(channelId) {
  const cs = this.channels.get(channelId);
  if (!cs) {
    runtime.removeChannel(channelId);   // ← يمسح بيانات القناة!
    runtime.removeStream(channelId);
    return;
  }
  // ...
}
```

**🚩 مشكلة خطيرة:** إذا تم استدعاء `_syncRuntime()` لقناة غير موجودة في `this.channels` (Map الداخلي لـ StreamEngine)، فسيتم مسح بيانات القناة بالكامل من `RuntimeRegistry`.

**متى يحدث هذا؟**
- بعد `_cleanupChannel()` التي تمسح القناة من `this.channels` (سطر 137)
- ثم `_syncRuntime()` تُستدعى في أماكن متعددة

**الحل:** عدم مسح `runtime.removeChannel(channelId)` — فقط `runtime.removeStream()`.

---

## 🟡 4. ازدواجية البيانات بين StreamEngine.channels و RuntimeRegistry._streams

### الملفات: `src/stream-engine/index.js:49-50` و `src/runtime.js:29-30`

```javascript
// StreamEngine
this.channels = new Map(); // channelId → ChannelStream

// RuntimeRegistry 
this._streams = new Map(); // channelId → StreamState
```

**نفس البيانات في مكانين:**
- `state` → في `cs.state` و `stream.state`
- `pid` → في `cs.proc.pid` و `stream.pid`
- `viewers` → في `cs.viewers.size` و `stream.viewers`
- `currentUrl` → في `cs.currentUrl` و `stream.currentUrl`

**المزامنة عبر `_syncRuntime()` (سطر 87-123):**
- تستدعى في كل تغيير حالة
- لكنها ليست مضمونة في كل مرة (مثلاً، `_startFFmpeg()` تستدعيها مرة واحدة في النهاية)

**🚩 Race Condition:** إذا تغيرت حالة القناة بين استدعائين لـ `_syncRuntime()`، سيكون هناك عدم تطابق بين StreamEngine و RuntimeRegistry.

---

## 🟡 5. HLS Manager: `_validatorTimer` لا يُنظف إذا shutdown يُستدعى مرتين

### الملف: `src/hls-manager/index.js`
### الأسطر: 769-779

```javascript
shutdown() {
  if (this._cleanupTimer) {
    clearInterval(this._cleanupTimer);
    this._cleanupTimer = null;
  }
  if (this._validatorTimer) {
    clearInterval(this._validatorTimer);
    this._validatorTimer = null;
  }
  this._channels.clear();
  logger.info('HlsManager: shutdown complete');
}
```

✅ **مُعالَج.** لكن `shutdown()` يُستدعى من `StreamEngine.shutdown()` (سطر 1053). إذا تم استدعاء `hlsManager.shutdown()` مباشرة ثم `streamEngine.shutdown()` مرة أخرى، لن يحدث ضرر لأن `_validatorTimer = null` بعد التنظيف الأول.

---

## 🔴 6. Admin API: `testStream` و `probeStream` يستخدمان `ch.url` مباشرة

### الملف: `src/api/admin.js`
### الأسطر: 110-116, 168-182

```javascript
// سطر 113: test
const result = await healthSystem.testStream(ch.url);  // ← ch.url دائماً فارغ!

// سطر 176: bulk test
const health = await healthSystem.probeStream(ch.url);  // ← ch.url دائماً فارغ!
```

**🚩 هذه الدوال تستخدم `ch.url` مباشرة بدلاً من Source Resolution (primarySource + primaryStreamId).** في النظام الحالي، القنوات ليس لديها `url`، بل لديها `primarySource` و `primaryStreamId`. هذا يعني أن `testStream` و `bulk/test` سيفشلان دائماً لأن `ch.url` فارغ.

**الحل:** استخدام `ChannelRepository.getStreamUrl()` أو `SourceRepository.resolveStreamUrl()` بدلاً من `ch.url`.

---

## 🟡 7. Lazy Startup: `/hls/:channelId/index.m3u8` لا يمرر `viewerId` حقيقياً

### الملف: `src/api/index.js`
### الأسطر: 274

```javascript
await streamEngine.addViewer(channelId, channel, 'lazy_' + Date.now());
//                                                        ^^ viewerId وهمي
```

**المشكلة:** الـ `viewerId` المستخدم في Lazy Startup هو وهمي (`lazy_` + timestamp). هذا لا يسمح بـ:
1. تتبع المشاهد الحقيقي
2. ربط الجلسات
3. معرفة عدد المشاهدين الحقيقيين

**التأثير:** منخفض لأن Lazy Startup مؤقت (يُستخدم فقط لبدء FFmpeg). عندما يأتي المشاهد الحقيقي، سينشئ Viewer Manager جلسة حقيقية.

---

## 🟡 8. HLS Manager: Atomic Swap يترك `tempDir` إذا فشل

### الملف: `src/hls-manager/index.js`
### الأسطر: 544-578

```javascript
atomicSwap(channelId) {
  const ch = this._channels.get(channelId);
  if (!ch || !ch.tempDir) return false;

  try {
    // 1. Rename old dir to backup
    // 2. Rename temp dir to target
    // 3. Delete backup async
  } catch (err) {
    ch.tempDir = null;   // ← فقط null بدون تنظيف
    ch.swapInProgress = false;
    return false;
  }
}
```

**🚩 المشكلة:** إذا فشل الـ rename (مثلاً، بسبب صلاحية الملفات على Windows)، `ch.tempDir` يُصبح `null` لكن المجلد المؤقت يبقى على القرص. تراكم هذه المجلدات (`tmp_channelId_timestamp`) يستهلك مساحة.

**الحل الأفضل:** في `catch`، محاولة حذف المجلد المؤقت:
```javascript
catch (err) {
  try { fs.rmSync(ch.tempDir, { recursive: true, force: true }); } catch (_) {}
  ch.tempDir = null;
  ch.swapInProgress = false;
}
```

---

## 🟡 9. StreamEngine: `viewer:connected` event لا يتحقق من صحة `data`

### الملف: `src/stream-engine/index.js`
### الأسطر: 55-61

```javascript
runtime.on('viewer:connected', (data) => {
  const ch = runtime.getChannel(data.viewer.currentChannel);
  if (ch && ch.enabled) {
    this.addViewer(data.viewer.currentChannel, ch, data.viewerId);
  }
});
```

**🚩 مشكلة:** إذا كان `data.viewer` غير موجود (undefined)، `data.viewer.currentChannel` سيرمي TypeError. هذا سيؤدي إلى `uncaughtException` (الذي يتم التعامل معه في `src/index.js:47-49`).

---

## 🟢 10. ChannelRepository: `getStreamUrl` يعيد null بدون log

### الملف: `src/channels/index.js`
### الأسطر: 308-378

```javascript
getStreamUrl(channelId, sourcesRepo) {
  // ...
  // إذا فشل جميع المصادر:
  return null;  // ← بدون log!
}
```

**المشكلة:** `getStreamUrl` (المستخدم في `getStreamableChannels` سطر 383-392) يعيد `null` بدون أي تسجيل. هذا يجعل التصحيح صعباً لأن `getStreamableChannels` سيعيد قوائم ناقصة بصمت.

---

## 🟢 11. RuntimeRegistry: `shutdown()` لا يوقف `_pollTimer`

### الملف: `src/runtime.js`
### الأسطر: 772-784

```javascript
shutdown() {
  if (this._pollTimer) {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }
  this._events.removeAllListeners();
  this._channels.clear();
  this._sources.clear();
  this._streams.clear();
  this._viewers.clear();
  this._health.clear();
  this._logs = [];
}
```

✅ **مُعالَج.** الشفرة الحالية تنظف `_pollTimer`.

---

# خطة التنفيذ

## الأولوية 🔴 عالية (تؤثر على الاستقرار)

| # | المشكلة | الإصلاح | الملفات | الجهد |
|---|---------|---------|---------|-------|
| 1 | `_cleanupTimer` يمسح قنوات ERROR بمشاهدين | إضافة تحقق من `cs.viewers.size === 0` قبل `_cleanupChannel` | `src/stream-engine/index.js:66-70` | دقيقة |
| 2 | `_syncRuntime()` تمسح القناة من Registry | استبدال `runtime.removeChannel()` بـ `runtime.removeStream()` فقط | `src/stream-engine/index.js:90` | دقيقة |
| 3 | `testStream` و `probeStream` يستخدمان `ch.url` | استخدام `ChannelRepository.getStreamUrl()` أو Source Resolution | `src/api/admin.js:113, 176` | 10 دقائق |
| 4 | `viewer:connected` event بدون تحقق من `data.viewer` | إضافة `if (!data || !data.viewer) return` | `src/stream-engine/index.js:56` | دقيقة |
| 5 | Atomic Swap يترك temp dir إذا فشل | إضافة `fs.rmSync` في catch | `src/hls-manager/index.js:573` | دقيقة |

## الأولوية 🟡 متوسطة (تؤثر على القابلية للتوسع)

| # | المشكلة | الإصلاح | الجهد |
|---|---------|---------|-------|
| 6 | Streaming constructor listener leak | إزالة listener في shutdown | دقيقة |
| 7 | `getStreamUrl` لا يسجل الأخطاء | إضافة log عند return null | دقيقة |
| 8 | Lazy Startup viewerId وهمي | تمرير viewerId حقيقي من الطلب | 5 دقائق |

## الأولوية 🟢 منخفضة (تحسينات)

| # | المشكلة | الإصلاح | الجهد |
|---|---------|---------|-------|
| 9 | لا يوجد Health Check للـ Binding | إضافة فحص في Health endpoint | 5 دقائق |
| 10 | `stalker` baseUrl قد لا يعمل | مراجعة منطق Stalker/MAG | 15 دقيقة |