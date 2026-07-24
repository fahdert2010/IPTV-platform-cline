# 📋 التقرير المعماري الكامل — IPTV Platform (Mubasher Core v2.0)
## Full Architecture & Root Cause Analysis Report

---

> **تاريخ التقرير:** 23 يوليو 2026  
> **النسخة:** v2.0.0  
> **الغرض:** تدقيق شامل لجميع المشاكل المبلغ عنها

---

## 📑 فهرس التقرير

1. [TASK 1: undefined objects](#1-task-1-investigate-undefined-objects)
2. [TASK 2: Dependency Injection Architecture Audit](#2-task-2-dependency-injection-architecture-audit)
3. [TASK 3: M3U Upload Lifecycle](#3-task-3-m3u-upload-lifecycle-baseurl-vs-url)
4. [TASK 4: WWW-Authenticate Login Popup — التحقيق الكامل](#4-task-4-www-authenticate-login-popup--التحقيق-الكامل)
5. [TASK 5: Root Cause Summary & Fix Strategy](#5-task-5-root-cause-summary--fix-strategy)

---

# 1. TASK 1: Investigate undefined objects

## 1.1 `src/api/admin.js` — جميع الـ imports سليمة

| السطر | المتغير | المسار | الحالة |
|-------|---------|--------|--------|
| 3-13 | `express, config, storage, logger, runtime, sources, channels, streamEngine, viewerManager, healthSystem, cache` | `require(...)` | ✅ كلها صحيحة |

**الخلاصة:** لا يوجد undefined في `admin.js` نفسه.

## 1.2 ⛔ BUG #1: `src/api/index.js` — `require('../sources').default`

**الملف:** `src/api/index.js` — السطر 29
```javascript
const sources = require('../sources').default;
// sources = undefined !!!
```

**السبب:** `src/sources/index.js` يُصدر:
```javascript
module.exports = new SourceRepository();
```
هذا CommonJS عادي. لا يوجد خاصية `default` على `module.exports`.

**التأثير:** `sources = undefined` → أي استخدام لـ `sources` في `api/index.js` يسبب `Cannot read properties of undefined`.

---

# 2. TASK 2: Dependency Injection Architecture Audit

تم توثيق خريطة الاعتماديات الكاملة في التقرير السابق. الخلاصة:

- **النمط:** Global Singleton Registry (كل وحدة = `module.exports = new ClassName()`)
- **Circular Dependencies:** لا يوجد circular dependency صريح، لكن `sources/index.js` يستخدم `require('../channels')` بشكل كسول (lazy) لتجنب circular dependency
- **Duplicate State:** StreamEngine يحتفظ بـ `this.channels` (حالة FFmpeg) و RuntimeRegistry يحتفظ بـ `_streams` — مصدران منفصلان لنفس البيانات

---

# 3. TASK 3: M3U Upload Lifecycle (baseUrl vs url)

## 3.1 ⛔ BUG #2: Field Name Mismatch

```
Upload endpoint → sources.add({ type: 'm3u_file', url: filePath })
                                                       ↑↑↑
SourceRepository.add() → runtime.setSource(id, { baseUrl: data.baseUrl || '' })
                                                   ↑↑↑↑↑↑↑
```

**الملف:** `src/api/admin.js` — الأسطر 447، 468
**الملف:** `src/sources/index.js` — السطر 89

**السبب:** الـ upload endpoint يمرر `url` لكن `add()` يقرأ `baseUrl`.
**النتيجة:** `source.baseUrl = ''` → `_importM3U()` يفشل → "No valid source URL or file path"
**الإصلاح:** تغيير `url: filePath` → `baseUrl: filePath`

---

# 4. TASK 4: WWW-Authenticate Login Popup — التحقيق الكامل

## 4.1 البحث الشامل عن `WWW-Authenticate`

تم البحث في جميع ملفات المشروع (js, html, json) عن النمط `WWW-Authenticate` ووجدنا **مصدر واحد فقط**:

| # | الملف | السطر | النص الكامل |
|---|-------|-------|-------------|
| 1 | `src/api/admin.js` | 22 | `res.setHeader('WWW-Authenticate', 'Basic realm="Mubasher Core"');` |

**لا يوجد أي مصدر آخر لـ `WWW-Authenticate` في المشروع كاملاً.**

## 4.2 البحث الشامل عن `status(401)` — كل المسارات التي تعيد 401

تم البحث عن `status(401)` ووجدنا **موقعين فقط**:

### الموضع 1: `src/api/admin.js` — Auth Middleware (السطر 18-31)

```javascript
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Mubasher Core"');  // ← LINE 22
    return res.status(401).json({ error: 'Authentication required' });
  }
  ...
});
```

**الخصائص:**
- **الطريق (Route):** ALL routes under `/api/admin/*` (بما أن هذا middleware يعمل على جميع الطرق)
- **نوع الـ Middleware:** `router.use()` — أي جميع الطرق التي تبدأ بـ `/api/admin/`
- **حالة الـ HTTP:** `401`
- **الهيدرز:** `WWW-Authenticate: Basic realm="Mubasher Core"` ← **هذا هو سبب الـ popup**
- **JSON Body:** `{ "error": "Authentication required" }`
- **التردد:** كل طلب لا يحتوي على `Authorization` هيدر صحيح

### الموضع 2: `src/api/index.js` — SSE Endpoint (السطر 430-441)

```javascript
router.get('/admin/events', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authentication required' });
    // ↑↑↑ لا يوجد WWW-Authenticate header هنا
  }
  ...
});
```

**الخصائص:**
- **الطريق (Route):** `GET /api/admin/events`
- **نوع الـ Middleware:** محدد لهذا المسار فقط
- **حالة الـ HTTP:** `401`
- **الهيدرز:** لا يوجد `WWW-Authenticate` ← **لا يسبب popup**
- **JSON Body:** `{ "error": "Authentication required" }`

## 4.3 جدول: كل مسار يعيد 401

| المسار الكامل | الملف | السطر | WWW-Authenticate | يسبب Popup | JSON Body |
|---------------|-------|-------|------------------|------------|-----------|
| `GET/POST/PUT/DELETE /api/admin/*` | `src/api/admin.js` | 22 | ✅ `Basic realm="Mubasher Core"` | ✅ **نعم** | `{ error: 'Authentication required' }` |
| `GET /api/admin/events` | `src/api/index.js` | 434 | ❌ لا يوجد | ❌ لا | `{ error: 'Authentication required' }` |

## 4.4 التحقق من المصادر الخارجية المحتملة

| المصدر | هل يمكن أن يسبب WWW-Authenticate؟ | الدليل |
|--------|-----------------------------------|--------|
| **Express** | ❌ لا | Express لا يضيف `WWW-Authenticate` تلقائياً |
| **Nginx/Apache** | ❌ غير مثبت | لا يوجد reverse proxy في التثبيت الحالي |
| **Cloudflare** | ❌ غير مستخدم | لا يوجد |
| **Service Worker** | ❌ غير موجود | لا يوجد ملفات SW |
| **Browser Cache** | ❌ لا | الـ popup سببه استجابة الخادم |
| **Reverse Proxy** | ❌ غير موجود | لا يوجد |

## 4.5 ⛔ BUG #3: تأكيد السبب الجذري

```
╔══════════════════════════════════════════════════════════════╗
║                    BUG #3: تأكيد                             ║
║                                                              ║
║  المصدر الوحيد لـ WWW-Authenticate:                          ║
║  src/api/admin.js — السطر 22                                 ║
║                                                              ║
║  يستهدف: ALL routes under /api/admin/*                       ║
║  (بما في ذلك /admin/dashboard, /admin/channels, ...)         ║
║                                                              ║
║  يحدث عندما: يرسل المتصفح طلباً بدون Authorization هيدر       ║
║                                                              ║
║  الترتيب:                                                     ║
║    1. المستخدم يفتح /admin في المتصفح                        ║
║    2. المتصفح يرسل طلب GET لـ /api/admin/dashboard            ║
║       (بسبب admin.js: api('/admin/dashboard'))               ║
║    3. الخادم يعيد:                                           ║
║       HTTP/1.1 401 Unauthorized                              ║
║       WWW-Authenticate: Basic realm="Mubasher Core"          ║
║    4. 🚨 المتصفح يظهر نافذة Basic Auth الأصلية 🚨           ║
║                                                              ║
║  لماذا: لأن هيدر WWW-Authenticate موجه للمتصفحات             ║
║  التقليدية، وليس لتطبيقات SPA.                               ║
║                                                              ║
║  الإصلاح: إزالة res.setHeader('WWW-Authenticate', ...)       ║
╚══════════════════════════════════════════════════════════════╝
```

## 4.6 كيف يعمل الـ SPA Authentication حالياً

**الملف:** `src/admin/admin.js` — الأسطر 11-21

```
1. المستخدم يدخل username + password في نموذج SPA
2. admin.js يشفرهم: AUTH = 'Basic ' + btoa(u + ':' + p)
3. admin.js يرسل: api('/admin/dashboard') ← GET /api/admin/dashboard
4. الخادم يتحقق من Authorization هيدر
5. إذا صحيح → يعيد البيانات ← SPA تظهر
6. إذا خطأ → يعيد 401 بدون WWW-Authenticate (بعد الإصلاح) ← SPA تظهر نموذج تسجيل الدخول
```

**المشكلة:** قبل أن يرسل المستخدم النموذج، لا يوجد `Authorization` هيدر. لذلك:
1. `api('/admin/dashboard')` يرسل GET بدون Auth
2. الخادم يعيد 401 مع `WWW-Authenticate`
3. 🚨 المتصفح يظهر Basic Auth popup قبل أن تصل الاستجابة إلى `admin.js`

## 4.7 لماذا التقرير السابق كان غير دقيق؟

في التقرير السابق، تم تحديد:
- BUG #3: `src/api/admin.js:22` — `WWW-Authenticate` ✅ صحيح
- ولكن تم ذكر BUG #4: `src/api/index.js:430-441` — "منطق مصادقة مكرر"

**التصحيح:** الـ SSE endpoint في `src/api/index.js` (السطر 433-434) يعيد `status(401)` **بدون** `WWW-Authenticate`. هذا لا يسبب popup. لكنه **مكرر** ويجب توحيده مع middleware في `admin.js`.

**المصدر الوحيد لـ popup هو `src/api/admin.js:22` فقط.**

---

# 5. TASK 5: Root Cause Summary & Fix Strategy

## 5.1 جميع البق (Bugs) مع الأدلة الكاملة

### 🔴 BUG #1: `require('../sources').default` ← undefined

| الحقل | القيمة |
|-------|--------|
| **الملف** | `src/api/index.js` |
| **السطر** | 29 |
| **الكود** | `const sources = require('../sources').default;` |
| **السبب** | لا يوجد `exports.default` في `sources/index.js` (CommonJS) |
| **التأثير** | `sources = undefined` → أي استخدام يسبب `Cannot read properties of undefined` |
| **الدليل** | `module.exports = new SourceRepository()` — لا يوجد `.default` |
| **الإصلاح** | `const sources = require('../sources');` |
| **Risk** | 🟢 Low |

### 🔴 BUG #2: `url` vs `baseUrl` mismatch

| الحقل | القيمة |
|-------|--------|
| **الملف** | `src/api/admin.js` |
| **السطر** | 447, 468 |
| **الكود** | `sources.add({ name, type: 'm3u_file', url: filePath })` |
| **السبب** | `SourceRepository.add()` يقرأ `data.baseUrl` وليس `data.url` |
| **التأثير** | `source.baseUrl = ''` → `_importM3U()` يفشل → "No valid source URL or file path" |
| **الدليل** | `baseUrl: data.baseUrl || ''` في `sources/index.js:89` |
| **الإصلاح** | تغيير `url: filePath` → `baseUrl: filePath` |
| **Risk** | 🟢 Low |

### 🟡 BUG #3: WWW-Authenticate popup

| الحقل | القيمة |
|-------|--------|
| **الملف** | `src/api/admin.js` |
| **السطر** | 22 |
| **الكود** | `res.setHeader('WWW-Authenticate', 'Basic realm="Mubasher Core"');` |
| **السبب** | هيدر `WWW-Authenticate` يخبر المتصفح بعرض Basic Auth popup |
| **التأثير** | المتصفح يظهر نافذة تسجيل دخول أصلية بدلاً من نموذج SPA |
| **الدليل** | هذا هو الموقع الوحيد في المشروع الذي يرسل هذا الهيدر |
| **الإصلاح** | إزالة السطر 22 بالكامل |
| **Risk** | 🟢 Low |

### 🟢 BUG #4: Duplicate auth logic في SSE endpoint

| الحقل | القيمة |
|-------|--------|
| **الملف** | `src/api/index.js` |
| **السطر** | 430-441 |
| **الكود** | منطق مصادقة مكرر لـ `GET /api/admin/events` |
| **السبب** | هذا المسار خارج `adminRouter` لذا لا يمر عبر middleware في `admin.js` |
| **التأثير** | كود مكرر، لا يسبب popup لكنه غير Maintainable |
| **الدليل** | المسار `/api/admin/events` لا يمر عبر `router.use('/admin', adminRouter)` بل عبر `router.get('/admin/events', ...)` |
| **الإصلاح** | نقل هذا المسار إلى `admin.js` |
| **Risk** | 🟡 Medium |

## 5.2 خريطة تدفق كيفية ظهور الـ Popup

```
المتصفح يفتح http://localhost:3001/admin
    │
    ▼
GET /admin ← Express يخدم الملف الثابت src/admin/index.html
    │
    ▼
index.html يحمل admin.js
    │
    ▼
admin.js ينفذ: init() → loadOverview() → api('/admin/dashboard')
    │
    ▼
GET /api/admin/dashboard ← (من غير Authorization هيدر لأن المستخدم لم يسجل بعد)
    │
    ▼
يصل إلى adminRouter (src/api/admin.js)
    │
    ▼
يمر عبر auth middleware (السطر 18-31)
    │
    ├── auth = undefined (لا يوجد هيدر)
    ├── !auth.startsWith('Basic ') → true
    │
    ▼
res.setHeader('WWW-Authenticate', 'Basic realm="Mubasher Core"')  ← 🚨
return res.status(401).json({ error: 'Authentication required' })
    │
    ▼
المتصفح يستقبل الاستجابة
    │
    ├── يرى WWW-Authenticate: Basic
    ├── 🚨 يظهر نافذة Basic Auth الأصلية 🚨
    └── لا يمرر الاستجابة إلى admin.js (admin.js لن يراها أبداً)
```

## 5.3 الإصلاحات المطلوبة

### الإصلاح 1: `src/api/admin.js` — السطر 22
```javascript
// قبل:
res.setHeader('WWW-Authenticate', 'Basic realm="Mubasher Core"');
return res.status(401).json({ error: 'Authentication required' });

// بعد:
return res.status(401).json({ error: 'Authentication required' });
```

### الإصلاح 2: `src/api/index.js` — السطر 29
```javascript
// قبل:
const sources = require('../sources').default;

// بعد:
const sources = require('../sources');
```

### الإصلاح 3: `src/api/admin.js` — الأسطر 447، 468
```javascript
// قبل:
const src = sources.add({ name, type: 'm3u_file', url: filePath });

// بعد:
const src = sources.add({ name, type: 'm3u_file', baseUrl: filePath });
```

## 5.4 Regression Risk Analysis

| الإصلاح | Risk | السبب |
|---------|------|-------|
| Fix 1: إزالة WWW-Authenticate | 🟢 **Low** | SPA لا يعتمد على هذا الهيدر على الإطلاق. `admin.js` يتحقق من `res.status === 401` فقط |
| Fix 2: إزالة `.default` | 🟢 **Low** | `sources` سيصبح معرفاً بشكل صحيح. لا يوجد كود يعتمد على `sources = undefined` |
| Fix 3: `url` → `baseUrl` | 🟢 **Low** | `SourceRepository.add()` يتوقع `baseUrl`. هذا يجعل M3U upload يعمل |

---

## ملخص تنفيذي (Executive Summary)

```
┌────────────────────────────────────────────────────────────────┐
│                    ملخص التقرير المعماري                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  🔴 BUG #1: require('../sources').default                      │
│     الملف: src/api/index.js:29                                 │
│     التأثير: sources = undefined → Cannot read properties      │
│                                                                │
│  🔴 BUG #2: url vs baseUrl mismatch                            │
│     الملف: src/api/admin.js:447, 468                           │
│     التأثير: M3U upload يفشل مع "No valid source URL"          │
│                                                                │
│  🟡 BUG #3: WWW-Authenticate popup (المصدر الوحيد)             │
│     الملف: src/api/admin.js:22                                 │
│     التأثير: المتصفح يظهر نافذة Basic Auth أصلية               │
│     الدليل: هذا هو الموقع الوحيد في المشروع الذي يرسل الهيدر   │
│                                                                │
│  🟢 BUG #4: Duplicate auth in SSE endpoint                     │
│     الملف: src/api/index.js:430-441                            │
│     التأثير: كود مكرر (لكن لا يسبب popup)                      │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  الإصلاحات العاجلة (Immediate):                                 │
│  Fix 1: src/api/admin.js → إزالة WWW-Authenticate header       │
│  Fix 2: src/api/index.js → إزالة .default                      │
│  Fix 3: src/api/admin.js → url → baseUrl                       │
│  جميعها منخفضة المخاطر (Low Risk)                               │
└────────────────────────────────────────────────────────────────┘
```

---

*تم إعداد هذا التقرير بواسطة Cline (AI Architect) في 23 يوليو 2026*
*المصادر: src/api/admin.js, src/api/index.js, src/sources/index.js, src/channels/index.js, src/runtime.js, src/stream-engine/index.js, src/index.js, src/storage/index.js, src/admin/admin.js, src/admin/index.html, config/default.json, package.json*