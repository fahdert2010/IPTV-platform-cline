'use strict';

/* Mubasher Core v2.0 — Admin Panel
 * All credentials are read from the server config - NOT hardcoded.
 * All data flows from RuntimeRegistry via /api/admin endpoints.
 */

// ─── Credentials from server (fetched at init) ────────────
let _authHeader = null;

async function loadCredentials() {
  // Fetch credentials from server config endpoint
  // The server returns the configured username (NOT password) for display
  // Auth is done via Basic Auth - password must be entered by user
  const stored = sessionStorage.getItem('mubasher_auth');
  if (stored) {
    _authHeader = stored;
    const ok = await verifyAuth();
    if (ok) return true;
    sessionStorage.removeItem('mubasher_auth');
  }
  return promptLogin();
}

async function verifyAuth() {
  try {
    const res = await fetch('/api/admin/channels', {
      headers: { 'Authorization': _authHeader, 'Content-Type': 'application/json' }
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

function promptLogin() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return resolve(false);
    overlay.classList.add('show');

    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const user = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value;
      if (!user || !pass) return;
      _authHeader = 'Basic ' + btoa(user + ':' + pass);
      const ok = await verifyAuth();
      if (ok) {
        sessionStorage.setItem('mubasher_auth', _authHeader);
        overlay.classList.remove('show');
        resolve(true);
      } else {
        document.getElementById('login-error').textContent = 'بيانات الدخول غير صحيحة';
      }
    };
  });
}

// ─── API helper ──────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': _authHeader, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch('/api/admin' + path, opts);
    if (res.status === 401 || res.status === 403) {
      sessionStorage.removeItem('mubasher_auth');
      location.reload();
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    return null;
  }
}

// ─── Utilities ───────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function stateClass(state) {
  const map = {
    'ONLINE': 'status-on',
    'STARTING': 'status-warn',
    'PROBING': 'status-warn',
    'BUFFERING': 'status-warn',
    'RECONNECTING': 'status-warn',
    'IDLE': 'status-off',
    'STOPPED': 'status-off',
    'ERROR': 'status-err',
    'STOPPING': 'status-warn'
  };
  return map[state] || 'status-off';
}

function stateLabel(state) {
  const map = {
    'ONLINE': '🟢 مباشر',
    'STARTING': '🟡 بدء',
    'PROBING': '🔵 فحص',
    'BUFFERING': '🟣 تخزين',
    'RECONNECTING': '🟠 إعادة اتصال',
    'IDLE': '⚪ خامل',
    'STOPPED': '🔴 متوقف',
    'ERROR': '❌ خطأ',
    'STOPPING': '🟡 إيقاف'
  };
  return map[state] || (state || '-');
}

// ─── Navigation ──────────────────────────────────────────
function initNav() {
  document.querySelectorAll('nav a[data-page]').forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const page = this.dataset.page;
      if (!page) return;
      document.querySelectorAll('nav a').forEach(n => n.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const target = document.getElementById('page-' + page);
      if (target) target.classList.add('active');
      const titleEl = document.getElementById('page-title');
      if (titleEl) titleEl.textContent = this.querySelector('span:not(.icon)')?.textContent?.trim() || this.textContent.trim();
      loadPage(page);
    });
  });
}

function loadPage(page) {
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'channels': loadChannels(); break;
    case 'sources': loadSources(); break;
    case 'viewers': loadViewers(); break;
    case 'streams': loadStreams(); break;
    case 'cache': loadCache(); break;
    case 'health': loadHealth(); break;
    case 'settings': loadSettings(); break;
    case 'logs': loadLogs(); break;
  }
}

// ─── SSE: Real-time updates via Server-Sent Events ───────
let _sseConnection = null;

function startSSE() {
  if (_sseConnection) {
    _sseConnection.close();
    _sseConnection = null;
  }

  _sseConnection = new EventSource('/api/admin/events', {
    // EventSource doesn't support custom headers - use URL param
  });

  // Since EventSource doesn't support Basic Auth headers directly,
  // use polling as fallback for dashboard
  _sseConnection.onmessage = (e) => {
    try {
      const { type, data } = JSON.parse(e.data);
      if (type === 'update') applyDashboardData(data);
    } catch (_) {}
  };

  _sseConnection.onerror = () => {
    // Reconnect after 5s
    setTimeout(startSSE, 5000);
  };
}

// ─── Dashboard ───────────────────────────────────────────
let _dashboardTimer = null;

async function loadDashboard() {
  const d = await api('GET', '/dashboard');
  if (d) applyDashboardData(d);
}

function applyDashboardData(d) {
  const ch = d.channels || {};
  const viewers = d.viewers || {};
  const health = d.health || {};
  const cache = d.cache || {};
  const system = d.system || {};

  // Stats grid
  const statsEl = document.getElementById('dashboard-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${ch.total || 0}</div>
        <div class="stat-label">إجمالي القنوات</div>
      </div>
      <div class="stat-card">
        <div class="stat-value text-green">${ch.running || 0}</div>
        <div class="stat-label">قيد البث</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${viewers.current || 0}</div>
        <div class="stat-label">المشاهدون</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${health.averageScore !== undefined ? health.averageScore + '%' : '—'}</div>
        <div class="stat-label">معدل الصحة</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatTime(system.uptimeSeconds || 0)}</div>
        <div class="stat-label">وقت التشغيل</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${system.memoryRssMb || 0} MB</div>
        <div class="stat-label">الذاكرة</div>
      </div>
    `;
  }

  // Streams status
  const streamsEl = document.getElementById('streams-status');
  if (streamsEl) {
    streamsEl.innerHTML = `
      <div class="mini-stat"><span>مباشر:</span><strong class="text-green">${ch.running || 0}</strong></div>
      <div class="mini-stat"><span>بدء:</span><strong class="text-yellow">${ch.starting || 0}</strong></div>
      <div class="mini-stat"><span>خطأ:</span><strong class="text-red">${ch.error || 0}</strong></div>
      <div class="mini-stat"><span>خامل:</span><strong>${ch.idle || 0}</strong></div>
      <div class="mini-stat"><span>إعادة اتصال:</span><strong class="text-yellow">${ch.reconnecting || 0}</strong></div>
    `;
  }

  // Health status
  const healthEl = document.getElementById('health-status');
  if (healthEl) {
    healthEl.innerHTML = `
      <div class="mini-stat"><span>سليم:</span><strong class="text-green">${health.healthy || 0}</strong></div>
      <div class="mini-stat"><span>تحذير:</span><strong class="text-yellow">${health.warning || 0}</strong></div>
      <div class="mini-stat"><span>خطير:</span><strong class="text-red">${health.critical || 0}</strong></div>
      <div class="mini-stat"><span>غير متصل:</span><strong class="text-gray">${health.offline || 0}</strong></div>
    `;
  }

  // Viewers status
  const viewersEl = document.getElementById('viewers-status');
  if (viewersEl) {
    viewersEl.innerHTML = `
      <div class="mini-stat"><span>متصل:</span><strong>${viewers.current || 0}</strong></div>
      <div class="mini-stat"><span>الإجمالي:</span><strong>${viewers.total || 0}</strong></div>
    `;
  }

  // Cache status
  const cacheEl = document.getElementById('cache-status');
  if (cacheEl) {
    cacheEl.innerHTML = `
      <div class="mini-stat"><span>RAM:</span><strong>${formatBytes(cache.ramUsedBytes || 0)}</strong></div>
      <div class="mini-stat"><span>قرص:</span><strong>${formatBytes(cache.diskUsedBytes || 0)}</strong></div>
      <div class="mini-stat"><span>نسبة الإصابة:</span><strong>${cache.hitRate !== undefined ? cache.hitRate + '%' : '—'}</strong></div>
    `;
  }

  // Live logs
  const logsEl = document.getElementById('live-logs');
  if (logsEl && d.logs && d.logs.length > 0) {
    logsEl.innerHTML = d.logs.slice(0, 20).map(log =>
      `<div class="log-entry log-${log.level || 'info'}">
        <span class="log-time">[${new Date(log.timestamp).toLocaleTimeString('ar-SA')}]</span>
        <span class="log-level">${(log.level || 'INFO').toUpperCase()}</span>
        <span>${esc(log.message || '')}</span>
      </div>`
    ).join('');
  }

  // Header stats
  const uptimeEl = document.getElementById('uptime-display');
  if (uptimeEl) uptimeEl.textContent = formatTime(system.uptimeSeconds || 0);
  const viewerCountEl = document.getElementById('viewer-count');
  if (viewerCountEl) viewerCountEl.textContent = (viewers.current || 0) + ' مشاهد';

  // Sources info
  const sourcesEl = document.getElementById('sources-status');
  if (sourcesEl && d.sources) {
    sourcesEl.innerHTML = `
      <div class="mini-stat"><span>إجمالي:</span><strong>${d.sources.total || 0}</strong></div>
      <div class="mini-stat"><span>مفعل:</span><strong>${d.sources.enabled || 0}</strong></div>
    `;
  }
}

// Auto-refresh dashboard every 3s if SSE not working
function startDashboardAutoRefresh() {
  if (_dashboardTimer) clearInterval(_dashboardTimer);
  _dashboardTimer = setInterval(() => {
    const dashPage = document.getElementById('page-dashboard');
    if (dashPage && dashPage.classList.contains('active')) {
      loadDashboard();
    }
  }, 3000);
}

// ─── Channels ────────────────────────────────────────────
let channelsData = [];

async function loadChannels() {
  const d = await api('GET', '/channels');
  channelsData = d?.channels || [];
  renderChannels();
}

function renderChannels() {
  const tbody = document.getElementById('channels-body');
  if (!tbody) return;

  const search = (document.getElementById('channel-search')?.value || '').toLowerCase();
  let filtered = channelsData;
  if (search) {
    filtered = filtered.filter(c =>
      (c.name || '').toLowerCase().includes(search) ||
      (c.group || '').toLowerCase().includes(search) ||
      (c.country || '').toLowerCase().includes(search)
    );
  }

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">لا توجد قنوات. أضف مصدراً أولاً وقم باستيراد القنوات.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(ch => `
    <tr>
      <td><input type="checkbox" class="channel-check" value="${ch.id}"></td>
      <td>${ch.number || ''}</td>
      <td>
        ${ch.logo ? `<img src="${esc(ch.logo)}" class="ch-logo" alt="">` : '<span class="ch-logo-ph">📺</span>'}
        <strong>${esc(ch.name)}</strong>
      </td>
      <td>${esc(ch.group || '-')}</td>
      <td><span class="status-dot-sm ${stateClass(ch.state)}"></span> ${stateLabel(ch.state)}</td>
      <td>${ch.viewerCount || 0}</td>
      <td>${ch.healthScore !== null && ch.healthScore !== undefined ? ch.healthScore + '%' : '-'}</td>
      <td>${ch.primarySource ? '✅' : '❌'}</td>
      <td>${ch.enabled ? '✅ مفعل' : '⏸ معطل'}</td>
      <td class="actions-cell">
        <button class="btn-sm" onclick="toggleChannel('${ch.id}')" title="${ch.enabled ? 'تعطيل' : 'تفعيل'}">${ch.enabled ? '⏸' : '▶'}</button>
        <button class="btn-sm" onclick="editChannel('${ch.id}')" title="تعديل">✏️</button>
        <button class="btn-sm btn-danger" onclick="deleteChannel('${ch.id}')" title="حذف">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function filterChannels() { renderChannels(); }

function toggleAll() {
  const checked = document.getElementById('select-all')?.checked;
  document.querySelectorAll('.channel-check').forEach(cb => cb.checked = checked);
}

function getSelectedIds() {
  return Array.from(document.querySelectorAll('.channel-check:checked')).map(cb => cb.value);
}

async function bulkEnable() {
  const ids = getSelectedIds();
  if (!ids.length) return showToast('اختر قنوات أولاً', 'warn');
  await api('POST', '/channels/bulk/enable', { ids });
  loadChannels();
}

async function bulkDisable() {
  const ids = getSelectedIds();
  if (!ids.length) return showToast('اختر قنوات أولاً', 'warn');
  await api('POST', '/channels/bulk/disable', { ids });
  loadChannels();
}

async function bulkDelete() {
  const ids = getSelectedIds();
  if (!ids.length) return showToast('اختر قنوات أولاً', 'warn');
  if (!confirm(`حذف ${ids.length} قناة؟`)) return;
  await api('POST', '/channels/bulk/delete', { ids });
  loadChannels();
}

async function toggleChannel(id) {
  const ch = channelsData.find(c => c.id === id);
  if (!ch) return;
  await api('POST', `/channels/${id}/${ch.enabled ? 'disable' : 'enable'}`);
  loadChannels();
}

async function deleteChannel(id) {
  if (!confirm('حذف القناة؟')) return;
  await api('DELETE', `/channels/${id}`);
  loadChannels();
}

async function showAddChannel() {
  let sourcesRes = await api('GET', '/sources');
  const sourcesList = sourcesRes?.sources || [];

  showModal('إضافة قناة', `
    <form id="channel-form">
      <label>الاسم <span class="req">*</span><input type="text" id="ch-name" required placeholder="اسم القناة"></label>
      <label>المجموعة <input type="text" id="ch-group" placeholder="Sports, News, ..."></label>
      <label>الرقم <input type="number" id="ch-number" min="0" value="0"></label>
      <label>اللغة <input type="text" id="ch-language" placeholder="ar, en, ..."></label>
      <label>الدولة <input type="text" id="ch-country" placeholder="SA, AE, ..."></label>
      <label>شعار (URL) <input type="url" id="ch-logo" placeholder="https://..."></label>
      
      <h4 style="margin:16px 0 8px;color:#d4a017;border-bottom:1px solid #333;padding-bottom:4px;">🔗 المصدر عبر Source (اختياري)</h4>
      <label>المصدر الرئيسي
        <select id="ch-source">
          <option value="">-- اختر مصدراً --</option>
          ${sourcesList.map(s => `<option value="${s.id}">${esc(s.name)} (${s.type})</option>`).join('')}
        </select>
      </label>
      <label>Stream ID
        <input type="text" id="ch-stream-id" placeholder="ID في حالة Xtream، أو URL في حالة M3U">
      </label>
      
      <h4 style="margin:16px 0 8px;color:#d4a017;border-bottom:1px solid #333;padding-bottom:4px;">🌐 رابط مباشر (بدون Source)</h4>
      <label>URL مباشر
        <input type="url" id="ch-url" placeholder="https://example.com/stream.m3u8">
      </label>
      <label>Referer <small class="tooltip-text" title="يُستخدم عندما يتحقق الخادم من مصدر الطلب">ℹ️</small>
        <input type="text" id="ch-referer" placeholder="https://example.com">
      </label>
      <label>Origin
        <input type="text" id="ch-origin" placeholder="https://example.com">
      </label>
      <label>User-Agent
        <input type="text" id="ch-useragent" placeholder="Mozilla/5.0...">
      </label>
      <label>Cookie
        <input type="text" id="ch-cookie" placeholder="session=abc123; token=xyz">
      </label>
      
      <h4 style="margin:16px 0 8px;color:#d4a017;border-bottom:1px solid #333;padding-bottom:4px;">⚙️ إعدادات البث</h4>
      <label>دقة البث <input type="text" id="ch-resolution" placeholder="1920x1080"></label>
      <label>معدل البت (kbps) <input type="number" id="ch-bitrate" value="0"></label>
      <label>عدد FPS <input type="number" id="ch-fps" value="30"></label>
      <label>Video Codec <input type="text" id="ch-vcodec" placeholder="copy, h264, h265"></label>
      <label>Audio Codec <input type="text" id="ch-acodec" placeholder="copy, aac, mp3"></label>
      <label class="checkbox-label">
        <input type="checkbox" id="ch-enabled" checked>
        <span>مفعل</span>
      </label>
      <button type="submit" class="btn-primary">إضافة القناة</button>
    </form>
  `);

  document.getElementById('channel-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await api('POST', '/channels', {
      name: document.getElementById('ch-name').value,
      group: document.getElementById('ch-group').value,
      number: parseInt(document.getElementById('ch-number').value) || 0,
      language: document.getElementById('ch-language').value,
      country: document.getElementById('ch-country').value,
      logo: document.getElementById('ch-logo').value,
      primarySource: document.getElementById('ch-source').value || null,
      primaryStreamId: document.getElementById('ch-stream-id').value || null,
      url: document.getElementById('ch-url').value || '',
      referer: document.getElementById('ch-referer').value || '',
      origin: document.getElementById('ch-origin').value || '',
      userAgent: document.getElementById('ch-useragent').value || '',
      cookie: document.getElementById('ch-cookie').value || '',
      resolution: document.getElementById('ch-resolution').value || '',
      bitrate: parseInt(document.getElementById('ch-bitrate').value) || 0,
      fps: parseInt(document.getElementById('ch-fps').value) || null,
      videoCodec: document.getElementById('ch-vcodec').value || 'copy',
      audioCodec: document.getElementById('ch-acodec').value || 'copy',
      enabled: document.getElementById('ch-enabled').checked
    });
    if (result) {
      closeModal();
      loadChannels();
      showToast('تم إضافة القناة', 'success');
    }
  });
}

async function editChannel(id) {
  const ch = channelsData.find(c => c.id === id);
  if (!ch) return;

  let sourcesRes = await api('GET', '/sources');
  const sourcesList = sourcesRes?.sources || [];

  showModal('تعديل القناة', `
    <form id="channel-form">
      <label>الاسم <span class="req">*</span><input type="text" id="ch-name" value="${esc(ch.name)}" required></label>
      <label>المجموعة <input type="text" id="ch-group" value="${esc(ch.group || '')}"></label>
      <label>الرقم <input type="number" id="ch-number" value="${ch.number || 0}"></label>
      <label>اللغة <input type="text" id="ch-language" value="${esc(ch.language || '')}"></label>
      <label>الدولة <input type="text" id="ch-country" value="${esc(ch.country || '')}"></label>
      <label>شعار (URL) <input type="url" id="ch-logo" value="${esc(ch.logo || '')}"></label>
      
      <h4 style="margin:16px 0 8px;color:#d4a017;border-bottom:1px solid #333;padding-bottom:4px;">🔗 المصدر عبر Source (اختياري)</h4>
      <label>المصدر الرئيسي
        <select id="ch-source">
          <option value="">-- بدون مصدر --</option>
          ${sourcesList.map(s => `<option value="${s.id}" ${s.id === ch.primarySource ? 'selected' : ''}>${esc(s.name)} (${s.type})</option>`).join('')}
        </select>
      </label>
      <label>Stream ID
        <input type="text" id="ch-stream-id" value="${esc(ch.primaryStreamId || '')}">
      </label>
      
      <h4 style="margin:16px 0 8px;color:#d4a017;border-bottom:1px solid #333;padding-bottom:4px;">🌐 رابط مباشر (بدون Source)</h4>
      <label>URL مباشر <input type="url" id="ch-url" value="${esc(ch.url || '')}" placeholder="https://example.com/stream.m3u8"></label>
      <label>Referer <small class="tooltip-text" title="يُستخدم عندما يتحقق الخادم من مصدر الطلب">ℹ️</small>
        <input type="text" id="ch-referer" value="${esc(ch.referer || '')}" placeholder="https://example.com">
      </label>
      <label>Origin <input type="text" id="ch-origin" value="${esc(ch.origin || '')}" placeholder="https://example.com"></label>
      <label>User-Agent <input type="text" id="ch-useragent" value="${esc(ch.userAgent || '')}" placeholder="Mozilla/5.0..."></label>
      <label>Cookie <input type="text" id="ch-cookie" value="${esc(ch.cookie || '')}" placeholder="session=abc123; token=xyz"></label>
      
      <h4 style="margin:16px 0 8px;color:#d4a017;border-bottom:1px solid #333;padding-bottom:4px;">⚙️ إعدادات البث</h4>
      <label>دقة البث <input type="text" id="ch-resolution" value="${esc(ch.resolution || '')}"></label>
      <label>معدل البت (kbps) <input type="number" id="ch-bitrate" value="${ch.bitrate || 0}"></label>
      <label>عدد FPS <input type="number" id="ch-fps" value="${ch.fps || 30}"></label>
      <label>Video Codec <input type="text" id="ch-vcodec" value="${esc(ch.videoCodec || 'copy')}"></label>
      <label>Audio Codec <input type="text" id="ch-acodec" value="${esc(ch.audioCodec || 'copy')}"></label>
      <label class="checkbox-label">
        <input type="checkbox" id="ch-enabled" ${ch.enabled ? 'checked' : ''}>
        <span>مفعل</span>
      </label>
      <button type="submit" class="btn-primary">حفظ التعديلات</button>
    </form>
  `);

  document.getElementById('channel-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await api('PUT', `/channels/${id}`, {
      name: document.getElementById('ch-name').value,
      group: document.getElementById('ch-group').value,
      number: parseInt(document.getElementById('ch-number').value) || 0,
      language: document.getElementById('ch-language').value,
      country: document.getElementById('ch-country').value,
      logo: document.getElementById('ch-logo').value,
      primarySource: document.getElementById('ch-source').value || null,
      primaryStreamId: document.getElementById('ch-stream-id').value || null,
      url: document.getElementById('ch-url').value || '',
      referer: document.getElementById('ch-referer').value || '',
      origin: document.getElementById('ch-origin').value || '',
      userAgent: document.getElementById('ch-useragent').value || '',
      cookie: document.getElementById('ch-cookie').value || '',
      resolution: document.getElementById('ch-resolution').value || '',
      bitrate: parseInt(document.getElementById('ch-bitrate').value) || 0,
      fps: parseInt(document.getElementById('ch-fps').value) || null,
      videoCodec: document.getElementById('ch-vcodec').value || 'copy',
      audioCodec: document.getElementById('ch-acodec').value || 'copy',
      enabled: document.getElementById('ch-enabled').checked
    });
    if (result) {
      closeModal();
      loadChannels();
      showToast('تم حفظ التعديلات', 'success');
    }
  });
}

// ─── Sources ─────────────────────────────────────────────
let sourcesData = [];

async function loadSources() {
  const d = await api('GET', '/sources');
  sourcesData = d?.sources || [];
  renderSources();
}

function renderSources() {
  const tbody = document.getElementById('sources-body');
  if (!tbody) return;

  if (!sourcesData.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">لا توجد مصادر. أضف مصدراً جديداً.</td></tr>';
    return;
  }

  tbody.innerHTML = sourcesData.map(s => `
    <tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td><span class="badge badge-${s.type}">${s.type || 'm3u'}</span></td>
      <td>${s.enabled ? '<span class="text-green">🟢 مفعل</span>' : '<span class="text-red">🔴 معطل</span>'}</td>
      <td>${s.totalChannels || 0}</td>
      <td>${s.lastSync ? new Date(s.lastSync).toLocaleString('ar-SA') : 'لم تتم'}</td>
      <td>${s.status || '-'}</td>
      <td>${s.healthScore !== null && s.healthScore !== undefined ? s.healthScore + '%' : '-'}</td>
      <td class="actions-cell">
        <button class="btn-sm" onclick="toggleSource('${s.id}')">${s.enabled ? '⏸' : '▶'}</button>
        <button class="btn-sm" onclick="importSource('${s.id}')" title="استيراد">📥</button>
        <button class="btn-sm btn-danger" onclick="deleteSource('${s.id}')" title="حذف">🗑️</button>
      </td>
    </tr>
  `).join('');
}

async function toggleSource(id) {
  const s = sourcesData.find(x => x.id === id);
  if (!s) return;
  await api('PUT', `/sources/${id}`, { enabled: !s.enabled });
  loadSources();
}

async function importSource(id) {
  showToast('جاري الاستيراد...', 'info');
  const r = await api('POST', `/sources/${id}/import`);
  if (r) {
    showToast(`تم استيراد ${r.added || 0} قناة جديدة، تحديث ${r.updated || 0}`, 'success');
    loadSources();
    loadChannels();
  } else {
    showToast('فشل الاستيراد', 'error');
  }
}

async function deleteSource(id) {
  if (!confirm('حذف المصدر؟')) return;
  await api('DELETE', `/sources/${id}`);
  loadSources();
  showToast('تم الحذف', 'success');
}

async function showAddSource() {
  showModal('إضافة مصدر', `
    <form id="source-form">
      <label>الاسم <span class="req">*</span>
        <input type="text" id="src-name" required placeholder="اسم المصدر">
      </label>
      <label>النوع
        <select id="src-type" onchange="onSourceTypeChange()">
          <option value="m3u">M3U Playlist (ملف أو رابط)</option>
          <option value="direct">رابط مباشر (Direct Stream URL)</option>
          <option value="xtream">Xtream Codes</option>
          <option value="stalker">Stalker Portal</option>
          <option value="mag">MAG Device</option>
          <option value="json">JSON API</option>
          <option value="csv">CSV File</option>
        </select>
      </label>
      <div id="src-fields-m3u">
        <label>رابط M3U
          <input type="text" id="src-url" placeholder="https://example.com/list.m3u أو مسار ملف محلي">
        </label>
        <label>Referer <small class="tooltip-text" title="يُستخدم عندما يتحقق الخادم من مصدر الطلب">ℹ️</small>
          <input type="text" id="src-referer" placeholder="https://example.com">
        </label>
        <label>Origin <small class="tooltip-text" title="رأس Origin لطلبات CORS">ℹ️</small>
          <input type="text" id="src-origin" placeholder="https://example.com">
        </label>
        <label>User Agent
          <input type="text" id="src-ua" placeholder="Mozilla/5.0 ...">
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="src-autosync">
          <span>مزامنة تلقائية</span>
        </label>
      </div>
      <div id="src-fields-xtream" style="display:none">
        <label>عنوان الخادم <input type="text" id="src-xtream-url" placeholder="http://panel.example.com:8080"></label>
        <label>اسم المستخدم <input type="text" id="src-xtream-user"></label>
        <label>كلمة المرور <input type="password" id="src-xtream-pass"></label>
      </div>
      <div id="src-fields-mag" style="display:none">
        <label>عنوان البوابة <input type="text" id="src-mag-url" placeholder="http://portal.example.com/stalker_portal"></label>
        <label>MAC Address <input type="text" id="src-mac" placeholder="00:1A:79:..."></label>
      </div>
      <label class="checkbox-label">
        <input type="checkbox" id="src-enabled" checked>
        <span>مفعل</span>
      </label>
      <button type="submit" class="btn-primary">إضافة المصدر</button>
    </form>
  `);

  document.getElementById('source-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('src-type').value;
    let payload = {
      name: document.getElementById('src-name').value,
      type,
      enabled: document.getElementById('src-enabled').checked
    };

    if (type === 'm3u' || type === 'direct' || type === 'json' || type === 'csv') {
      payload.baseUrl = document.getElementById('src-url')?.value || '';
      payload.referer = document.getElementById('src-referer')?.value || '';
      payload.origin = document.getElementById('src-origin')?.value || '';
      payload.userAgent = document.getElementById('src-ua')?.value || '';
      payload.autoSync = document.getElementById('src-autosync')?.checked || false;
    } else if (type === 'xtream') {
      payload.baseUrl = document.getElementById('src-xtream-url')?.value || '';
      payload.username = document.getElementById('src-xtream-user')?.value || '';
      payload.password = document.getElementById('src-xtream-pass')?.value || '';
    } else if (type === 'stalker' || type === 'mag') {
      payload.baseUrl = document.getElementById('src-mag-url')?.value || '';
      payload.mac = document.getElementById('src-mac')?.value || '';
    }

    const result = await api('POST', '/sources', payload);
    if (result && (result.source || result.id)) {
      closeModal();
      loadSources();
      showToast('تم إضافة المصدر', 'success');
      // Auto-import
      const srcId = result.source?.id || result.id;
      if (srcId) setTimeout(() => importSource(srcId), 500);
    } else {
      showToast('فشل إضافة المصدر', 'error');
    }
  });
}

function onSourceTypeChange() {
  const type = document.getElementById('src-type')?.value;
  document.getElementById('src-fields-m3u').style.display = (type === 'm3u' || type === 'direct' || type === 'json' || type === 'csv') ? '' : 'none';
  document.getElementById('src-fields-xtream').style.display = type === 'xtream' ? '' : 'none';
  document.getElementById('src-fields-mag').style.display = (type === 'stalker' || type === 'mag') ? '' : 'none';
}

async function importAll() {
  showToast('جاري استيراد جميع المصادر...', 'info');
  const r = await api('POST', '/sources/import-all');
  if (r) {
    showToast('تم استيراد جميع المصادر', 'success');
    loadSources();
    loadChannels();
  }
}

// ─── Viewers ─────────────────────────────────────────────
async function loadViewers() {
  const d = await api('GET', '/viewers');
  const viewers = d?.viewers || [];
  const tbody = document.getElementById('viewers-body');
  if (!tbody) return;

  const search = (document.getElementById('viewer-search')?.value || '').toLowerCase();
  let filtered = viewers;
  if (search) {
    filtered = filtered.filter(v =>
      (v.ip || '').includes(search) ||
      (v.device || '').toLowerCase().includes(search)
    );
  }

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">لا يوجد مشاهدون متصلون حالياً</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(v => `
    <tr>
      <td>${esc(v.ip || '-')}</td>
      <td>${esc(v.device || '-')}</td>
      <td>${esc(v.browser || '-')}</td>
      <td>${esc(v.currentChannel || '-')}</td>
      <td>${formatTime(v.watchTime || 0)}</td>
      <td>${v.bandwidth ? formatBytes(v.bandwidth) + '/s' : '-'}</td>
      <td>${v.latency ? v.latency + 'ms' : '-'}</td>
      <td class="actions-cell">
        <button class="btn-sm btn-danger" onclick="kickViewer('${v.id}')">طرد</button>
      </td>
    </tr>
  `).join('');
}

function filterViewers() { loadViewers(); }

async function kickViewer(id) {
  await api('POST', `/viewers/${id}/kick`);
  loadViewers();
  showToast('تم طرد المشاهد', 'success');
}

// ─── Streams ─────────────────────────────────────────────
async function loadStreams() {
  const d = await api('GET', '/streams');
  const streams = d?.streams || [];
  const tbody = document.getElementById('streams-body');
  if (!tbody) return;

  if (!streams.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">لا توجد بثوث نشطة حالياً</td></tr>';
    return;
  }

  tbody.innerHTML = streams.map(s => `
    <tr>
      <td>${esc(s.channelId || '-')}</td>
      <td><span class="status-dot-sm ${stateClass(s.state)}"></span> ${stateLabel(s.state)}</td>
      <td>${s.viewers || 0}</td>
      <td>${s.pid || '-'}</td>
      <td>${formatTime(s.uptime || 0)}</td>
      <td>${s.reconnectCount || 0}</td>
      <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.currentUrl || '-')}</td>
      <td class="actions-cell">
        <button class="btn-sm btn-danger" onclick="stopStream('${s.channelId}')">إيقاف</button>
      </td>
    </tr>
  `).join('');
}

async function stopStream(id) {
  await api('POST', `/streams/${id}/stop`);
  loadStreams();
  showToast('تم إيقاف البث', 'success');
}

// ─── Cache ───────────────────────────────────────────────
async function loadCache() {
  const d = await api('GET', '/cache');
  if (!d) return;

  const statsEl = document.getElementById('cache-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-value">${formatBytes(d.ram?.used || d.ramUsedBytes || 0)}</div><div class="stat-label">RAM مستخدم</div></div>
      <div class="stat-card"><div class="stat-value">${formatBytes(d.disk?.used || d.diskUsedBytes || 0)}</div><div class="stat-label">قرص مستخدم</div></div>
      <div class="stat-card"><div class="stat-value">${d.performance?.hitRate || d.hitRate || 100}%</div><div class="stat-label">نسبة الإصابة</div></div>
      <div class="stat-card"><div class="stat-value">${d.caches?.segments || d.segmentCount || 0}</div><div class="stat-label">المقاطع</div></div>
    `;
  }
}

async function clearCache() {
  if (!confirm('مسح الكاش بالكامل؟')) return;
  await api('POST', '/cache/clear');
  loadCache();
  showToast('تم مسح الكاش', 'success');
}

// ─── Health ──────────────────────────────────────────────
async function loadHealth() {
  const d = await api('GET', '/health');
  if (!d) return;

  const summary = d.channels || {};
  const statsEl = document.getElementById('health-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-value">${summary.averageScore || 100}%</div><div class="stat-label">معدل الصحة</div></div>
      <div class="stat-card"><div class="stat-value text-green">${summary.healthy || 0}</div><div class="stat-label">سليم</div></div>
      <div class="stat-card"><div class="stat-value text-yellow">${summary.warning || 0}</div><div class="stat-label">تحذير</div></div>
      <div class="stat-card"><div class="stat-value text-red">${summary.critical || 0}</div><div class="stat-label">خطير</div></div>
    `;
  }

  // Health details from dashboard
  const dashData = await api('GET', '/dashboard');
  const details = dashData?.healthDetails || [];
  const tbody = document.getElementById('health-body');
  if (!tbody) return;

  if (!details.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">لا توجد بيانات صحة - ابدأ البث أولاً</td></tr>';
    return;
  }

  tbody.innerHTML = details.map(h => `
    <tr>
      <td>${esc(h.channelId || '-')}</td>
      <td><span class="health-score health-${h.score >= 80 ? 'good' : h.score >= 50 ? 'warn' : 'bad'}">${h.score || 0}%</span></td>
      <td>${h.latency ? h.latency + 'ms' : '-'}</td>
      <td>${h.bitrate ? formatBytes(h.bitrate) + '/s' : '-'}</td>
      <td>${h.resolution || '-'}</td>
      <td>${h.codec || '-'}</td>
      <td>${formatTime(h.uptime || 0)}</td>
    </tr>
  `).join('');
}

// ─── Settings ────────────────────────────────────────────
async function loadSettings() {
  const d = await api('GET', '/config');
  const cfg = d?.config || {};

  const streamEl = document.getElementById('stream-settings');
  if (streamEl) {
    streamEl.innerHTML = `
      <label title="مدة كل مقطع HLS بالثواني">HLS Time (ثواني): <input type="number" id="s-hls-time" value="${cfg.ffmpeg?.hlsTime || 2}"></label>
      <label title="عدد المقاطع في قائمة التشغيل">HLS List Size: <input type="number" id="s-hls-list" value="${cfg.ffmpeg?.hlsListSize || 10}"></label>
      <label title="وقت الخمول قبل إيقاف البث تلقائياً">Idle Stop (ثواني): <input type="number" id="s-idle" value="${cfg.stream?.idleStopSeconds || 30}"></label>
      <label title="إعادة تشغيل البث تلقائياً عند التعطل"><input type="checkbox" id="s-auto-restart" ${cfg.stream?.autoRestartCrashed !== false ? 'checked' : ''}> إعادة التشغيل التلقائي</label>
    `;
  }

  const cacheEl = document.getElementById('cache-settings');
  if (cacheEl) {
    cacheEl.innerHTML = `
      <label title="حجم الكاش في الذاكرة العشوائية">RAM Cache (MB): <input type="number" id="s-ram" value="${cfg.cache?.ramBufferSizeMb || 256}"></label>
      <label title="حجم الكاش على القرص">Disk Cache (MB): <input type="number" id="s-disk" value="${cfg.cache?.diskCacheSizeMb || 5120}"></label>
    `;
  }

  const ffmpegEl = document.getElementById('ffmpeg-settings');
  if (ffmpegEl) {
    ffmpegEl.innerHTML = `
      <label title="مسار برنامج FFmpeg">FFmpeg Path: <input type="text" id="s-ffmpeg" value="${esc(cfg.ffmpeg?.path || 'ffmpeg')}"></label>
      <label title="عدد خيوط المعالجة">Threads: <input type="number" id="s-threads" value="${cfg.ffmpeg?.threads || 2}"></label>
      <label title="User Agent المستخدم في طلبات FFmpeg">User Agent: <input type="text" id="s-ua" value="${esc(cfg.ffmpeg?.userAgent || '')}"></label>
    `;
  }

  const viewerEl = document.getElementById('viewer-settings');
  if (viewerEl) {
    viewerEl.innerHTML = `
      <label title="السماح للمشاهد بنسخ رابط البث"><input type="checkbox" id="s-copy" ${cfg.admin?.allowCopyUrl !== false ? 'checked' : ''}> السماح بنسخ الرابط</label>
      <label title="السماح بفتح البث في VLC"><input type="checkbox" id="s-vlc" ${cfg.admin?.allowVlc !== false ? 'checked' : ''}> السماح بـ VLC</label>
      <label title="السماح بمشغلات خارجية"><input type="checkbox" id="s-ext" ${cfg.admin?.allowExternalPlayers !== false ? 'checked' : ''}> السماح بمشغلات خارجية</label>
      <label title="السماح بـ Picture in Picture"><input type="checkbox" id="s-pip" ${cfg.admin?.allowPiP !== false ? 'checked' : ''}> السماح بـ PiP</label>
    `;
  }
}

async function saveSettings() {
  const result = await api('PUT', '/config', {
    ffmpeg: {
      path: document.getElementById('s-ffmpeg')?.value || 'ffmpeg',
      hlsTime: parseInt(document.getElementById('s-hls-time')?.value) || 2,
      hlsListSize: parseInt(document.getElementById('s-hls-list')?.value) || 10,
      threads: parseInt(document.getElementById('s-threads')?.value) || 2,
      userAgent: document.getElementById('s-ua')?.value || ''
    },
    stream: {
      idleStopSeconds: parseInt(document.getElementById('s-idle')?.value) || 30,
      autoRestartCrashed: document.getElementById('s-auto-restart')?.checked !== false
    },
    cache: {
      ramBufferSizeMb: parseInt(document.getElementById('s-ram')?.value) || 256,
      diskCacheSizeMb: parseInt(document.getElementById('s-disk')?.value) || 5120
    },
    admin: {
      allowCopyUrl: document.getElementById('s-copy')?.checked !== false,
      allowVlc: document.getElementById('s-vlc')?.checked !== false,
      allowExternalPlayers: document.getElementById('s-ext')?.checked !== false,
      allowPiP: document.getElementById('s-pip')?.checked !== false
    }
  });
  if (result) showToast('تم حفظ الإعدادات', 'success');
  else showToast('فشل حفظ الإعدادات', 'error');
}

// ─── Logs ────────────────────────────────────────────────
async function loadLogs() {
  const level = document.getElementById('log-level')?.value || '';
  const d = await api('GET', '/logs' + (level ? '?level=' + level : ''));
  const logs = d?.logs || [];
  const container = document.getElementById('logs-container');
  if (!container) return;

  container.innerHTML = logs.map(log =>
    `<div class="log-entry log-${log.level || 'info'}">
      <span class="log-time">[${new Date(log.timestamp).toLocaleString('ar-SA')}]</span>
      <span class="log-level">${(log.level || 'INFO').toUpperCase()}</span>
      <span class="log-msg">${esc(log.message || '')}</span>
    </div>`
  ).join('') || '<div class="empty-row">لا توجد سجلات</div>';
}

function filterLogs() { loadLogs(); }

async function clearLogs() {
  await api('DELETE', '/logs');
  loadLogs();
}

// ─── Modal ───────────────────────────────────────────────
function showModal(title, body) {
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal');
  if (!titleEl || !bodyEl || !overlay || !modal) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = body;
  overlay.classList.add('show');
  modal.classList.add('show');
}

function closeModal() {
  document.getElementById('modal-overlay')?.classList.remove('show');
  document.getElementById('modal')?.classList.remove('show');
}

// ─── Toast notifications ─────────────────────────────────
function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const colors = { success: '#10b981', error: '#ef4444', warn: '#f59e0b', info: '#3b82f6' };
  toast.style.cssText = `background:${colors[type] || colors.info};color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s`;
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => { toast.style.opacity = '1'; }, 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Init ────────────────────────────────────────────────
async function init() {
  const ok = await loadCredentials();
  if (!ok) return;

  initNav();
  loadDashboard();
  startDashboardAutoRefresh();
}

init();
