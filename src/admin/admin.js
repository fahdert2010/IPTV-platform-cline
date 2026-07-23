/* ═══════════════════════════════════════════════
   Mubasher Core v2.0 — Operations Center
   ═══════════════════════════════════════════════ */
let AUTH = '';
let INTERVAL = null;
let SSE = null;
let CHANNELS = [], SOURCES = [], STREAMS = [], VIEWERS = [], HEALTH = [];
let LOGS_CACHE = [];

// ═══ AUTH ═══
document.getElementById('login-form').onsubmit = async e => {
  e.preventDefault();
  const u = document.getElementById('login-user').value;
  const p = document.getElementById('login-pass').value;
  AUTH = 'Basic ' + btoa(u + ':' + p);
  const ok = await api('/admin/dashboard');
  if (!ok) { document.getElementById('login-error').textContent = 'خطأ في تسجيل الدخول'; return; }
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  init();
};

async function api(path, opts = {}) {
  try {
    // Fix: backend routes are mounted under /api prefix
    // (router.use('/admin', adminRouter) then app.use('/api', router))
    // But frontend calls paths like /admin/streams without /api
    const url = path.startsWith('/api/') ? path : '/api' + path;
    const res = await fetch(url, {
      headers: { 'Authorization': AUTH, 'Content-Type': 'application/json', ...opts.headers },
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401) { document.getElementById('login-overlay').style.display = 'flex'; return null; }
    return res.status === 204 ? true : await res.json();
  } catch { return null; }
}

// ═══ NAV ═══
document.querySelectorAll('#sidebar nav a').forEach(a => {
  a.onclick = () => {
    document.querySelectorAll('#sidebar nav a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + a.dataset.page);
    if (page) page.classList.add('active');
    document.getElementById('page-title').textContent = a.querySelector('span:nth-child(2)').textContent;
    loadPage(a.dataset.page);
  };
});

function loadPage(name) {
  const fns = {
    overview: loadOverview, channels: loadChannels, sources: loadSources,
    streams: loadStreams, ffmpeg: loadFFmpeg, viewers: loadViewers,
    hls: loadHls, health: loadHealth, diagnostics: loadDiagnostics,
    logs: loadLogs, settings: loadSettings
  };
  if (fns[name]) fns[name]();
}

// ═══ INIT ═══
function init() {
  loadOverview();
  // SSE for real-time updates
  if (SSE) SSE.close();
  SSE = new EventSource('/api/admin/events');
  SSE.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'update') updateDashboard(d.data);
    } catch {}
  };
  // Clock
  setInterval(() => {
    document.getElementById('header-time').textContent = new Date().toLocaleTimeString('ar-SA');
  }, 1000);
}

// ═══ OVERVIEW ═══
async function loadOverview() {
  const d = await api('/admin/dashboard');
  if (!d) return;
  renderOverview(d);
}

function renderOverview(d) {
  const { channels, viewers, health, cache, sources, streams, system } = d;
  document.getElementById('header-viewers').textContent = (viewers?.current || 0) + ' مشاهد';
  document.getElementById('uptime-display').textContent = formatUptime(system?.uptimeSeconds || 0);
  document.getElementById('status-dot').className = 'dot online';

  // Stats row
  document.getElementById('overview-stats').innerHTML = `
    <div class="stat"><div class="val">${channels?.total||0}</div><div class="lbl">إجمالي القنوات</div></div>
    <div class="stat"><div class="val green">${channels?.running||0}</div><div class="lbl">بث نشط</div></div>
    <div class="stat"><div class="val yellow">${channels?.starting||0}</div><div class="lbl">قيد التشغيل</div></div>
    <div class="stat"><div class="val red">${channels?.error||0}</div><div class="lbl">أخطاء</div></div>
    <div class="stat"><div class="val">${viewers?.current||0}</div><div class="lbl">المشاهدون</div></div>
    <div class="stat"><div class="val purple">${(streams||[]).length}</div><div class="lbl">عمليات FFmpeg</div></div>
  `;

  // Streams status
  let sHtml = '<div class="info-row"><span class="k">ONLINE</span><span class="v green">' + (channels?.running||0) + '</span></div>';
  sHtml += '<div class="info-row"><span class="k">ERROR</span><span class="v red">' + (channels?.error||0) + '</span></div>';
  sHtml += '<div class="info-row"><span class="k">قيد التشغيل</span><span class="v yellow">' + (channels?.starting||0) + '</span></div>';
  sHtml += '<div class="info-row"><span class="k">متوقف</span><span class="v">' + (channels?.idle||0) + '</span></div>';
  document.getElementById('ov-streams').innerHTML = sHtml;

  // Health
  const h = health || {};
  document.getElementById('ov-health').innerHTML = `
    <div class="info-row"><span class="k">متوسط الدرجة</span><span class="v">${h.averageScore||0}%</span></div>
    <div class="info-row"><span class="k">سليم</span><span class="v green">${h.healthy||0}</span></div>
    <div class="info-row"><span class="k">تحذير</span><span class="v yellow">${h.warning||0}</span></div>
    <div class="info-row"><span class="k">خطير</span><span class="v red">${h.critical||0}</span></div>
    <div class="info-row"><span class="k">غير متصل</span><span class="v">${h.offline||0}</span></div>
  `;

  // Viewers
  document.getElementById('ov-viewers').innerHTML = `
    <div class="info-row"><span class="k">حاليًا</span><span class="v">${viewers?.current||0}</span></div>
    <div class="info-row"><span class="k">الإجمالي</span><span class="v">${viewers?.total||0}</span></div>
  `;

  // Sources
  document.getElementById('ov-sources').innerHTML = `
    <div class="info-row"><span class="k">الإجمالي</span><span class="v">${sources?.total||0}</span></div>
    <div class="info-row"><span class="k">مفعل</span><span class="v green">${sources?.enabled||0}</span></div>
  `;

  // Cache
  const c = cache || {};
  document.getElementById('ov-cache').innerHTML = `
    <div class="info-row"><span class="k">مقاطع</span><span class="v">${c.segmentCount||0}</span></div>
    <div class="info-row"><span class="k">نسبة الإصابة</span><span class="v">${c.hitRate||0}%</span></div>
    <div class="info-row"><span class="k">RAM</span><span class="v">${fmtBytes(c.ramUsedBytes||0)}</span></div>
    <div class="info-row"><span class="k">القرص</span><span class="v">${fmtBytes(c.diskUsedBytes||0)}</span></div>
  `;

  // Badges
  if (channels?.error > 0) showBadge('overview', channels.error);
  else hideBadge('overview');
  if (viewers?.current > 0) showBadge('viewers', viewers.current);
  else hideBadge('viewers');
  if (channels?.error > 0) showBadge('health', channels.error);
  else hideBadge('health');

  // System info
  document.getElementById('sys-cpu').textContent = 'CPU —%';
  document.getElementById('sys-ram').textContent = 'RAM ' + fmtBytes(system?.memoryRssMb*1024*1024 || 0);
}

function updateDashboard(d) {
  if (document.getElementById('page-overview').classList.contains('active')) renderOverview(d);
}

// ═══ CHANNELS ═══
async function loadChannels() {
  const data = await api('/admin/channels');
  if (!data) return;
  CHANNELS = data.channels || [];
  renderChannels();
}

function renderChannels() {
  const search = (document.getElementById('ch-search')?.value || '').toLowerCase();
  const stateFilter = document.getElementById('ch-filter-state')?.value || '';
  let list = CHANNELS;
  if (search) list = list.filter(c => (c.name||'').toLowerCase().includes(search) || (c.group||'').toLowerCase().includes(search));
  if (stateFilter) list = list.filter(c => c.state === stateFilter);
  
  document.getElementById('ch-tbody').innerHTML = list.map(c => `
    <tr>
      <td><input type="checkbox" class="ch-cb" value="${c.id}"></td>
      <td>${c.number||''}</td>
      <td><strong>${esc(c.name)||'(بدون اسم)'}</strong></td>
      <td>${esc(c.group)}</td>
      <td><span class="badge-state ${(c.state||'STOPPED').toLowerCase()}">${c.state||'STOPPED'}</span></td>
      <td>${c.viewerCount||0}</td>
      <td>${c.healthScore != null ? c.healthScore + '%' : '—'}</td>
      <td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis">${c.primarySource ? esc(c.primarySource).slice(0,12)+'…' : (c.url ? 'URL' : '—')}</td>
      <td style="font-size:11px">${c.startedAt ? formatUptime((Date.now()-c.startedAt)/1000) : '—'}</td>
      <td>
        <button class="btn btn-sm" onclick="streamAction('${c.id}','${c.state==='ONLINE'?'stop':'start'}')">${c.state==='ONLINE'?'⏹':'▶️'}</button>
        <button class="btn btn-sm" onclick="editChannel('${c.id}')">✏️</button>
        <button class="btn btn-sm" onclick="deleteChannel('${c.id}')">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10" class="empty-row">لا توجد قنوات</td></tr>';
}

function filterTable(pfx) {
  if (pfx === 'ch') renderChannels();
  if (pfx === 'st') renderStreams();
  if (pfx === 'vw') renderViewers();
}

function toggleAll(pfx) {
  const checked = document.getElementById(pfx + '-select-all').checked;
  document.querySelectorAll('.' + pfx + '-cb').forEach(cb => cb.checked = checked);
}

async function bulkAction(action) {
  const ids = Array.from(document.querySelectorAll('.ch-cb:checked')).map(cb => cb.value);
  if (!ids.length) return;
  let res;
  if (action === 'enable') res = await api('/admin/channels/bulk/enable', { method: 'POST', body: { ids } });
  if (action === 'disable') res = await api('/admin/channels/bulk/disable', { method: 'POST', body: { ids } });
  if (action === 'delete') {
    if (!confirm('حذف ' + ids.length + ' قناة?')) return;
    res = await api('/admin/channels/bulk/delete', { method: 'POST', body: { ids } });
  }
  if (res) loadChannels();
}

async function streamAction(id, action) {
  if (action === 'start') await api('/admin/streams/' + id + '/start', { method: 'POST' });
  else await api('/admin/streams/' + id + '/stop', { method: 'POST' });
  setTimeout(loadChannels, 500);
}

async function deleteChannel(id) {
  if (!confirm('حذف القناة?')) return;
  await api('/admin/channels/' + id, { method: 'DELETE' });
  loadChannels();
}

async function showAddChannel() {
  document.getElementById('modal-title').textContent = '➕ إضافة قناة';
  const sources = await api('/admin/sources');
  const srcOpts = (sources?.sources||[]).map(s => `<option value="${s.id}">${esc(s.name)} (${s.type})</option>`).join('');
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>الاسم</label><input id="f-ch-name"></div>
      <div class="form-group"><label>الرقم</label><input id="f-ch-number" type="number"></div>
    </div>
    <div class="form-group"><label>المجموعة</label><input id="f-ch-group"></div>
    <div class="form-row">
      <div class="form-group"><label>المصدر</label><select id="f-ch-source">${srcOpts}</select></div>
      <div class="form-group"><label>Stream ID</label><input id="f-ch-streamid"></div>
    </div>
    <div class="form-group"><label>أو رابط مباشر</label><input id="f-ch-url"></div>
    <div class="form-row">
      <div class="form-group"><label>الترميز</label><select id="f-ch-vcodec"><option value="copy">copy</option><option value="libx264">libx264</option></select></div>
      <div class="form-group"><label>الترميز الصوتي</label><select id="f-ch-acodec"><option value="copy">copy</option><option value="aac">aac</option></select></div>
    </div>
    <button class="btn-primary" onclick="addChannel()">➕ إضافة</button>
  `;
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal').style.display = 'flex';
}

async function addChannel() {
  const name = document.getElementById('f-ch-name').value;
  const source = document.getElementById('f-ch-source').value;
  const streamId = document.getElementById('f-ch-streamid').value;
  const url = document.getElementById('f-ch-url').value;
  const body = {
    name: name || 'قناة جديدة',
    number: parseInt(document.getElementById('f-ch-number').value) || 0,
    group: document.getElementById('f-ch-group').value,
    primarySource: source || null,
    primaryStreamId: streamId || null,
    url: url || '',
    videoCodec: document.getElementById('f-ch-vcodec').value,
    audioCodec: document.getElementById('f-ch-acodec').value
  };
  const res = await api('/admin/channels', { method: 'POST', body });
  if (res && res.channel) { closeModal(); loadChannels(); }
  else alert('فشل: ' + (res?.error || ''));
}

async function editChannel(id) {
  const ch = CHANNELS.find(c => c.id === id);
  if (!ch) return;
  document.getElementById('modal-title').textContent = '✏️ تعديل: ' + esc(ch.name);
  const sources = await api('/admin/sources');
  const srcOpts = (sources?.sources||[]).map(s => `<option value="${s.id}" ${s.id===ch.primarySource?'selected':''}>${esc(s.name)}</option>`).join('');
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>الاسم</label><input id="f-ch-name" value="${esc(ch.name)}"></div>
      <div class="form-group"><label>الرقم</label><input id="f-ch-number" type="number" value="${ch.number||0}"></div>
    </div>
    <div class="form-group"><label>المجموعة</label><input id="f-ch-group" value="${esc(ch.group||'')}"></div>
    <div class="form-row">
      <div class="form-group"><label>المصدر</label><select id="f-ch-source">${srcOpts}</select></div>
      <div class="form-group"><label>Stream ID</label><input id="f-ch-streamid" value="${esc(ch.primaryStreamId||'')}"></div>
    </div>
    <div class="form-group"><label>رابط مباشر</label><input id="f-ch-url" value="${esc(ch.url||'')}"></div>
    <button class="btn-primary" onclick="updateChannel('${id}')">💾 حفظ</button>
  `;
  openModal();
}

async function updateChannel(id) {
  const body = {
    name: document.getElementById('f-ch-name').value,
    number: parseInt(document.getElementById('f-ch-number').value) || 0,
    group: document.getElementById('f-ch-group').value,
    primarySource: document.getElementById('f-ch-source').value || null,
    primaryStreamId: document.getElementById('f-ch-streamid').value || null,
    url: document.getElementById('f-ch-url').value || ''
  };
  const res = await api('/admin/channels/' + id, { method: 'PUT', body });
  if (res) { closeModal(); loadChannels(); }
}

// ═══ SOURCES ═══
async function loadSources() {
  const data = await api('/admin/sources');
  if (!data) return;
  SOURCES = data.sources || [];
  document.getElementById('src-tbody').innerHTML = SOURCES.map(s => `
    <tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${s.type}</td>
      <td><span class="badge-state ${(s.status||'unknown') === 'healthy' ? 'online' : 'error'}">${s.status||'unknown'}</span></td>
      <td>${s.totalChannels||0}</td>
      <td style="font-size:11px">${s.lastSync ? new Date(s.lastSync).toLocaleString('ar-SA') : '—'}</td>
      <td>${s.enabled ? '✅' : '❌'}</td>
      <td>${s.failedChannels||0}</td>
      <td>
        ${s.enabled ? `<button class="btn btn-sm" onclick="toggleSource('${s.id}','disable')">تعطيل</button>` : `<button class="btn btn-sm" onclick="toggleSource('${s.id}','enable')">تفعيل</button>`}
        <button class="btn btn-sm" onclick="importSource('${s.id}')">📥 استيراد</button>
        <button class="btn btn-sm" onclick="editSource('${s.id}')">✏️</button>
        <button class="btn btn-sm" onclick="deleteSource('${s.id}')">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="empty-row">لا توجد مصادر</td></tr>';
}

async function toggleSource(id, action) {
  await api('/admin/sources/' + id + '/' + action, { method: 'POST' });
  loadSources();
}

async function importSource(id) {
  const r = await api('/admin/sources/' + id + '/import', { method: 'POST' });
  if (r) loadSources();
}

async function deleteSource(id) {
  if (!confirm('حذف المصدر?')) return;
  await api('/admin/sources/' + id, { method: 'DELETE' });
  loadSources();
}

async function importAllSources() {
  const r = await api('/admin/sources/import-all', { method: 'POST' });
  if (r) { loadSources(); loadChannels(); }
}

async function showAddSource() {
  document.getElementById('modal-title').textContent = '➕ إضافة مصدر';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>الاسم</label><input id="f-src-name"></div>
      <div class="form-group"><label>النوع</label><select id="f-src-type">
        <option value="m3u">M3U</option><option value="m3u_file">M3U File</option>
        <option value="xtream">Xtream</option><option value="stalker">Stalker</option>
        <option value="hls">Direct HLS</option>
      </select></div>
    </div>
    <div class="form-group"><label>الرابط</label><input id="f-src-url"></div>
    <div class="form-row">
      <div class="form-group"><label>اسم المستخدم</label><input id="f-src-user"></div>
      <div class="form-group"><label>كلمة المرور</label><input id="f-src-pass" type="password"></div>
    </div>
    <button class="btn-primary" onclick="addSource()">➕ إضافة</button>
  `;
  openModal();
}

async function addSource() {
  const body = {
    name: document.getElementById('f-src-name').value || 'مصدر جديد',
    type: document.getElementById('f-src-type').value,
    baseUrl: document.getElementById('f-src-url').value,
    username: document.getElementById('f-src-user').value,
    password: document.getElementById('f-src-pass').value
  };
  const res = await api('/admin/sources', { method: 'POST', body });
  if (res) { closeModal(); loadSources(); }
}

// ═══ STREAMS ═══
async function loadStreams() {
  const data = await api('/admin/streams');
  if (!data) return;
  STREAMS = data.streams || [];
  renderStreams();
}

function renderStreams() {
  const search = (document.getElementById('st-search')?.value || '').toLowerCase();
  let list = STREAMS;
  if (search) list = list.filter(s => (s.channelId||'').toLowerCase().includes(search));
  
  document.getElementById('st-tbody').innerHTML = list.map(s => `
    <tr>
      <td><strong>${esc(s.channelId||'')}</strong></td>
      <td><span class="badge-state ${(s.state||'STOPPED').toLowerCase()}">${s.state||'STOPPED'}</span></td>
      <td>${s.viewers||0}</td>
      <td style="font-size:11px">${s.pid||'—'}</td>
      <td>${s.cpu||0}%</td>
      <td>${fmtBytes((s.memory||0)*1024*1024)}</td>
      <td style="font-size:11px">${formatUptime(s.uptime||0)}</td>
      <td>${s.reconnectCount||0}</td>
      <td style="font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis">${s.currentUrlIndex != null ? '#'+s.currentUrlIndex : '—'}</td>
      <td style="font-size:10px;max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(s.currentUrl||'')}</td>
      <td>
        <button class="btn btn-sm" onclick="streamAction('${s.channelId}','${s.state==='ONLINE'?'stop':'start'}')">${s.state==='ONLINE'?'⏹':'▶️'}</button>
        <button class="btn btn-sm" onclick="restartStream('${s.channelId}')">🔄</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="11" class="empty-row">لا توجد بثوث نشطة</td></tr>';
}

async function restartStream(id) {
  await api('/admin/streams/' + id + '/restart', { method: 'POST' });
  setTimeout(loadStreams, 1000);
}

// ═══ FFMPEG ═══
async function loadFFmpeg() {
  const data = await api('/admin/streams');
  if (!data) return;
  const streams = data.streams || [];
  const running = streams.filter(s => s.pid);
  document.getElementById('ffmpeg-cards').innerHTML = running.length
    ? running.map(s => `
      <div class="ff-card">
        <h4><span class="badge-state ${(s.state||'').toLowerCase()}">${s.state}</span> ${esc(s.channelId)} <span style="font-size:11px;color:var(--text2)">PID: ${s.pid}</span></h4>
        <div class="ff-grid">
          <div class="ff-item"><strong>CPU</strong> ${s.cpu||0}%</div>
          <div class="ff-item"><strong>RAM</strong> ${fmtBytes((s.memory||0)*1024*1024)}</div>
          <div class="ff-item"><strong>وقت التشغيل</strong> ${formatUptime(s.uptime||0)}</div>
          <div class="ff-item"><strong>المشاهدون</strong> ${s.viewers||0}</div>
          <div class="ff-item"><strong>المحاولات</strong> ${s.reconnectCount||0}</div>
          <div class="ff-item" style="grid-column:1/-1"><strong>الـ URL</strong> <span style="font-size:10px;word-break:break-all">${esc(s.currentUrl||'')}</span></div>
        </div>
        ${s.hls ? `
        <div style="margin-top:8px">
          <div class="hls-metrics">
            <div class="hls-metric"><div class="val">${s.hls.segmentsOnDisk||0}</div><div class="lbl">مقاطع</div></div>
            <div class="hls-metric"><div class="val">${s.hls.currentSequence||0}</div><div class="lbl">التسلسل</div></div>
            <div class="hls-metric"><div class="val">${s.hls.segmentsInPlaylist||0}</div><div class="lbl">بالقائمة</div></div>
            <div class="hls-metric"><div class="val" style="color:${(s.hls.segmentMisses||0)>0?'var(--red)':'var(--green)'}">${s.hls.segmentMisses||0}</div><div class="lbl">مقاطع مفقودة</div></div>
          </div>
        </div>` : ''}
        <div style="margin-top:8px;display:flex;gap:4px">
          <button class="btn btn-sm" onclick="streamAction('${s.channelId}','stop')">⏹ إيقاف</button>
          <button class="btn btn-sm" onclick="restartStream('${s.channelId}')">🔄 إعادة تشغيل</button>
        </div>
      </div>
    `).join('')
    : '<div class="card"><div class="card-body" style="text-align:center;padding:30px">لا توجد عمليات FFmpeg نشطة</div></div>';
}

// ═══ VIEWERS ═══
async function loadViewers() {
  const data = await api('/admin/viewers');
  if (!data) return;
  VIEWERS = data.viewers || [];
  renderViewers();
}

function renderViewers() {
  const search = (document.getElementById('vw-search')?.value || '').toLowerCase();
  let list = VIEWERS;
  if (search) list = list.filter(v => (v.ip||'').includes(search) || (v.device||'').toLowerCase().includes(search));
  
  document.getElementById('vw-tbody').innerHTML = list.map(v => `
    <tr>
      <td>${v.ip||'—'}</td>
      <td>${esc(v.device||'—')}</td>
      <td>${esc(v.browser||'—')}</td>
      <td>${esc(v.currentChannel||'—')}</td>
      <td>${formatUptime(v.watchTime||0)}</td>
      <td>${v.bandwidth ? fmtBandwidth(v.bandwidth) : '—'}</td>
      <td>${v.latency ? v.latency+'ms' : '—'}</td>
      <td style="font-size:11px">${v.lastHeartbeat ? new Date(v.lastHeartbeat).toLocaleTimeString('ar-SA') : '—'}</td>
      <td><button class="btn btn-sm" onclick="kickViewer('${v.id}')">🔨 طرد</button></td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty-row">لا يوجد مشاهدون</td></tr>';
}

async function kickViewer(id) {
  await api('/admin/viewers/' + id + '/kick', { method: 'POST' });
  loadViewers();
}

// ═══ HLS ═══
async function loadHls() {
  const data = await api('/api/hls/debug');
  if (!data) return;
  const chs = data.channels || [];
  document.getElementById('hls-cards').innerHTML = chs.length
    ? chs.map(ch => `
      <div class="card">
        <h3>${esc(ch.channelId||'')} ${ch.producerRunning ? '<span class="live-dot"></span>' : ''}</h3>
        <div class="hls-metrics">
          <div class="hls-metric"><div class="val">${ch.segmentsOnDisk||0}</div><div class="lbl">مقاطع على القرص</div></div>
          <div class="hls-metric"><div class="val">${ch.segmentsInPlaylist||0}</div><div class="lbl">في القائمة</div></div>
          <div class="hls-metric"><div class="val">${ch.currentSequence||0}</div><div class="lbl">التسلسل الحالي</div></div>
          <div class="hls-metric"><div class="val ${(ch.missingSegments||0)>0?'red':'green'}">${ch.missingSegments||0}</div><div class="lbl">مقاطع مفقودة</div></div>
          <div class="hls-metric"><div class="val">${ch.lockedSegments||0}</div><div class="lbl">مقاطع مقفلة</div></div>
          <div class="hls-metric"><div class="val">${ch.deletedSegments||0}</div><div class="lbl">محذوفة</div></div>
          <div class="hls-metric"><div class="val">${ch.playlistRewrites||0}</div><div class="lbl">إعادة كتابة</div></div>
          <div class="hls-metric"><div class="val">${ch.averagePlaylistAge ? (ch.averagePlaylistAge/1000).toFixed(1)+'s' : '—'}</div><div class="lbl">متوسط العمر</div></div>
        </div>
        <div style="font-size:11px;color:var(--text2)">
          ${ch.playlist ? 'آخر مقاطع: ' + ch.playlist.slice(-5).join(', ') : ''}
        </div>
      </div>
    `).join('')
    : '<div class="card"><div class="card-body" style="text-align:center;padding:30px">لا توجد بيانات HLS</div></div>';
}

// ═══ HEALTH ═══
async function loadHealth() {
  const data = await api('/admin/health');
  if (!data) return;
  HEALTH = data.channels || [];
  
  const stats = { healthy: 0, warning: 0, critical: 0 };
  HEALTH.forEach(h => {
    if (h.score >= 80) stats.healthy++;
    else if (h.score >= 50) stats.warning++;
    else stats.critical++;
  });
  
  document.getElementById('health-stats-row').innerHTML = `
    <div class="stat"><div class="val green">${stats.healthy}</div><div class="lbl">سليم</div></div>
    <div class="stat"><div class="val yellow">${stats.warning}</div><div class="lbl">تحذير</div></div>
    <div class="stat"><div class="val red">${stats.critical}</div><div class="lbl">خطير</div></div>
  `;
  
  document.getElementById('hl-tbody').innerHTML = HEALTH.map(h => `
    <tr>
      <td><strong>${esc(h.channelId||'')}</strong></td>
      <td><span class="badge-health ${h.score >= 80 ? 'high' : h.score >= 50 ? 'med' : 'low'}"></span> ${h.score||0}</td>
      <td>${h.latency ? h.latency+'ms' : '—'}</td>
      <td>${h.bitrate ? fmtBandwidth(h.bitrate) : '—'}</td>
      <td>${h.resolution||'—'}</td>
      <td>${h.codec||'—'}</td>
      <td>${h.segmentsOnDisk||0}</td>
      <td>${h.mediaSequence||0}</td>
      <td>${formatUptime(h.uptime||0)}</td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty-row">لا توجد بيانات صحة</td></tr>';
}

// ═══ DIAGNOSTICS ═══
async function loadDiagnostics() {
  const chData = await api('/admin/channels');
  const chs = chData?.channels || [];
  const broken = chs.filter(c => c.state === 'ERROR' || (!c.primarySource && !c.url));
  const healthy = chs.filter(c => c.state === 'ONLINE');
  
  document.getElementById('diag-stats').innerHTML = `
    <div class="stat"><div class="val green">${healthy.length}</div><div class="lbl">سليمة</div></div>
    <div class="stat"><div class="val red">${broken.length}</div><div class="lbl">معطلة</div></div>
    <div class="stat"><div class="val">${chs.length}</div><div class="lbl">الإجمالي</div></div>
  `;
  
  let body = '';
  if (broken.length) {
    body += '<h4 style="margin-bottom:8px;color:var(--red)">⚠️ قنوات معطلة</h4>';
    broken.forEach(c => {
      const missingBinding = !c.primarySource && !c.primaryStreamId && !c.url;
      body += `<div class="diag-cause ${missingBinding ? 'high' : 'med'}">
        <strong>${esc(c.name)||c.id}</strong>
        <div style="margin-top:4px;font-size:12px">${missingBinding
          ? '🔴 السبب: القناة ليس لديها primarySource أو primaryStreamId أو رابط مباشر'
          : '🟡 الحالة: ' + (c.state||'STOPPED')}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">الإصلاح: أعد استيراد المصادر أو أضف رابط مباشر</div>
      </div>`;
    });
  }
  if (healthy.length) {
    body += '<h4 style="margin-top:16px;margin-bottom:8px;color:var(--green)">✅ قنوات سليمة</h4>';
    healthy.slice(0, 10).forEach(c => {
      body += `<div class="info-row"><span class="k">${esc(c.name)||c.id}</span><span class="v green">ONLINE (${c.viewerCount||0} مشاهد)</span></div>`;
    });
    if (healthy.length > 10) body += `<div class="info-row"><span class="k">و ${healthy.length-10} أخرى...</span></div>`;
  }
  document.getElementById('diag-body').innerHTML = body || '<p>جميع القنوات سليمة ✅</p>';
}

// ═══ LOGS ═══
async function loadLogs() {
  const level = document.getElementById('log-level').value;
  const search = document.getElementById('log-search').value;
  let url = '/admin/logs';
  if (level) url += '?level=' + level;
  if (search) url += (level ? '&' : '?') + 'search=' + encodeURIComponent(search);
  const data = await api(url);
  if (!data) return;
  LOGS_CACHE = data.logs || [];
  
  document.getElementById('logs-container').innerHTML = LOGS_CACHE.map(l => `
    <div class="log-entry">
      <span class="log-time">${l.timestamp ? new Date(l.timestamp).toLocaleString('ar-SA') : ''}</span>
      <span class="log-level ${l.level||'info'}">${(l.level||'info').toUpperCase()}</span>
      <span class="log-msg">${esc(l.message||'')}</span>
    </div>
  `).join('') || '<div class="log-entry"><span class="log-msg">لا توجد سجلات</span></div>';
}

// ═══ SETTINGS ═══
async function loadSettings() {
  const data = await api('/admin/config');
  if (!data) return;
  const cfg = data.config || {};
  const s = (id, val) => `<div class="form-group"><label>${id}</label><input id="st-${id}" value="${esc(String(val||''))}"></div>`;

  document.getElementById('set-stream').innerHTML = `
    ${s('stream.hlsRoot', cfg.stream?.hlsRoot)}
    ${s('stream.idleStopSeconds', cfg.stream?.idleStopSeconds)}
  `;
  document.getElementById('set-cache').innerHTML = `
    ${s('cache.ramBufferSizeMb', cfg.cache?.ramBufferSizeMb)}
    ${s('cache.diskCacheSizeMb', cfg.cache?.diskCacheSizeMb)}
  `;
  document.getElementById('set-ffmpeg').innerHTML = `
    ${s('ffmpeg.path', cfg.ffmpeg?.path)}
    ${s('ffmpeg.hlsTime', cfg.ffmpeg?.hlsTime)}
    ${s('ffmpeg.threads', cfg.ffmpeg?.threads)}
  `;
  document.getElementById('set-server').innerHTML = `
    ${s('server.port', cfg.server?.port)}
    ${s('server.host', cfg.server?.host)}
  `;
}

async function saveSettings() {
  const updates = {};
  document.querySelectorAll('[id^="st-"]').forEach(el => {
    const key = el.id.slice(3);
    updates[key] = el.value;
  });
  const res = await api('/admin/config', { method: 'PUT', body: updates });
  if (res) alert('✅ تم حفظ الإعدادات');
}

// ═══ HELPERS ═══
function esc(s) { return String(s||'').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"'); }

function formatUptime(sec) {
  if (!sec || sec < 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return h+'h '+m+'m';
  if (m) return m+'m '+s+'s';
  return s+'s';
}

function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB'];
  let i = 0;
  while (b >= 1024 && i < u.length-1) { b /= 1024; i++; }
  return (i > 0 ? b.toFixed(1) : Math.floor(b)) + ' ' + u[i];
}

function fmtBandwidth(bps) {
  if (!bps) return '—';
  if (bps >= 1000000) return (bps/1000000).toFixed(1) + ' Mbps';
  if (bps >= 1000) return (bps/1000).toFixed(0) + ' Kbps';
  return bps + ' bps';
}

function showBadge(id, count) {
  const el = document.getElementById('badge-' + id);
  if (el) { el.textContent = count; el.classList.add('show'); }
}
function hideBadge(id) {
  const el = document.getElementById('badge-' + id);
  if (el) el.classList.remove('show');
}

function openModal() {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal').style.display = 'none';
}

// ═══ AUTO REFRESH ═══
setInterval(() => {
  const active = document.querySelector('.page.active');
  if (!active) return;
  const id = active.id;
  if (id === 'page-overview') loadOverview();
  else if (id === 'page-streams') loadStreams();
  else if (id === 'page-viewers') loadViewers();
}, 5000);