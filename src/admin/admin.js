'use strict';

/* Mubasher Core — Admin Panel (Professional) */

const API = '/api/admin';
const cred = btoa('admin:admin123');
const headers = { 'Authorization': 'Basic ' + cred, 'Content-Type': 'application/json' };

// ─── Navigation ──────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', function(e) {
    e.preventDefault();
    const section = this.dataset.section;
    if (!section) return;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    this.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('section-' + section);
    if (target) {
      target.classList.add('active');
      document.getElementById('pageTitle').textContent = this.querySelector('.nav-label').textContent;
    }
    switch (section) {
      case 'dashboard': loadDashboard(); break;
      case 'sources': renderSources(); break;
      case 'channels': renderChannels(); break;
      case 'streams': loadStreams(); break;
      case 'config': loadConfig(); break;
      case 'logs': loadLogs(); break;
    }
  });
});

// Clock
function updateClock() {
  document.getElementById('serverTime').textContent = new Date().toLocaleTimeString('ar-SA', { timeZone: 'Asia/Riyadh' });
}
setInterval(updateClock, 1000);
updateClock();

// ─── API helper ──────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  return await res.json();
}

// ─── Dashboard ───────────────────────────────────────

async function loadDashboard() {
  try {
    const d = await api('GET', '/dashboard');
    document.getElementById('statChannels').textContent = d.totalChannels || 0;
    document.getElementById('statEnabled').textContent = d.enabledChannels || 0;
    document.getElementById('statSources').textContent = d.totalSources || 0;
    document.getElementById('statStreams').textContent = d.activeStreams || 0;
    document.getElementById('statViewers').textContent = d.totalViewers || 0;
    const u = d.uptime || 0;
    document.getElementById('statUptime').textContent = Math.floor(u / 3600) + 'h ' + Math.floor((u % 3600) / 60) + 'm';
  } catch (e) { console.warn('Dashboard error'); }
}
setInterval(() => {
  if (document.getElementById('section-dashboard')?.classList.contains('active')) loadDashboard();
}, 10000);

// ─── Sources ─────────────────────────────────────────

let sourcesData = [];

async function renderSources() {
  try {
    sourcesData = (await api('GET', '/sources')).sources || [];
  } catch (e) { sourcesData = []; }
  const tbody = document.getElementById('sourcesTableBody');
  if (!sourcesData.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">لا توجد مصادر. أضف مصدراً جديداً بالضغط على "إضافة مصدر".</td></tr>';
    return;
  }
  tbody.innerHTML = sourcesData.map(s => {
    const typeLabel = s.type === 'm3u_file' ? '📁 ملف' : s.type === 'm3u_url' ? '🔗 رابط' : '📡 منفرد';
    const statusLabel = s.enabled ? '<span class="status-on">🟢 مفعل</span>' : '<span class="status-off">🔴 معطل</span>';
    const lastImport = s.lastImport ? new Date(s.lastImport).toLocaleString('ar-SA') : 'لم يستورد بعد';
    return `<tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td><span class="badge-type">${typeLabel}</span></td>
      <td style="direction:ltr;font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${esc(s.url)}">${esc(s.url || '-')}</td>
      <td>${statusLabel}</td>
      <td>${s.channelCount || 0}</td>
      <td style="font-size:11px">${lastImport}</td>
      <td class="actions-cell">
        <button class="btn-sm" onclick="toggleSource('${s.id}')">${s.enabled ? 'تعطيل' : 'تفعيل'}</button>
        <button class="btn-sm" onclick="importSource('${s.id}')">استيراد</button>
        <button class="btn-sm" onclick="resyncSource('${s.id}')">مزامنة</button>
        <button class="btn-sm btn-danger" onclick="deleteSource('${s.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

async function toggleSource(id) {
  const s = sourcesData.find(x => x.id === id);
  if (!s) return;
  await api('PUT', '/sources/' + id, { enabled: !s.enabled });
  renderSources();
}

async function importSource(id) {
  const btn = event.target;
  btn.textContent = 'جاري...';
  btn.disabled = true;
  try {
    const r = await api('POST', '/sources/' + id + '/import');
    alert('تم استيراد ' + r.imported + ' قناة، إضافة ' + r.added + ' جديدة');
  } catch (e) { alert('فشل الاستيراد'); }
  btn.textContent = 'استيراد';
  btn.disabled = false;
  renderSources();
  renderChannels();
}

async function resyncSource(id) {
  if (!confirm('إعادة المزامنة ستحذف القنوات الحالية وتستوردها من جديد. هل أنت متأكد؟')) return;
  const btn = event.target;
  btn.textContent = 'جاري...';
  btn.disabled = true;
  try {
    const r = await api('POST', '/sources/' + id + '/resync');
    alert('تمت المزامنة: ' + r.imported + ' قناة');
  } catch (e) { alert('فشلت المزامنة'); }
  btn.textContent = 'مزامنة';
  btn.disabled = false;
  renderSources();
  renderChannels();
}

async function deleteSource(id) {
  if (!confirm('حذف المصدر سيبقي القنوات لكن لن يتم تحديثها. هل أنت متأكد؟')) return;
  await api('DELETE', '/sources/' + id);
  renderSources();
}

// Add Source Modal
document.getElementById('addSourceBtn')?.addEventListener('click', () => {
  document.getElementById('sourceModal').classList.remove('hidden');
});

document.getElementById('sourceModalClose')?.addEventListener('click', () => {
  document.getElementById('sourceModal').classList.add('hidden');
});

document.getElementById('sourceForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('sourceName').value.trim();
  const type = document.getElementById('sourceType').value;
  const url = document.getElementById('sourceUrl').value.trim();
  if (!name || !url) { alert('الاسم والرابط مطلوبان'); return; }
  const btn = document.getElementById('sourceSubmitBtn');
  btn.textContent = 'جاري الإضافة...';
  btn.disabled = true;
  try {
    const src = await api('POST', '/sources', { name, type, url });
    document.getElementById('sourceModal').classList.add('hidden');
    document.getElementById('sourceForm').reset();
    renderSources();
    // Auto-import after adding
    const r = await api('POST', '/sources/' + src.source.id + '/import');
    alert('تم إضافة المصدر واستيراد ' + r.imported + ' قناة');
    renderChannels();
  } catch (e) { alert('فشل الإضافة'); }
  btn.textContent = 'إضافة';
  btn.disabled = false;
});

// Import M3U URL Modal
document.getElementById('importM3UBtn')?.addEventListener('click', () => {
  document.getElementById('importModal').classList.remove('hidden');
});

document.getElementById('importModalClose')?.addEventListener('click', () => {
  document.getElementById('importModal').classList.add('hidden');
});

document.getElementById('importForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('importName').value.trim() || 'M3U Import';
  const type = document.getElementById('importType').value;
  const url = document.getElementById('importUrl').value.trim();
  if (!url) { alert('الرابط مطلوب'); return; }
  const btn = document.getElementById('importSubmitBtn');
  btn.textContent = 'جاري الاستيراد...';
  btn.disabled = true;
  try {
    const src = await api('POST', '/sources', { name, type, url });
    const r = await api('POST', '/sources/' + src.source.id + '/import');
    alert('تم استيراد ' + r.imported + ' قناة بنجاح (إضافة ' + r.added + ' جديدة)');
    document.getElementById('importModal').classList.add('hidden');
    document.getElementById('importForm').reset();
    renderSources();
    renderChannels();
  } catch (e) { alert('فشل الاستيراد: ' + e.message); }
  btn.textContent = 'استيراد';
  btn.disabled = false;
});

// Import Local File (real File Picker)
document.getElementById('importLocalFileBtn')?.addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput')?.addEventListener('change', async function() {
  const file = this.files[0];
  if (!file) return;
  
  const name = file.name.replace(/\.(m3u|m3u8)$/i, '') || 'Local File';
  const btn = document.getElementById('importLocalFileBtn');
  btn.textContent = 'جاري الرفع...';
  btn.disabled = true;
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    
    const res = await fetch(API + '/sources/import-file', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + cred },
      body: formData
    });
    const result = await res.json();
    
    if (result.error) {
      alert('فشل الاستيراد: ' + result.error);
    } else {
      alert('تم استيراد ' + result.imported + ' قناة بنجاح (إضافة ' + result.added + ' جديدة)');
      renderSources();
      renderChannels();
    }
  } catch (e) {
    alert('فشل رفع الملف: ' + e.message);
  }
  
  btn.textContent = '📂 رفع ملف M3U';
  btn.disabled = false;
  this.value = '';
});

// ═══════════════════ CHANNELS ═══════════════════════

let channelsData = [];
let channelsFilter = '';

async function renderChannels() {
  try {
    const q = channelsFilter ? '?search=' + encodeURIComponent(channelsFilter) : '';
    channelsData = (await api('GET', '/channels' + q)).channels || [];
  } catch (e) { channelsData = []; }
  const tbody = document.getElementById('channelsTableBody');
  if (!channelsData.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">' +
      (channelsFilter ? 'لا توجد نتائج للبحث' : 'لا توجد قنوات. استورد مصدراً أولاً.') + '</td></tr>';
    return;
  }
  tbody.innerHTML = channelsData.map(c => {
    const healthIcon = c.health?.isOnline ? '🟢' : c.health ? '🔴' : '⚪';
    const healthText = c.health?.isOnline ? 'متصل' : c.health ? 'غير متصل' : 'غير معروف';
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          ${c.tvgLogo ? `<img src="${esc(c.tvgLogo)}" style="width:28px;height:28px;border-radius:4px;object-fit:cover" onerror="this.style.display='none'">` : '<span style="font-size:20px">📺</span>'}
          <strong>${esc(c.name)}</strong>
        </div>
      </td>
      <td><span class="badge-group">${esc(c.group || 'عام')}</span></td>
      <td style="font-size:11px;color:var(--muted)">${c.sourceId ? c.sourceId.slice(0,8) : '-'}</td>
      <td style="direction:ltr;font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.url)}">${esc(c.url || '-')}</td>
      <td>${c.enabled ? '<span class="status-on">🟢 نشطة</span>' : '<span class="status-off">🔴 معطلة</span>'}</td>
      <td>${c.viewers || 0}</td>
      <td title="${healthText}">${healthIcon}</td>
      <td class="actions-cell">
        <button class="btn-sm" onclick="startChannel('${c.id}')" title="تشغيل">▶</button>
        <button class="btn-sm" onclick="testChannel('${c.id}')" title="فحص">🩺</button>
        <button class="btn-sm" onclick="editChannel('${c.id}')" title="تعديل">✏️</button>
        <button class="btn-sm" onclick="copyChannelUrl('${c.id}')" title="نسخ رابط HLS">📋</button>
        <button class="btn-sm" onclick="openChannelViewer('${c.id}')" title="فتح في Viewer">👁</button>
        <button class="btn-sm" onclick="toggleChannel('${c.id}')">${c.enabled ? 'تعطيل' : 'تفعيل'}</button>
        <button class="btn-sm btn-danger" onclick="deleteChannel('${c.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

// Channel search
document.getElementById('channelSearch')?.addEventListener('input', function() {
  channelsFilter = this.value.trim();
  renderChannels();
});

async function toggleChannel(id) {
  const c = channelsData.find(x => x.id === id);
  if (!c) return;
  await api('PUT', '/channels/' + id, { enabled: !c.enabled });
  renderChannels();
}

async function deleteChannel(id) {
  if (!confirm('حذف القناة نهائياً؟')) return;
  await api('DELETE', '/channels/' + id);
  renderChannels();
}

async function startChannel(id) {
  const c = channelsData.find(x => x.id === id);
  if (!c) return;
  const btn = event.target;
  btn.textContent = '🔄';
  btn.disabled = true;
  try {
    // Start FFmpeg for this channel
    await api('POST', '/streams/' + id + '/start', { url: c.url });
    alert('تم تشغيل القناة: ' + c.name);
    renderChannels();
    loadStreams();
  } catch (e) { alert('فشل التشغيل'); }
  btn.textContent = '▶';
  btn.disabled = false;
}

async function testChannel(id) {
  const c = channelsData.find(x => x.id === id);
  if (!c) return;
  const btn = event.target;
  btn.textContent = '🔄';
  btn.disabled = true;
  try {
    const r = await api('POST', '/channels/' + id + '/test');
    const resultDiv = document.getElementById('healthResult');
    resultDiv.classList.remove('hidden');
    // Build error details with full ffprobe output
    let errorHtml = '';
    if (r.error) {
      errorHtml = '<div style="color:var(--live);margin-top:12px;padding:10px;background:rgba(226,73,59,0.1);border-radius:6px;max-height:200px;overflow:auto;font-family:monospace;font-size:12px;white-space:pre-wrap;direction:ltr;text-align:left">' +
        '<strong style="display:block;margin-bottom:6px">❌ تفاصيل الخطأ (ffprobe):</strong>' +
        esc(r.error) + '</div>';
    }
    resultDiv.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
        <div><strong>القناة:</strong> ${esc(c.name)}</div>
        <div><strong>الحالة:</strong> ${r.isOnline ? '🟢 متصل' : '🔴 غير متصل'}</div>
        <div><strong>الكوديك:</strong> ${r.codec || '-'}</div>
        <div><strong>الدقة:</strong> ${r.resolution || '-'}</div>
        <div><strong>FPS:</strong> ${r.fps || '-'}</div>
        <div><strong>الصوت:</strong> ${r.audio || '-'}</div>
        <div><strong>معدل البت:</strong> ${r.bitrate ? (r.bitrate/1000).toFixed(0) + ' kbps' : '-'}</div>
        <div><strong>زمن الاستجابة:</strong> ${r.responseTime || 0}ms</div>
        <div><strong>الحاوية:</strong> ${r.container || '-'}</div>
        <div><strong>معدل العينة:</strong> ${r.audioSampleRate || '-'}</div>
      </div>
      ${errorHtml}
    `;
    renderChannels();
  } catch (e) { alert('فشل الفحص'); }
  btn.textContent = '🩺';
  btn.disabled = false;
}

function copyChannelUrl(id) {
  const c = channelsData.find(x => x.id === id);
  if (!c) return;
  // Use the REAL HLS stream URL
  const hlsUrl = window.location.protocol + '//' + window.location.hostname + ':' + (window.location.port || '3001') + '/hls/' + c.id + '/index.m3u8';
  navigator.clipboard.writeText(hlsUrl).then(() => {
    showToast('✅ تم نسخ رابط HLS');
  }).catch(() => {
    showToast('❌ فشل نسخ الرابط');
  });
}

function openChannelViewer(id) {
  window.open('/viewer?channel=' + id, '_blank');
}

// ═══════════════════ ADD / EDIT CHANNEL ═══════════════

// Open Add Channel modal
function showAddChannelModal() {
  document.getElementById('channelModalTitle').textContent = 'إضافة قناة جديدة';
  document.getElementById('channelSubmitBtn').textContent = 'إضافة قناة';
  document.getElementById('channelForm').reset();
  document.getElementById('channelEditId').value = '';
  document.getElementById('channelEnabled').checked = true;
  document.getElementById('channelModal').classList.remove('hidden');
}

// Open Edit Channel modal
function editChannel(id) {
  const c = channelsData.find(x => x.id === id);
  if (!c) return;
  document.getElementById('channelModalTitle').textContent = 'تعديل القناة';
  document.getElementById('channelSubmitBtn').textContent = 'حفظ التعديلات';
  document.getElementById('channelName').value = c.name || '';
  document.getElementById('channelGroup').value = c.group || '';
  document.getElementById('channelUrl').value = c.url || '';
  document.getElementById('channelBackupUrl').value = (c.backupUrls && c.backupUrls[0]) || '';
  document.getElementById('channelLogo').value = c.tvgLogo || '';
  document.getElementById('channelTvgId').value = c.tvgId || '';
  document.getElementById('channelEnabled').checked = c.enabled !== false;
  document.getElementById('channelEditId').value = c.id;
  document.getElementById('channelModal').classList.remove('hidden');
}

function closeChannelModal() {
  document.getElementById('channelModal').classList.add('hidden');
}

// Channel form submit
document.getElementById('channelForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('channelEditId').value;
  const name = document.getElementById('channelName').value.trim();
  const group = document.getElementById('channelGroup').value.trim() || 'عام';
  const url = document.getElementById('channelUrl').value.trim();
  const backupUrl = document.getElementById('channelBackupUrl').value.trim();
  const tvgLogo = document.getElementById('channelLogo').value.trim();
  const tvgId = document.getElementById('channelTvgId').value.trim();
  const enabled = document.getElementById('channelEnabled').checked;

  if (!name || !url) { alert('الاسم والرابط مطلوبان'); return; }

  const channelData = { name, group, url, tvgLogo, tvgId, enabled };
  if (backupUrl) channelData.backupUrls = [backupUrl];

  const btn = document.getElementById('channelSubmitBtn');
  btn.textContent = 'جاري الحفظ...';
  btn.disabled = true;

  try {
    if (editId) {
      // Update existing channel
      await api('PUT', '/channels/' + editId, channelData);
      alert('تم تعديل القناة بنجاح');
    } else {
      // Create new channel
      await api('POST', '/channels', channelData);
      alert('تم إضافة القناة بنجاح');
    }
    closeChannelModal();
    renderChannels();
  } catch (e) {
    alert('فشل الحفظ: ' + e.message);
  }

  btn.textContent = editId ? 'حفظ التعديلات' : 'إضافة قناة';
  btn.disabled = false;
});

// Close channel modal via close button
document.getElementById('channelModalClose')?.addEventListener('click', closeChannelModal);

// Add Channel button — add it dynamically when section-channels is rendered
// We inject button into section-header via mutation observer
(function() {
  const channelsSection = document.getElementById('section-channels');
  if (channelsSection) {
    const actionsDiv = channelsSection.querySelector('.section-actions');
    if (actionsDiv) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary';
      addBtn.id = 'addChannelBtn';
      addBtn.textContent = '+ إضافة قناة';
      addBtn.onclick = showAddChannelModal;
      actionsDiv.insertBefore(addBtn, actionsDiv.firstChild);
    }
  }
})();

// ═══════════════════ STREAMS ═════════════════════════

async function loadStreams() {
  try {
    const d = await api('GET', '/streams');
    const streams = d.streams || [];
    const tbody = document.getElementById('streamsTableBody');
    if (!streams.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">لا توجد بث نشط. شغّل قناة من قسم القنوات.</td></tr>';
      return;
    }
    tbody.innerHTML = streams.map(s => `
      <tr>
        <td>${esc(s.channelId || '-')}</td>
        <td>${s.isRunning ? '<span class="status-on">🟢 يعمل</span>' : '<span class="status-off">🔴 متوقف</span>'}</td>
        <td>${s.viewerCount || 0}</td>
        <td>${s.uptime ? Math.floor(s.uptime / 60) + 'm ' + (s.uptime % 60) + 's' : '-'}</td>
        <td>
          <button class="btn-sm btn-danger" onclick="stopStream('${s.channelId}')">إيقاف</button>
          <button class="btn-sm" onclick="openChannelViewer('${s.channelId}')">مشاهدة</button>
        </td>
      </tr>
    `).join('');
  } catch (e) { console.warn('Streams error'); }
}

async function stopStream(id) {
  await api('POST', '/streams/' + id + '/stop');
  loadStreams();
  renderChannels();
}

// ─── Health ──────────────────────────────────────────

document.getElementById('healthTestBtn')?.addEventListener('click', async function() {
  const url = document.getElementById('healthUrl').value.trim();
  if (!url) return;
  const resultDiv = document.getElementById('healthResult');
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = '<div class="loading-text">جاري الاختبار باستخدام ffprobe...</div>';
  this.textContent = 'جاري...';
  this.disabled = true;
  try {
    const r = await api('POST', '/health/test', { url });
    let errorHtml = '';
    if (r.error) {
      errorHtml = '<div style="color:var(--live);margin-top:12px;padding:10px;background:rgba(226,73,59,0.1);border-radius:6px;max-height:200px;overflow:auto;font-family:monospace;font-size:12px;white-space:pre-wrap;direction:ltr;text-align:left">' +
        '<strong style="display:block;margin-bottom:6px">❌ تفاصيل خطأ ffprobe:</strong>' +
        esc(r.error) + '</div>';
    }
    resultDiv.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
        <div><strong>الحالة:</strong> ${r.isOnline ? '🟢 متصل' : '🔴 غير متصل'}</div>
        <div><strong>زمن الاستجابة:</strong> ${r.responseTime || 0}ms</div>
        <div><strong>الحاوية:</strong> ${r.container || '-'}</div>
        <div><strong>الكوديك:</strong> ${r.codec || '-'}</div>
        <div><strong>الدقة:</strong> ${r.resolution || '-'}</div>
        <div><strong>FPS:</strong> ${r.fps || '-'}</div>
        <div><strong>الصوت:</strong> ${r.audio || '-'}</div>
        <div><strong>معدل العينة:</strong> ${r.audioSampleRate || '-'}</div>
        <div><strong>معدل البت:</strong> ${r.bitrate ? (r.bitrate/1000).toFixed(0) + ' kbps' : '-'}</div>
        <div><strong>وقت البدء:</strong> ${r.latency ? parseFloat(r.latency).toFixed(2) + 's' : '-'}</div>
      </div>
      ${errorHtml}
    `;
  } catch (e) {
    resultDiv.innerHTML = '<div style="color:var(--live)">فشل الاتصال بالخادم</div>';
  }
  this.textContent = 'اختبار';
  this.disabled = false;
});

// ─── Config ──────────────────────────────────────────

async function loadConfig() {
  try {
    const d = await api('GET', '/config');
    document.getElementById('configDisplay').textContent = JSON.stringify(d.config, null, 2);
  } catch (e) {
    document.getElementById('configDisplay').textContent = 'فشل تحميل الإعدادات';
  }
}

// ─── Logs ────────────────────────────────────────────

async function loadLogs() {
  try {
    const d = await api('GET', '/logs');
    const logs = d.logs || [];
    const body = document.getElementById('logBody');
    if (!logs.length) {
      body.innerHTML = '<div class="log-empty">لا توجد سجلات</div>';
      return;
    }
    body.innerHTML = logs.map(line => `<div class="log-line">${esc(line)}</div>`).join('');
  } catch (e) {
    document.getElementById('logBody').innerHTML = '<div class="log-empty">فشل تحميل السجلات</div>';
  }
}

document.getElementById('clearLogsBtn')?.addEventListener('click', async () => {
  await api('DELETE', '/logs');
  loadLogs();
});

document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);

// ─── Toast ───────────────────────────────────────────

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--accent);color:var(--text);padding:10px 20px;border-radius:8px;z-index:9999;font-size:14px;transition:opacity 0.3s';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// ─── Utility ─────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
}

// ─── Init ────────────────────────────────────────────

loadDashboard();