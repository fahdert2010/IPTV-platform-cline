'use strict';

/* Mubasher Core — Viewer Player (Full) */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));

let SETTINGS = {};
let CHANNELS = [];
let hls = null;
let currentChannel = null;
let activeCategory = '';
let cpuSaver = false;
let searchQuery = '';
let heartbeatTimer = null;
let retryTimer = null;
let retryCount = 0;
const clientId = 'mc_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);

// ==================== Init ====================

async function init() {
  // Show player container immediately (even before loading channels)
  $('#playerSection').classList.remove('hidden');

  try {
    const res = await fetch('/api/public/settings');
    const data = await res.json();
    SETTINGS = data.settings || {};
  } catch (e) {
    console.warn('Failed to load settings');
  }

  document.title = 'Mubasher Core — البث المباشر';
  if (SETTINGS.siteName) $('#siteTitle').textContent = SETTINGS.siteName;
  if (SETTINGS.ticker) {
    $('#tickerText').textContent = SETTINGS.ticker;
    $('#tickerBar').classList.remove('hidden');
  }

  cpuSaver = !!SETTINGS.cpuSaverDefault;
  $('#cpuSaver').checked = cpuSaver;

  await loadChannels();
  setInterval(loadChannels, 30000);
  setupControls();
  setupSearch();
  initPlayer();
}

// ==================== Player Init ====================

function initPlayer() {
  const video = $('#video');
  // Always show player, ready for first channel
  showWelcome();
}

function showWelcome() {
  // Show a welcome message until a channel is selected
  const statusEl = document.getElementById('playerStatus');
  if (statusEl) {
    statusEl.classList.remove('hidden');
    document.getElementById('psIcon').textContent = '📺';
    document.getElementById('psTitle').textContent = 'Mubasher Core';
    document.getElementById('psSub').textContent = 'اختر قناة من القائمة لبدء المشاهدة';
  }
  hideLoading();
}

function hideWelcome() {
  const statusEl = document.getElementById('playerStatus');
  if (statusEl) statusEl.classList.add('hidden');
}

// ==================== Channels ====================

async function loadChannels() {
  try {
    const res = await fetch('/api/public/channels');
    const data = await res.json();
    CHANNELS = data.channels || [];
  } catch (e) {
    console.error('Failed to load channels:', e);
    showChannelError('تعذر تحميل القنوات', 'تأكد من أن الخادم يعمل وأنه تم استيراد قنوات.');
    return;
  }
  renderCats();
  renderGrid();
}

function showChannelError(title, msg) {
  const grid = $('#channelGrid');
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:40px 20px">
      <div style="font-size:40px;margin-bottom:12px">⚠️</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:6px">${esc(title)}</div>
      <div style="font-size:13px;color:var(--muted)">${esc(msg)}</div>
    </div>`;
  $('#emptyMsg').classList.add('hidden');
}

function renderCats() {
  const cats = [...new Set(CHANNELS.map(c => c.category || c.group).filter(Boolean))];
  const box = $('#catFilters');
  if (!cats.length) {
    box.innerHTML = '';
    return;
  }

  const btn = (val, label) =>
    `<button class="cat-btn ${activeCategory === val ? 'active' : ''}" data-cat="${esc(val)}">${esc(label)}</button>`;

  box.innerHTML = btn('', 'الكل') + cats.map(c => btn(c, c)).join('');

  box.querySelectorAll('.cat-btn').forEach(b => {
    b.onclick = () => {
      activeCategory = b.dataset.cat;
      renderCats();
      renderGrid();
    };
  });
}

function renderGrid() {
  let list = CHANNELS.filter(c => !activeCategory || (c.category || c.group) === activeCategory);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q));
  }

  if (CHANNELS.length === 0) {
    showChannelError('لا توجد قنوات', 'المخزن فارغ. اذهب إلى لوحة الإدارة وأضف مصدراً أو استورد قائمة M3U.');
    return;
  }

  if (list.length === 0) {
    showChannelError('لا توجد نتائج', (searchQuery ? 'لا توجد قنوات تطابق بحثك' : 'لا توجد قنوات في هذه المجموعة'));
    return;
  }

  $('#emptyMsg').classList.add('hidden');

  $('#channelGrid').innerHTML = list.map(c => `
    <div class="card ${c.id === (currentChannel && currentChannel.id) ? 'card-active' : ''}" tabindex="0" role="button" data-id="${c.id}" aria-label="تشغيل ${esc(c.name)}">
      ${c.tvgLogo || c.cover
        ? `<img class="card-cover" loading="lazy" src="${esc(c.tvgLogo || c.cover)}" alt="" onerror="this.src='';this.classList.add('ph')">`
        : `<div class="card-cover ph">📺</div>`}
      <div class="card-body">
        <p class="card-name">${esc(c.name)}</p>
        <div class="card-meta">
          <span>${esc(c.category || c.group || '')}</span>
          <span class="badge badge-live">مباشر</span>
        </div>
      </div>
    </div>`).join('');

  document.querySelectorAll('.card').forEach(el => {
    const open = () => playChannel(el.dataset.id);
    el.onclick = open;
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    };
  });
}

function setupSearch() {
  const input = $('#searchInput');
  if (!input) return;
  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      searchQuery = input.value.trim();
      renderGrid();
    }, 300);
  });
}

// ==================== Player ====================

function hlsConfig() {
  const base = {
    maxBufferLength: Number(SETTINGS.playerMaxBufferLength || 20),
    backBufferLength: Number(SETTINGS.playerBackBufferLength || 10),
    liveSyncDuration: Number(SETTINGS.playerLiveSyncDuration || 4),
    capLevelToPlayerSize: !!SETTINGS.capLevelToPlayerSize,
    maxMaxBufferLength: 30,
    liveDurationInfinity: true,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 500,
    levelLoadingMaxRetry: 6,
    levelLoadingRetryDelay: 500,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 500,
    startFragPrefetch: true,
    enableWorker: true,
    lowLatencyMode: false
  };

  if (cpuSaver) {
    base.maxBufferLength = Math.min(base.maxBufferLength, 12);
    base.backBufferLength = 0;
    base.capLevelToPlayerSize = true;
    base.startLevel = 0;
  }

  return base;
}

function ensurePlayer() {
  $('#playerSection').classList.remove('hidden');
  const video = $('#video');

  if (!video._loadingWired) {
    video._loadingWired = true;
    video.addEventListener('playing', hideLoading);
    video.addEventListener('canplay', () => { hideLoading(); hideError(); });
    video.addEventListener('waiting', showLoading);
    video.addEventListener('stalled', showLoading);
    video.addEventListener('error', () => {
      showError('خطأ في تشغيل الفيديو', 'قد يكون المصدر غير متوافق');
    });
  }

  if (window.Hls && Hls.isSupported()) {
    if (!hls) {
      hls = new Hls(hlsConfig());
      hls.attachMedia(video);
      wireHlsEvents();
    }
    return 'hls';
  }
  // Native HLS (Safari)
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    return 'native';
  }
  return null;
}

function showLoading() {
  const el = document.getElementById('playerLoading');
  if (el) el.classList.remove('hidden');
  document.getElementById('playerError')?.classList.add('hidden');
}

function hideLoading() {
  const el = document.getElementById('playerLoading');
  if (el) el.classList.add('hidden');
  retryCount = 0;
}

function showError(title, sub) {
  hideLoading();
  document.getElementById('playerError')?.classList.remove('hidden');
  document.getElementById('peTitle').textContent = title || 'تعذر تشغيل البث';
  document.getElementById('peSub').textContent = sub || 'قد يكون المصدر غير متاح حالياً';
}

function hideError() {
  document.getElementById('playerError')?.classList.add('hidden');
}

function showMsg(t) {
  const m = $('#playerMsg');
  if (!m) return;
  m.textContent = t;
  m.classList.remove('hidden');
}

function hideMsg() {
  const m = $('#playerMsg');
  if (m) m.classList.add('hidden');
}

function scheduleRetry() {
  retryCount++;
  const delay = Math.min(2000 * Math.pow(2, Math.min(retryCount, 4)), 30000);
  showMsg(`إعادة المحاولة خلال ${Math.round(delay / 1000)} ثوانٍ...`);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (currentChannel) {
      hideMsg();
      loadIntoPlayer(currentChannel);
    }
  }, delay);
}

function wireHlsEvents() {
  hls.on(Hls.Events.MANIFEST_PARSED, (ev, data) => {
    $('#video').play().catch(() => {});
    hideMsg();
    hideError();
    hideWelcome();
    if (data.levels && data.levels.length > 0) {
      const level = data.levels[0];
      const qEl = $('#npQuality');
      if (qEl) {
        qEl.classList.remove('hidden');
        qEl.textContent = level.width ? `${level.width}x${level.height}` : `${level.height}p`;
      }
    }
  });

  hls.on(Hls.Events.LEVEL_SWITCHED, (ev, data) => {
    if (hls.levels && hls.levels[data.level]) {
      const level = hls.levels[data.level];
      const qEl = $('#npQuality');
      if (qEl) {
        qEl.classList.remove('hidden');
        qEl.textContent = level.width ? `${level.width}x${level.height}` : `${level.height}p`;
      }
    }
  });

  hls.on(Hls.Events.ERROR, (ev, data) => {
    if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
      showMsg('انقطاع مؤقت في البث...');
      setTimeout(hideMsg, 3000);
      return;
    }
    if (data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
      showMsg('بطء في التحميل... إعادة المحاولة');
      hls.stopLoad();
      setTimeout(() => { hls.startLoad(); hideMsg(); }, 1500);
      return;
    }
    if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
        data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
        data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
        data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT) {
      scheduleRetry();
      return;
    }
    if (data.fatal) {
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        scheduleRetry();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        showMsg('مشكلة في الوسائط... جارٍ الإصلاح');
        hls.recoverMediaError();
      } else {
        showError('تعذر تشغيل البث', 'حدث خطأ غير متوقع');
        scheduleRetry();
      }
    }
  });
}

function loadIntoPlayer(ch) {
  const mode = ensurePlayer();
  if (!mode) {
    showError('المتصفح لا يدعم HLS', 'جرّب استخدام متصفح حديث مثل Chrome أو Edge');
    return;
  }

  const video = $('#video');
  $('#npName').textContent = ch.name;
  const qEl = $('#npQuality');
  if (qEl) qEl.classList.add('hidden');
  const vEl = $('#npViewers');
  if (vEl) vEl.classList.add('hidden');
  clearTimeout(retryTimer);
  retryCount = 0;
  hideMsg();
  hideError();
  hideWelcome();
  showLoading();

  // Highlight active card
  document.querySelectorAll('.card').forEach(el => el.classList.remove('card-active'));
  const activeCard = document.querySelector(`.card[data-id="${ch.id}"]`);
  if (activeCard) activeCard.classList.add('card-active');

  if (mode === 'hls') {
    hls.loadSource(ch.url + '?t=' + Date.now());
  } else {
    video.src = ch.url;
    video.play().catch(() => {});
  }
}

function playChannel(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;
  
  console.log('══════════ VIEWER TRACE ══════════');
  console.log(`STEP 1: Channel clicked`);
  console.log(`STEP 1: Channel name: "${ch.name}"`);
  console.log(`STEP 1: Channel ID: ${ch.id}`);
  console.log(`STEP 1: Source URL from DB: ${ch.url}`);

  // If same channel, don't restart
  if (currentChannel && currentChannel.id === id) return;
  currentChannel = ch;

  // Show preparing message
  hideWelcome();
  showLoading();
  showMsg('جاري تحضير البث...');

  // Build the REAL HLS URL that viewer MUST use
  const hlsUrl = window.location.protocol + '//' + window.location.hostname + ':' + (window.location.port || '3001') + '/hls/' + id + '/index.m3u8';
  console.log(`STEP 8: HLS URL that SHOULD be loaded: ${hlsUrl}`);

  // 1. Start FFmpeg via Public API (no auth needed)
  fetch('/api/public/stream-action/' + id + '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: ch.url })
  }).then(res => {
    console.log(`STEP 2: API response status: ${res.status}`);
    if (!res.ok) {
      console.log(`STEP 2: API FAILED — Fallback to direct URL`);
      // Fallback: play original URL directly if can't start FFmpeg
      showMsg('سيتم تشغيل الرابط المباشر...');
      setTimeout(() => {
        hideMsg();
        loadIntoPlayer(ch);
      }, 1000);
      return;
    }
    // 2. Wait a moment for HLS to initialize, then use HLS URL
    console.log(`STEP 2: API OK — Waiting 2s for HLS to initialize`);
    showMsg('تم بدء البث... جاري التحميل');
    setTimeout(() => {
      hideMsg();
      console.log(`STEP 7: Loading HLS URL into player: ${hlsUrl}`);
      // Override ch.url to use the local HLS proxy ONLY
      const hlsCh = { ...ch, url: hlsUrl };
      loadIntoPlayer(hlsCh);
      console.log(`STEP 9: HLS.js should now load: ${hlsUrl}`);
      console.log(`STEP 9: HLS.js loading LOCAL file, NOT source URL: ${ch.url}`);
    }, 2000);
  }).catch(() => {
    console.log(`STEP 2: Network error — Fallback to direct URL`);
    hideMsg();
    loadIntoPlayer(ch);
  });

  startHeartbeat();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== Heartbeat ====================

function heartbeat() {
  if (!currentChannel) return;
  fetch('/api/public/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: currentChannel.id, clientId })
  }).then(r => r.json()).then(data => {
    if (data.viewers !== undefined) {
      const vEl = $('#npViewers');
      if (vEl) {
        vEl.classList.remove('hidden');
        vEl.textContent = `👥 ${data.viewers}`;
      }
    }
  }).catch(() => {});
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(heartbeat, 15000);
  heartbeat();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ==================== Controls ====================

function setupControls() {
  $('#closePlayer').onclick = closePlayer;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePlayer();
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'm' || e.key === 'M') toggleMute();
  });

  $('#muteBtn').onclick = toggleMute;
  $('#fsBtn').onclick = toggleFullscreen;

  $('#pipBtn').onclick = async () => {
    const v = $('#video');
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (v.requestPictureInPicture) {
        await v.requestPictureInPicture();
      }
    } catch (e) {
      showMsg('خاصية PiP غير مدعومة');
      setTimeout(hideMsg, 2000);
    }
  };

  $('#copyUrlBtn').onclick = () => {
    if (!currentChannel) return;
    // Copy the REAL HLS stream URL
    const hlsUrl = window.location.protocol + '//' + window.location.hostname + ':' + (window.location.port || '3001') + '/hls/' + currentChannel.id + '/index.m3u8';
    navigator.clipboard.writeText(hlsUrl).then(() => {
      showMsg('✅ تم نسخ رابط HLS');
      setTimeout(hideMsg, 2000);
    }).catch(() => {
      showMsg('❌ فشل نسخ الرابط');
      setTimeout(hideMsg, 2000);
    });
  };

  $('#vlcBtn').onclick = () => {
    if (!currentChannel) return;
    // Open VLC with the REAL HLS stream URL
    const hlsUrl = window.location.protocol + '//' + window.location.hostname + ':' + (window.location.port || '3001') + '/hls/' + currentChannel.id + '/index.m3u8';
    window.open('vlc://' + hlsUrl, '_blank');
    showMsg('✅ تم فتح الرابط في المشغل الخارجي');
    setTimeout(hideMsg, 2000);
  };

  $('#refreshBtn').onclick = () => {
    if (!currentChannel) return;
    hideMsg();
    hideError();
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    loadIntoPlayer(currentChannel);
    heartbeat();
  };

  $('#cpuSaver').onchange = (e) => {
    cpuSaver = e.target.checked;
    if (currentChannel && hls) {
      const ch = currentChannel;
      hls.destroy(); hls = null;
      loadIntoPlayer(ch);
    }
  };

  $('#peRetryBtn').onclick = () => {
    if (!currentChannel) return;
    hideError();
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    loadIntoPlayer(currentChannel);
  };
}

function closePlayer() {
  stopHeartbeat();
  if (hls) {
    try { hls.stopLoad(); hls.detachMedia(); hls.destroy(); } catch (e) {}
    hls = null;
  }
  const v = $('#video');
  try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
  hideLoading();
  hideError();
  currentChannel = null;
  showWelcome();
  document.querySelectorAll('.card').forEach(el => el.classList.remove('card-active'));
}

function toggleMute() {
  const v = $('#video');
  v.muted = !v.muted;
  $('#muteBtn').textContent = v.muted ? '🔇' : '🔊';
}

function toggleFullscreen() {
  const v = $('#video');
  if (v.requestFullscreen) v.requestFullscreen();
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
}

// ==================== Boot ====================

(function loadHlsJs() {
  const s = document.createElement('script');
  s.src = '/viewer/hls.min.js';
  s.onload = () => { window._hlsReady && window._hlsReady(); };
  s.onerror = () => {
    const c = document.createElement('script');
    c.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js';
    c.onload = () => { window._hlsReady && window._hlsReady(); };
    document.head.appendChild(c);
  };
  document.head.appendChild(s);
})();

window._hlsReady = () => {
  // HLS.js loaded, we can proceed
};
init();