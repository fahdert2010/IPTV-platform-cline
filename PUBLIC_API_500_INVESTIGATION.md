# 📋 تحقيق: لماذا `/api/public/channels` يرجع 500؟

## ملخص سريع

**السبب الجذري:** `src/api/public.js` السطر 6 يستخدم `require('../sources').default` مما يجعل `sources = undefined`. عندما يحاول الـ endpoint استدعاء `sources.resolveStreamUrl()` في السطر 57، يحدث `TypeError: Cannot read properties of undefined (reading 'resolveStreamUrl')`.

## التحقيق الكامل

### 1. الكود الكامل لـ route `GET /api/public/channels`

**الملف:** `src/api/public.js`
**الأسطر:** 48-94

```javascript
router.get('/channels', (req, res) => {
  try {
    const channelsList = runtime.getChannels({ enabled: true });     // ← LINE 50: ✅ يعمل

    const enriched = channelsList.map(ch => {                        // ← LINE 53: ✅ channelsList = 692 قناة
      let resolvedUrl = null;
      if (ch.primarySource && ch.primaryStreamId) {                  // ← LINE 56: ✅ القنوات الآن لها binding
        resolvedUrl = sources.resolveStreamUrl(                      // ← LINE 57: 💥 sources = undefined!
          ch.primarySource, ch.primaryStreamId
        );
      }
      ...
    });
    ...
  } catch (err) {
    logger.error('Public channels error:', err);                     // ← LINE 92: يسجل الخطأ
    res.status(500).json({ error: 'Internal server error' });        // ← LINE 93: يعيد 500
  }
});
```

### 2. الـ Stack Trace الكامل المتوقع

```
TypeError: Cannot read properties of undefined (reading 'resolveStreamUrl')
    at router.get.channelsList.map.ch (src/api/public.js:57:24)
    at Array.map (<anonymous>)
    at router.get (src/api/public.js:53:36)
    ...
```

### 3. السطر الذي يرمي الخطأ تحديداً

**السطر 57 من `src/api/public.js`:**
```javascript
resolvedUrl = sources.resolveStreamUrl(ch.primarySource, ch.primaryStreamId);
```

### 4. لماذا يحدث الخطأ

**الملف:** `src/api/public.js` — السطر 6
```javascript
const sources = require('../sources').default;
```

المتغير `sources = undefined` لأن:
- `src/sources/index.js` يصدر: `module.exports = new SourceRepository()` (CommonJS)
- لا يوجد `exports.default`
- في CommonJS، `require()` يعيد `module.exports` مباشرة
- `require('../sources').default` هو `undefined`

### 5. مقارنة بين `/api/admin/channels` و `/api/public/channels`

| الخاصية | `/api/admin/channels` | `/api/public/channels` |
|---------|----------------------|----------------------|
| **الملف** | `src/api/admin.js` | `src/api/public.js` |
| **import sources** | `const sources = require('../sources');` ✅ | `const sources = require('../sources').default;` ❌ |
| **sources value** | ✅ SourceRepository instance | ❌ `undefined` |
| **يستخدم sources.resolveStreamUrl()?** | لا (يستخدم `channels.getStreamUrl()`) | ✅ نعم (السطر 57) |
| **النتيجة** | ✅ يعمل (200) | ❌ يفشل (500) |

### 6. لماذا admin.js يعمل و public.js لا

في `admin.js`:
```javascript
const sources = require('../sources');  // ✅ صحيح
router.post('/channels/:id/test', ...) {
  const streamUrl = channels.getStreamUrl(ch.id, sources);  // يمرر sources كـ parameter
}
```

في `public.js`:
```javascript
const sources = require('../sources').default;  // ❌ undefined
router.get('/channels', ...) {
  resolvedUrl = sources.resolveStreamUrl(...);  // 💥 TypeError
}
```

**الفرق الجوهري:** `admin.js` يستخدم `require('../sources')` بدون `.default`، بينما `public.js` يستخدم `.default`.

### 7. كم عدد الملفات المتأثرة بـ `.default`؟

| الملف | السطر | الكود | الحالة |
|-------|-------|-------|--------|
| `src/api/index.js` | 29 | `require('../sources').default` | ✅ تم الإصلاح |
| `src/api/public.js` | 6 | `require('../sources').default` | ❌ لم يُصلح بعد |
| جميع الملفات الأخرى | - | `require('../sources')` بدون `.default` | ✅ سليمة |

## التأثيرات المتسلسلة (Cascading Effects)

بما أن `/api/public/channels` يرجع 500:
1. ✅ التقرير السابق قال "السبب الجذري هو أن `/api/public/channels` نفسه مكسور" — صحيح
2. الـ Viewer لا يستطيع تحميل القنوات → يظهر "خطأ في تحميل القنوات"
3. لا يمكن للمشاهدين مشاهدة أي شيء
4. عداد المشاهدين = 1 هو lazy viewer وهمي (من HLS Lazy Startup)

## الإصلاح

```javascript
// src/api/public.js — السطر 6
// قبل:
const sources = require('../sources').default;
// بعد:
const sources = require('../sources');
```

## الاختبار

بعد الإصلاح، `/api/public/channels` سيعيد:
- `200 OK` مع 692 قناة
- كل قناة ستحتوي على `resolvedUrl` (إما URL محلول من المصدر أو null)
- الـ Viewer سيتمكن من عرض القنوات