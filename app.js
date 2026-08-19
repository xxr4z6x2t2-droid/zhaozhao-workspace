// ===== 昭朝工作台 v2.6 — 饮食诊断与安全修复版 =====
// 所有数据存储在浏览器 localStorage，无需后端服务器
// 可部署到任何静态托管服务（CloudStudio / GitHub Pages / Vercel 等）

// ===== localStorage 工具 =====
function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
// HTML 转义：用户输入内容拼 innerHTML 前调用，防自注入 XSS
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function safeUrl(s) {
  try { const u = new URL(String(s || ''), location.href); return /^https?:$/.test(u.protocol) ? esc(u.href) : '#'; }
  catch { return '#'; }
}
function safeColor(s) { return /^#[0-9a-fA-F]{3,8}$/.test(String(s || '')) ? String(s) : '#888'; }

// ===== 默认数据 =====
const DEFAULT_WEIGHT = { records: [], goal: 75 };
const DEFAULT_HABITS = {
  habits: [
    { id: 'water', name: '喝水 2L', icon: '💧' },
    { id: 'exercise', name: '运动 30min', icon: '🏃' },
    { id: 'sleep', name: '早睡 23:00', icon: '😴' },
  ],
  logs: {}
};
const DEFAULT_LEDGER = { records: [], monthlyBudget: 3000 };
const DEFAULT_READING = { books: [] };
const DEFAULT_WORKLOG = { logs: [] };
const DEFAULT_KNOWLEDGE = { wiki: [], raw: [] };

// 自动生成 ID
let _idCounter = Date.now();
function genId() { return ++_idCounter; }

// ===== PWA Service Worker（网络优先策略，离线兜底，见 sw.js） =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ===== 时间显示 =====
function updateTime() {
  const now = new Date();
  document.getElementById('timeDisplay').textContent =
    now.toLocaleString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(updateTime, 1000); updateTime();

// ===== 主题系统 =====
const themes = {
  forest:   { name:'森系',    desc:'淡绿自然',   colors:['#f5f7f0','#5b8c3e','#eef5e8'] },
  minimal:  { name:'极简',    desc:'白底黑字',   colors:['#ffffff','#222222','#f0f0f0'] },
  chinese:  { name:'国风',    desc:'宣纸朱砂',   colors:['#fdf8f0','#c44536','#fef0ec'] },
  anime:    { name:'二次元',   desc:'粉嫩可爱',   colors:['#fef5f8','#e8517a','#fff0f5'] },
  tech:     { name:'科技暗色', desc:'深蓝代码',   colors:['#0f172a','#38bdf8','#0f2744'] },
  blue:     { name:'清爽蓝',   desc:'白底蓝缀',   colors:['#f0f5fa','#2563eb','#eff6ff'] },
  warm:     { name:'暖棕日系', desc:'米色温柔',   colors:['#faf6f0','#a0724a','#f8f0e8'] },
  night:    { name:'夜安',    desc:'低亮暖暗',   colors:['#1a1614','#d4a058','#2a2018'] },
};

let currentTheme = localStorage.getItem('zhaozhao-theme') || 'forest';

function applyTheme(themeId) {
  document.documentElement.setAttribute('data-theme', themeId);
  currentTheme = themeId;
  localStorage.setItem('zhaozhao-theme', themeId);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  renderThemeGrid();
}

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid');
  if (!grid) return;
  grid.innerHTML = Object.entries(themes).map(([id, t]) => `
    <div class="theme-card ${id === currentTheme ? 'active' : ''}" onclick="applyTheme('${id}')">
      <div class="theme-card-preview">
        <div style="background:${t.colors[0]}"></div>
        <div style="background:${t.colors[1]}"></div>
        <div style="background:${t.colors[2]}"></div>
      </div>
      <div class="theme-card-name">${esc(t.name)}</div>
      <div class="theme-card-desc">${esc(t.desc)}</div>
    </div>
  `).join('');
}

// ===== 备份恢复 =====
async function exportData() {
  try {
    const backup = {
      version: '2.6',
      exportedAt: new Date().toISOString(),
      diary: lsGet('zhaozhao-diary', []),
      theme: currentTheme,
      modules: lsGet('zhaozhao-modules', []),
      weatherCity: localStorage.getItem('zhaozhao-weather-city') || '',
      events: lsGet('zhaozhao-events', []),
      knowledge: lsGet('zhaozhao-knowledge', DEFAULT_KNOWLEDGE),
      weight: lsGet('zhaozhao-weight', DEFAULT_WEIGHT),
      habits: lsGet('zhaozhao-habits', DEFAULT_HABITS),
      ledger: lsGet('zhaozhao-ledger', DEFAULT_LEDGER),
      reading: lsGet('zhaozhao-reading', DEFAULT_READING),
      worklog: lsGet('zhaozhao-worklog', DEFAULT_WORKLOG),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `昭朝工作台备份_${fmtDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('导出成功', '数据备份', '已下载 JSON 文件');
  } catch(e) {
    showToast('导出失败', '数据备份', e.message);
  }
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('⚠️ 导入会覆盖现有数据。确定继续？')) { event.target.value = ''; return; }

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.events) lsSet('zhaozhao-events', data.events);
    if (data.knowledge) lsSet('zhaozhao-knowledge', data.knowledge);
    if (data.weight) lsSet('zhaozhao-weight', data.weight);
    if (data.habits) lsSet('zhaozhao-habits', data.habits);
    if (data.ledger) lsSet('zhaozhao-ledger', data.ledger);
    if (data.reading) lsSet('zhaozhao-reading', data.reading);
    if (data.worklog) lsSet('zhaozhao-worklog', data.worklog);
    if (data.diary) lsSet('zhaozhao-diary', data.diary);
    if (data.modules) lsSet('zhaozhao-modules', data.modules);
    if (data.weatherCity) localStorage.setItem('zhaozhao-weather-city', data.weatherCity);
    if (data.theme) applyTheme(data.theme);

    showToast('恢复成功', '数据导入', '已恢复所有数据');
    if (currentPage === 'settings') renderSettings();
    if (currentPage === 'events') loadEvents();
    if (currentPage === 'dashboard') loadDashboard();
  } catch(e) {
    showToast('导入失败', '数据恢复', e.message);
  }
  event.target.value = '';
}

function renderSettings() {
  renderThemeGrid();
}

// ===== 导航系统 =====
const mainPages = ['dashboard', 'meals', 'knowledge', 'events', 'dashboard-data'];
const bottomPages = ['settings'];
const allPages = [...mainPages, ...bottomPages];

// 宠物主题 SVG 图标
function petIcon(id, s) { s = s || 24;
  const icons = {
    // 小狗脸 — 主页
    dashboard: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 19Q7 7 4.5 15Q4 19 9.5 20"/><path d="M13.5 19Q17 7 19.5 15Q20 19 14.5 20"/><circle cx="12" cy="13" r="6"/><circle cx="10" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="12" r="1" fill="currentColor" stroke="none"/><ellipse cx="12" cy="15.5" rx="1.6" ry="1" fill="currentColor" stroke="none"/><path d="M10.5 16Q12 17.5 13.5 16"/></svg>`,
    // 骨头 — 知识库
    knowledge: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="10" width="10" height="4" rx="1"/><circle cx="8" cy="7.5" r="3.5"/><circle cx="8" cy="16.5" r="3.5"/><circle cx="16" cy="7.5" r="3.5"/><circle cx="16" cy="16.5" r="3.5"/></svg>`,
    // 爪印 — 事件
    events: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="16.5" rx="4.5" ry="3.5"/><circle cx="6" cy="9" r="2.5"/><circle cx="11.5" cy="6.5" r="2.5"/><circle cx="17" cy="8.5" r="2.5"/><circle cx="19" cy="11.5" r="2"/></svg>`,
    // 小狗屋 — 数据看板
    'dashboard-data': `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14L12 7L21 14Z"/><rect x="5" y="14" width="14" height="8" rx="1"/><path d="M9.5 22V17A1.5 1.5 0 0 1 11 15.5H13A1.5 1.5 0 0 1 14.5 17V22"/></svg>`,
    // 狗牌 — 设置
    settings: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="14" height="14" rx="6"/><circle cx="12" cy="13" r="2"/><ellipse cx="12" cy="17.5" rx="2.5" ry="1.8"/><circle cx="9.5" cy="16" r="1"/><circle cx="14.5" cy="16" r="1"/></svg>`,
    // 狗粮碗 — 饮食
    meals: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16l-1.6 6.2A3 3 0 0 1 15.5 19.5h-7A3 3 0 0 1 5.6 17.2L4 11z"/><path d="M8 3.5c0 1.2 1 1.5 1 2.75M12 3.5c0 1.2 1 1.5 1 2.75M16 3.5c0 1.2 1 1.5 1 2.75"/></svg>`,
    // 太阳 — 天气
    sun: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2V4M12 20V22M2 12H4M20 12H22M4.9 4.9L6.3 6.3M17.7 17.7L19.1 19.1M4.9 19.1L6.3 17.7M17.7 6.3L19.1 4.9"/></svg>`,
    // 爱心
    heart: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
    // 书本
    book: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    // 硬币
    coin: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19C3 20.66 7.03 22 12 22S21 20.66 21 19V5"/><path d="M3 12C3 13.66 7.03 15 12 15S21 13.66 21 12"/></svg>`,
    // 奖杯
    trophy: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/><path d="M6 9V4h12v5a6 6 0 0 1-12 0z"/><path d="M12 15V21M8 21h8"/></svg>`,
    // 闪电
    lightning: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    // 钟表
    clock: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  };
  return icons[id] || icons.dashboard;
}

const navIcons = { dashboard: 'dashboard', meals: 'meals', knowledge: 'knowledge', events: 'events', 'dashboard-data': 'dashboard-data', settings: 'settings' };
let currentPage = 'dashboard';

function buildNav() {
  const desktopNav = document.getElementById('navItems');
  const bottomNav = document.getElementById('navBottomItems');
  const mobileNav = document.getElementById('mobileNav');

  // 加载自定义模块
  const modules = lsGet('zhaozhao-modules', []);
  const allMain = [...mainPages, ...modules.map(m => m.id)];
  const allIcons = { ...navIcons };
  modules.forEach(m => { allIcons[m.id] = m.icon || 'dashboard'; });

  desktopNav.innerHTML = allMain.map(id => `
    <div class="nav-item ${id===currentPage?'active':''}" onclick="navigate('${id}')">
      <span class="nav-icon">${petIcon(allIcons[id] || 'dashboard')}</span> ${getPageName(id)}
    </div>
  `).join('');

  bottomNav.innerHTML = bottomPages.map(id => `
    <div class="nav-item ${id===currentPage?'active':''}" onclick="navigate('${id}')">
      <span class="nav-icon">${petIcon(navIcons[id])}</span> ${getPageName(id)}
    </div>
  `).join('');

  mobileNav.innerHTML = [...allMain, ...bottomPages].map(id => `
    <div class="mobile-nav-item ${id===currentPage?'active':''}" onclick="navigate('${id}')">
      <span class="m-nav-icon">${petIcon(allIcons[id] || 'dashboard', 22)}</span>
      ${getPageName(id).substring(0,2)}
    </div>
  `).join('');
}

function getPageName(id) {
  const map = { dashboard:'Dashboard', meals:'饮食', knowledge:'知识库', events:'事件', 'dashboard-data':'数据看板', settings:'设置' };
  // 检查自定义模块
  const modules = lsGet('zhaozhao-modules', []);
  const mod = modules.find(m => m.id === id);
  return mod ? mod.name : (map[id] || id);
}

function navigate(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
  currentPage = pageId;
  buildNav();
  if (pageId === 'dashboard') loadDashboard();
  if (pageId === 'meals') loadMeals();
  if (pageId === 'knowledge') loadKnowledge();
  if (pageId === 'events') loadEvents();
  if (pageId === 'dashboard-data') { switchDataTab('weight'); }
  if (pageId === 'settings') renderSettings();
}

// ===== Dashboard =====
async function loadDashboard() {
  const grid = document.getElementById('dashboardGrid');
  try {
    const eventsAll = lsGet('zhaozhao-events', []);
    const completed = eventsAll.filter(e => e.completed).length;
    const total = eventsAll.length;

    // 天气 — 首屏先用占位，渲染后再异步填充（Open-Meteo，国内可达）
    let weatherCity = localStorage.getItem('zhaozhao-weather-city') || '长春';
    const weather = { city: weatherCity, temp: '…', condition: '获取中', humidity: '--', wind: '--' };

    // 今日热点 — 从本地 hotspots.json 加载
    let hotspots = { date: '', gold: null, sections: [] };
    try {
      const hr = await fetch('hotspots.json?t=' + Date.now()).then(r => r.json());
      if (hr && hr.sections) hotspots = hr;
    } catch(e) { /* 热点数据不可用时用空 */ }

    // 数据摘要
    const weight = lsGet('zhaozhao-weight', DEFAULT_WEIGHT);
    const habits = lsGet('zhaozhao-habits', DEFAULT_HABITS);
    const ledger = lsGet('zhaozhao-ledger', DEFAULT_LEDGER);
    const reading = lsGet('zhaozhao-reading', DEFAULT_READING);
    const worklog = lsGet('zhaozhao-worklog', DEFAULT_WORKLOG);

    const latestWeight = weight.records.length ? weight.records[weight.records.length-1] : null;
    const weightText = latestWeight ? `${latestWeight.weight}kg` : '--';
    const totalWorkHours = worklog.logs.reduce((s,l) => s + l.hours, 0);

    const today = fmtDate(new Date());
    const todayLogs = habits.logs[today] || {};
    const habitDone = Object.values(todayLogs).filter(v => v).length;
    const habitTotal = habits.habits.length;

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthRecords = ledger.records.filter(r => r.date.startsWith(thisMonth));
    const monthExpense = monthRecords.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

    const readingBooks = reading.books.filter(b => b.status === 'reading');
    const readCount = reading.books.filter(b => b.status === 'done').length;

    grid.innerHTML = `
      <!-- 天气 -->
      <div class="card weather-card">
        <div class="card-header">
          <span class="card-title">${petIcon('sun',16)} <span id="weatherCityLabel" data-city="${esc(weather.city)}">${esc(weather.city)}</span>天气</span>
          <span class="card-edit" onclick="editWeatherCity()" title="修改城市" style="cursor:pointer;font-size:12px;opacity:0.6">✏️</span>
        </div>
        <div class="weather-main">
          <span class="weather-temp" id="weatherTemp">${weather.temp}</span>
          <span class="weather-cond" id="weatherCond">${weather.condition}</span>
        </div>
        <div class="weather-detail" id="weatherDetail">💧 湿度 ${weather.humidity} · 🌬️ 风力 ${weather.wind}</div>
      </div>

      <!-- 待办列表 -->
      <div class="card">
        <div class="card-header"><span class="card-title">⏳ 待办事项</span></div>
        <div class="card-row" id="quickTodos">加载中...</div>
      </div>

      <!-- 今日热点 -->
      <div class="card hotspot-card">
        <div class="card-header"><span class="card-title">🔥 今日热点</span><span style="font-size:11px;color:var(--text-muted)">${hotspots.date||''}</span></div>
        ${hotspots.gold ? `
        <div class="gold-bar">
          <span>💰 金价</span>
          <span><b>¥${hotspots.gold.price_cny}</b>/${hotspots.gold.unit||'克'}</span>
          <span style="font-size:11px;opacity:0.7">(国际 $${hotspots.gold.price_usd}/盎司)</span>
        </div>` : ''}
        <div class="hotspot-sections">
          ${hotspots.sections.length ? hotspots.sections.map(sec => `
            <div class="hotspot-group">
              <div class="hotspot-group-title">${esc(sec.title)}</div>
              ${sec.items.map(item => `
                <a class="hotspot-item" href="${safeUrl(item.url)}" target="_blank" rel="noopener">
                  <span class="hotspot-title">${esc(item.title)}</span>
                  <span class="hotspot-source">${esc(item.source||'')}</span>
                </a>
              `).join('')}
            </div>
          `).join('') : '<div class="hotspot-item" style="color:var(--text-muted);justify-content:center">热点加载中...</div>'}
        </div>
      </div>

      <!-- 快速记录 -->
      <div class="card quick-record-card" style="grid-column: 1 / -1">
        <div class="card-header"><span class="card-title">${petIcon('lightning',16)} 快速记录</span><span class="card-badge">一键打卡</span></div>
        <div class="quick-record-grid">

          <div class="qr-item qr-weight">
            <div class="qr-item-head"><span class="qr-ico">${petIcon('dashboard',14)}</span><span class="qr-name">体重</span><span class="qr-val">${weightText} / 目标${weight.goal}kg</span></div>
            <div class="qr-form">
              <input type="number" id="qrWeight" placeholder="今日体重 kg" step="0.1" class="qr-input" onkeydown="if(event.key==='Enter')qrSaveWeight()">
              <button class="qr-btn" onclick="qrSaveWeight()">记录</button>
            </div>
          </div>

          <div class="qr-item qr-habit">
            <div class="qr-item-head"><span class="qr-ico">${petIcon('heart',14)}</span><span class="qr-name">习惯打卡</span><span class="qr-val">今日 ${habitDone}/${habitTotal}</span></div>
            <div class="qr-habits">
              ${habits.habits.map(h => `
                <button class="qr-habit-btn ${todayLogs[h.id]?'done':''}" onclick="qrToggleHabit('${h.id}')">
                  <span class="qr-habit-ico">${h.icon}</span><span>${esc(h.name)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="qr-item qr-ledger">
            <div class="qr-item-head"><span class="qr-ico">${petIcon('coin',14)}</span><span class="qr-name">记账</span><span class="qr-val">本月 ¥${monthExpense.toFixed(0)}/${ledger.monthlyBudget||3000}</span></div>
            <div class="qr-form">
              <input type="number" id="qrLedgerAmt" placeholder="金额" step="0.01" class="qr-input" style="max-width:80px" onkeydown="if(event.key==='Enter')qrSaveLedger()">
              <select id="qrLedgerCat" class="qr-input" style="max-width:70px"><option>餐饮</option><option>交通</option><option>购物</option><option>娱乐</option><option>住房</option><option>医疗</option><option>学习</option><option>其他</option></select>
              <button class="qr-btn" onclick="qrSaveLedger()">记一笔</button>
            </div>
          </div>

          <div class="qr-item qr-reading">
            <div class="qr-item-head"><span class="qr-ico">${petIcon('book',14)}</span><span class="qr-name">阅读</span><span class="qr-val">在读${readingBooks.length}本 · 读完${readCount}本</span></div>
            <div class="qr-form">
              ${readingBooks.length ? `
                <select id="qrBookId" class="qr-input" style="max-width:120px">
                  ${readingBooks.map(b => `<option value="${b.id}">${esc(b.title)}${b.author?' - '+esc(b.author):''} (${b.currentPage}/${b.totalPages||'?'})</option>`).join('')}
                </select>
                <input type="number" id="qrPage" placeholder="当前页" class="qr-input" style="max-width:70px" onkeydown="if(event.key==='Enter')qrUpdateReading()">
                <button class="qr-btn" onclick="qrUpdateReading()">更新</button>
              ` : '<span style="font-size:12px;color:var(--text-muted)">暂无在读，去数据看板添加</span>'}
            </div>
          </div>

          <div class="qr-item qr-work">
            <div class="qr-item-head"><span class="qr-ico">${petIcon('clock',14)}</span><span class="qr-name">工作</span><span class="qr-val">累计 ${totalWorkHours.toFixed(1)}h</span></div>
            <div class="qr-form">
              <input type="text" id="qrWorkTitle" placeholder="工作内容" class="qr-input" onkeydown="if(event.key==='Enter')qrSaveWorklog()">
              <input type="number" id="qrWorkHours" placeholder="h" step="0.5" class="qr-input" style="max-width:55px" onkeydown="if(event.key==='Enter')qrSaveWorklog()">
              <button class="qr-btn" onclick="qrSaveWorklog()">记录</button>
            </div>
          </div>

        </div>
      </div>

      <!-- 今日事件 -->
      <div class="card">
        <div class="card-header"><span class="card-title">${petIcon('events',16)} 今日事件</span><span class="card-badge">${total}</span></div>
        <div class="card-big-number" style="font-size:32px">${completed}/${total}</div>
        <div class="card-number-label">已完成 / 总计</div>
      </div>

      <!-- 今日饮食 -->
      <div class="card">
        <div class="card-header"><span class="card-title">${petIcon('meals',16)} 今日饮食</span><span class="card-badge" id="mealsCardCount">…</span></div>
        <div id="mealsCardList" style="font-size:13px"><span style="color:var(--text-muted);font-size:12px">加载中…</span></div>
      </div>

      <!-- 快捷入口 -->
      <div class="card">
        <div class="card-header"><span class="card-title">🔗 快捷入口</span></div>
        <div class="quick-link-grid">
          <button class="quick-link" onclick="navigate('events')">${petIcon('events',14)} 事件</button>
          <button class="quick-link" onclick="navigate('knowledge')">${petIcon('knowledge',14)} 知识</button>
          <button class="quick-link" onclick="navigate('dashboard-data')">${petIcon('dashboard-data',14)} 看板</button>
          <button class="quick-link" onclick="window.open('https://www.bilibili.com')">📺 B站</button>
          <button class="quick-link" onclick="window.open('https://www.xiaohongshu.com')">📕 小红书</button>
        </div>
      </div>
    `;

    // 渲染完成后再异步拉天气（元素此时已存在）
    updateWeather(weatherCity);
    // 异步拉今日饮食（不阻塞首屏）
    updateMealsCard();

    // 加载待办（todo未完成 + 当天日程）— 循环事件用 isRecurCompleted 检查当天完成状态
    const pendingTodos = eventsAll.filter(e => {
      if (e.type !== 'todo') return false;
      if (e.recurrence) return !isRecurCompleted(e, today);
      return !e.completed;
    });
    const todaySchedules = eventsAll.filter(e => {
      if (e.type !== 'schedule') return false;
      if (!eventHitsDate(e, today)) return false;
      if (e.recurrence) return !isRecurCompleted(e, today);
      return !e.completed;
    });
    const pending = [...pendingTodos, ...todaySchedules].slice(0, 5);
    const todos = document.getElementById('quickTodos');
    if (todos) todos.innerHTML = pending.length ? pending.map(e => {
      const isSchedule = e.type === 'schedule';
      const cls = isSchedule ? 'todo-schedule' : 'todo-item';
      const badge = isSchedule ? '<span class="todo-type-badge">日程</span> ' : '';
      return `<div class="card-item ${cls}"><span class="dot ${isSchedule ? 'dot-blue' : 'dot-amber'}"></span>${badge}${esc(e.title)}</div>`;
    }).join('') : '<div class="card-item" style="color:var(--text-muted);border-left:none;padding-left:0">暂无待办 🎉</div>';

  } catch(e) {
    grid.innerHTML = '<div class="card" style="color:var(--text-muted);text-align:center;padding:40px;grid-column:1/-1">加载失败</div>';
  }
}

// ===== 天气城市编辑 =====
// WMO 天气代码 → 中文描述（Open-Meteo）
const WMO_ZH = {0:'晴',1:'基本晴',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'小毛毛雨',53:'毛毛雨',55:'大毛毛雨',56:'冻毛毛雨',57:'强冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'强冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'小阵雨',81:'阵雨',82:'强阵雨',85:'小阵雪',86:'阵雪',95:'雷暴',96:'雷暴伴冰雹',99:'强雷暴伴冰雹'};

// 内置中国主要城市坐标（geocoding-api.open-meteo.com 国内连接不稳定，本地表优先，零延迟）
const CITY_COORDS = {
  '北京':[39.90,116.41],'上海':[31.23,121.47],'天津':[39.13,117.20],'重庆':[29.56,106.55],
  '广州':[23.13,113.26],'深圳':[22.54,114.06],'珠海':[22.27,113.58],'佛山':[23.02,113.12],'东莞':[23.02,113.75],'中山':[22.52,113.39],'惠州':[23.11,114.42],'汕头':[23.35,116.68],'湛江':[21.27,110.36],
  '杭州':[30.27,120.16],'宁波':[29.87,121.54],'温州':[28.00,120.67],'嘉兴':[30.75,120.76],'绍兴':[30.03,120.58],'金华':[29.08,119.65],'台州':[28.66,121.42],
  '南京':[32.06,118.80],'苏州':[31.30,120.58],'无锡':[31.49,120.31],'常州':[31.78,119.97],'南通':[31.98,120.89],'徐州':[34.20,117.28],'扬州':[32.39,119.41],'盐城':[33.35,120.16],'泰州':[32.45,119.92],
  '成都':[30.57,104.07],'绵阳':[31.47,104.68],'德阳':[31.13,104.40],'宜宾':[28.75,104.64],'泸州':[28.87,105.44],'乐山':[29.55,103.77],'南充':[30.84,106.08],
  '武汉':[30.59,114.31],'宜昌':[30.69,111.29],'襄阳':[32.01,112.12],'荆州':[30.33,112.24],
  '长沙':[28.23,112.94],'株洲':[27.83,113.13],'湘潭':[27.83,112.94],'衡阳':[26.89,112.57],'岳阳':[29.36,113.13],
  '西安':[34.34,108.94],'宝鸡':[34.36,107.24],'咸阳':[34.33,108.71],'渭南':[34.50,109.51],'汉中':[33.07,107.02],
  '郑州':[34.75,113.63],'洛阳':[34.62,112.45],'开封':[34.80,114.31],'新乡':[35.30,113.93],'南阳':[32.99,112.53],
  '济南':[36.65,117.12],'青岛':[36.07,120.38],'烟台':[37.46,121.45],'威海':[37.51,122.12],'潍坊':[36.70,119.16],'临沂':[35.10,118.36],'淄博':[36.81,118.05],'泰安':[36.20,117.09],
  '沈阳':[41.80,123.43],'大连':[38.91,121.61],'鞍山':[41.11,122.99],'抚顺':[41.88,123.96],'锦州':[41.10,121.13],
  '长春':[43.88,125.32],'吉林':[43.84,126.55],'四平':[43.17,124.35],'通化':[41.73,125.94],'延吉':[42.91,129.51],'松原':[45.14,124.83],'白山':[41.94,126.42],'辽源':[42.89,125.14],
  '哈尔滨':[45.80,126.53],'齐齐哈尔':[47.35,123.92],'大庆':[46.59,125.10],'牡丹江':[44.55,129.63],'佳木斯':[46.80,130.32],
  '石家庄':[38.04,114.51],'唐山':[39.63,118.18],'保定':[38.87,115.46],'秦皇岛':[39.94,118.81],'邯郸':[36.63,114.54],'廊坊':[39.52,116.68],
  '太原':[37.87,112.55],'大同':[40.08,113.30],'临汾':[36.09,111.52],'运城':[35.03,111.00],
  '合肥':[31.82,117.23],'芜湖':[31.35,118.43],'蚌埠':[32.92,117.39],'马鞍山':[31.67,118.51],
  '福州':[26.07,119.30],'厦门':[24.48,118.09],'泉州':[24.87,118.68],'漳州':[24.51,117.65],'莆田':[25.45,119.01],
  '南昌':[28.68,115.86],'赣州':[25.83,114.93],'九江':[29.74,116.00],'上饶':[28.45,117.94],
  '昆明':[24.88,102.83],'大理':[25.60,100.27],'丽江':[26.86,100.23],'曲靖':[25.49,103.80],'西双版纳':[22.00,100.80],
  '贵阳':[26.65,106.63],'遵义':[27.73,106.93],'六盘水':[26.59,104.83],
  '南宁':[22.82,108.32],'柳州':[24.33,109.42],'桂林':[25.28,110.29],'北海':[21.48,109.12],
  '海口':[20.04,110.32],'三亚':[18.25,109.51],
  '兰州':[36.06,103.83],'天水':[34.58,105.72],'张掖':[38.93,100.45],
  '西宁':[36.62,101.78],'银川':[38.49,106.23],'呼和浩特':[40.84,111.75],'包头':[40.66,109.84],
  '拉萨':[29.65,91.14],'乌鲁木齐':[43.83,87.62],'克拉玛依':[45.58,84.89],'喀什':[39.47,75.99],
  '香港':[22.32,114.17],'澳门':[22.20,113.55],'台北':[25.03,121.57],
  '香港岛':[22.28,114.16],'九龙':[22.32,114.17],
};

async function updateWeather(city) {
  const tempEl = document.getElementById('weatherTemp');
  if (!tempEl) return;
  const setW = (temp, cond, detail) => {
    const c = document.getElementById('weatherCond'), d = document.getElementById('weatherDetail');
    if (tempEl) tempEl.textContent = temp;
    if (c) c.textContent = cond;
    if (d) d.textContent = detail;
  };
  const fetchTimeout = (ms) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return { signal: ctl.signal, done: () => clearTimeout(t) };
  };
  try {
    // 1) 城市定位：内置表优先（零延迟零网络），查不到再走 geocoding 兜底
    let lat = null, lon = null;
    const local = CITY_COORDS[city.replace(/市$/, '')];
    if (local) { lat = local[0]; lon = local[1]; }
    else {
      let loc = null;
      for (const q of [city, city.endsWith('市') ? null : city + '市']) {
        if (!q) continue;
        const ft = fetchTimeout(6000);
        try {
          const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=zh`, { signal: ft.signal }).then(r => r.json());
          if (geo.results && geo.results.length) {
            loc = geo.results.reduce((a, b) => ((b.population || 0) > (a.population || 0) ? b : a));
            if (loc.population) break;
          }
        } catch(e) { /* geocoding 不可达，继续 */ }
        finally { ft.done(); }
      }
      if (!loc) { setW('--', '未找到城市', '💧 湿度 -- · 🌬️ 风力 --'); return; }
      lat = loc.latitude; lon = loc.longitude;
    }
    // 2) 天气（api.open-meteo.com 国内可达，独立超时）
    const ft2 = fetchTimeout(8000);
    let wx;
    try {
      wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&timezone=auto`, { signal: ft2.signal }).then(r => r.json());
    } finally { ft2.done(); }
    const cur = wx.current;
    if (!cur || cur.temperature_2m === undefined) { setW('--', '数据异常', '💧 湿度 -- · 🌬️ 风力 --'); return; }
    const cond = WMO_ZH[cur.weather_code] || '未知';
    const DIRS = ['北','北东北','东北','东东北','东','东东南','东南','南东南','南','南西南','西南','西西南','西','西西北','西北','北西北'];
    const windDir = DIRS[Math.round(cur.wind_direction_10m / 22.5) % 16] || '';
    setW(Math.round(cur.temperature_2m) + '°C', cond, `💧 湿度 ${cur.relative_humidity_2m}% · 🌬️ ${windDir}风 ${Math.round(cur.wind_speed_10m)}km/h`);
  } catch(e) {
    setW('--', '获取失败', '💧 湿度 -- · 🌬️ 风力 --');
  }
}

function editWeatherCity() {
  const label = document.getElementById('weatherCityLabel');
  if (!label) return;
  const oldCity = label.dataset.city || label.textContent.replace('天气','');
  label.innerHTML = `<input id="weatherCityInput" value="${esc(oldCity)}" style="width:70px;padding:2px 4px;font-size:14px" onkeydown="if(event.key==='Enter')saveWeatherCity()" onblur="saveWeatherCity()">`;
  const input = document.getElementById('weatherCityInput');
  input.focus();
  input.select();
}

function saveWeatherCity() {
  const input = document.getElementById('weatherCityInput');
  if (!input) return;
  const city = input.value.trim();
  if (!city) return;
  localStorage.setItem('zhaozhao-weather-city', city);
  loadDashboard();
}

// ===== 仅保存体重目标 =====
function saveWeightGoalOnly() {
  const goal = document.getElementById('weightGoal').value;
  if (!goal) return;
  const data = lsGet('zhaozhao-weight', DEFAULT_WEIGHT);
  data.goal = parseInt(goal);
  lsSet('zhaozhao-weight', data);
  loadWeightTab();
}

// ===== 仅保存预算 =====
function saveBudgetOnly() {
  const budget = document.getElementById('ledgerBudget').value;
  if (!budget) return;
  const data = lsGet('zhaozhao-ledger', DEFAULT_LEDGER);
  data.monthlyBudget = parseInt(budget);
  lsSet('zhaozhao-ledger', data);
  loadLedgerTab();
}

// ===== 主页快速记录 =====
function qrSaveWeight() {
  const val = document.getElementById('qrWeight').value;
  if (!val) return;
  const data = lsGet('zhaozhao-weight', DEFAULT_WEIGHT);
  const today = fmtDate(new Date());
  const idx = data.records.findIndex(r => r.date === today);
  if (idx >= 0) data.records[idx].weight = parseFloat(val);
  else data.records.push({ date: today, weight: parseFloat(val) });
  data.records.sort((a,b) => a.date.localeCompare(b.date));
  lsSet('zhaozhao-weight', data);
  document.getElementById('qrWeight').value = '';
  showToast('记录成功', '体重', val + 'kg');
  loadDashboard();
}

function qrToggleHabit(habitId) {
  const data = lsGet('zhaozhao-habits', DEFAULT_HABITS);
  const today = fmtDate(new Date());
  if (!data.logs[today]) data.logs[today] = {};
  data.logs[today][habitId] = !data.logs[today][habitId];
  lsSet('zhaozhao-habits', data);
  loadDashboard();
}

function qrSaveLedger() {
  const amt = document.getElementById('qrLedgerAmt').value;
  if (!amt) return;
  const data = lsGet('zhaozhao-ledger', DEFAULT_LEDGER);
  data.records.unshift({
    id: genId(), amount: parseFloat(amt), type: 'expense',
    category: document.getElementById('qrLedgerCat').value,
    date: fmtDate(new Date()),
  });
  lsSet('zhaozhao-ledger', data);
  document.getElementById('qrLedgerAmt').value = '';
  showToast('记录成功', '记账', '-¥' + parseFloat(amt).toFixed(2));
  loadDashboard();
}

function qrUpdateReading() {
  const bookId = document.getElementById('qrBookId').value;
  const page = document.getElementById('qrPage').value;
  if (!page) return;
  const data = lsGet('zhaozhao-reading', DEFAULT_READING);
  const book = data.books.find(b => b.id == bookId);
  if (book) { book.currentPage = parseInt(page); lsSet('zhaozhao-reading', data); }
  document.getElementById('qrPage').value = '';
  showToast('更新成功', '阅读进度', '第' + page + '页');
  loadDashboard();
}

function qrSaveWorklog() {
  const title = document.getElementById('qrWorkTitle').value.trim();
  const hours = document.getElementById('qrWorkHours').value;
  if (!title) return;
  const data = lsGet('zhaozhao-worklog', DEFAULT_WORKLOG);
  data.logs.unshift({
    id: genId(), title, hours: parseFloat(hours) || 0,
    date: fmtDate(new Date()),
  });
  lsSet('zhaozhao-worklog', data);
  document.getElementById('qrWorkTitle').value = '';
  document.getElementById('qrWorkHours').value = '';
  showToast('记录成功', '工作', (parseFloat(hours)||0) + 'h');
  loadDashboard();
}

// ===== 知识库（localStorage版） =====
async function loadKnowledge() {
  const data = lsGet('zhaozhao-knowledge', DEFAULT_KNOWLEDGE);
  const total = (data.wiki || []).length + (data.raw || []).length;
  document.getElementById('knowledgeStats').innerHTML = `
    <div class="stat-card"><div class="stat-number">${total}</div><div class="stat-label">总文档</div></div>
    <div class="stat-card"><div class="stat-number">${(data.wiki||[]).length}</div><div class="stat-label">结构化知识</div></div>
    <div class="stat-card"><div class="stat-number">${(data.raw||[]).length}</div><div class="stat-label">原始资料</div></div>
  `;
  const allFiles = [
    ...(data.wiki||[]).map(f => ({name:f.name, type:'wiki'})),
    ...(data.raw||[]).map(f => ({name:f.name, type:'raw'}))
  ];
  document.getElementById('knowledgeList').innerHTML = allFiles.length ? allFiles.map(f => `
    <div class="knowledge-item">
      <span class="knowledge-name" onclick="viewKnowledge('${encodeURIComponent(f.name)}')" title="点击查看内容">📄 ${esc(f.name)}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="knowledge-meta">${f.type === 'wiki' ? '结构化知识' : '原始资料'}</span>
        <button class="btn-secondary" style="padding:2px 8px;font-size:11px" onclick="event.stopPropagation();deleteKnowledge('${encodeURIComponent(f.name)}')">删除</button>
      </div>
    </div>
  `).join('') : '<div class="knowledge-item"><span style="color:var(--text-muted)">知识库为空，点击右上角"新建文档"添加</span></div>';
}

function toggleKnowledgeForm() {
  const f = document.getElementById('knowledgeForm');
  f.style.display = f.style.display === 'none' ? 'flex' : 'none';
}

async function saveKnowledge() {
  const title = document.getElementById('knowledgeTitle').value.trim();
  const content = document.getElementById('knowledgeContent').value.trim();
  if (!title || !content) { showToast('提示', '知识库', '标题和内容不能为空'); return; }
  const data = lsGet('zhaozhao-knowledge', DEFAULT_KNOWLEDGE);
  data.wiki = data.wiki || [];
  // 如果同名则更新
  const idx = data.wiki.findIndex(f => f.name === title + '.md');
  if (idx >= 0) {
    data.wiki[idx].content = content;
  } else {
    data.wiki.push({ name: title + '.md', content });
  }
  lsSet('zhaozhao-knowledge', data);
  document.getElementById('knowledgeTitle').value = '';
  document.getElementById('knowledgeContent').value = '';
  document.getElementById('knowledgeForm').style.display = 'none';
  loadKnowledge();
  showToast('保存成功', '知识库', title);
}

async function deleteKnowledge(filename) {
  const name = decodeURIComponent(filename);
  if (!confirm('确定删除「' + name + '」？此操作不可恢复。')) return;
  const data = lsGet('zhaozhao-knowledge', DEFAULT_KNOWLEDGE);
  data.wiki = (data.wiki || []).filter(f => f.name !== name);
  data.raw = (data.raw || []).filter(f => f.name !== name);
  lsSet('zhaozhao-knowledge', data);
  closeKnowledgeModal();
  loadKnowledge();
  showToast('已删除', '知识库', name);
}

function viewKnowledge(filename) {
  const name = decodeURIComponent(filename);
  const data = lsGet('zhaozhao-knowledge', DEFAULT_KNOWLEDGE);
  const allFiles = [...(data.wiki||[]), ...(data.raw||[])];
  const file = allFiles.find(f => f.name === name);
  if (file) {
    currentKmFile = filename;
    document.getElementById('kmTitle').textContent = name;
    document.getElementById('kmContent').textContent = file.content;
    document.getElementById('kmDeleteBtn').onclick = () => deleteKnowledge(filename);
    document.getElementById('knowledgeModal').style.display = 'flex';
  }
}

let currentKmFile = '';

function closeKnowledgeModal() {
  document.getElementById('knowledgeModal').style.display = 'none';
  currentKmFile = '';
}

function searchKnowledge() {
  const q = document.getElementById('knowledgeSearch').value.toLowerCase();
  if (!q) { loadKnowledge(); return; }
  const data = lsGet('zhaozhao-knowledge', DEFAULT_KNOWLEDGE);
  const allFiles = [...(data.wiki||[]), ...(data.raw||[])];
  const results = allFiles.filter(f => f.name.toLowerCase().includes(q) || f.content.toLowerCase().includes(q));
  document.getElementById('knowledgeList').innerHTML = results.length ? results.map(r => `
    <div class="knowledge-item">
      <span class="knowledge-name" onclick="viewKnowledge('${encodeURIComponent(r.name)}')">📄 ${esc(r.name)}</span>
      <div style="font-size:12px;color:var(--text-muted)">${esc(r.content.substring(0,80))}...</div>
    </div>
  `).join('') : '<div class="knowledge-item" style="color:var(--text-muted)">无匹配结果</div>';
}

// ===== 事件（localStorage版 + 日历） =====
const SCHEDULE_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f43f5e','#84cc16','#6366f1','#d946ef','#0ea5e9','#a855f7'];
let calYear, calMonth;

function initCalendar() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

async function loadEvents() {
  const events = lsGet('zhaozhao-events', []);
  events.sort((a, b) => b.id - a.id);
  // 列表视图
  document.getElementById('eventList').innerHTML = events.length ? events.map(e => `
    <div class="event-item ${e.completed?'completed':''}">
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <input type="checkbox" ${e.completed?'checked':''} onchange="toggleEvent(${e.id})" style="width:auto">
        <div>
          <div class="event-title">${esc(e.title)}${e.recurrence?` <span style="font-size:10px;opacity:0.6">${esc(recurrenceDesc(e))}</span>`:''}${e.startDate?` <span style="font-size:11px;color:var(--text-muted)">(${fmtCalDate(e.startDate)}${!e.recurrence&&e.endDate&&e.endDate!==e.startDate?' ~ '+fmtCalDate(e.endDate):''})</span>`:''}</div>
          ${e.content ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(e.content.substring(0,50))}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="event-type-badge type-${e.type}">${e.type==='todo'?'待办':e.type==='note'?'笔记':'日程'}</span>
        <button class="btn-secondary" style="padding:4px 10px;font-size:12px" onclick="deleteEvent(${e.id})">删除</button>
      </div>
    </div>
  `).join('') : '<div class="event-item" style="justify-content:center;color:var(--text-muted)">暂无事件，点击 + 新建</div>';
  // 日历视图
  renderCalendar();
}

function toggleEventForm() {
  const f = document.getElementById('eventForm');
  f.style.display = f.style.display === 'none' ? 'flex' : 'none';
}

function addEvent() { toggleEventForm(); }

// ===== 日期解析 =====
const DOW_MAP = {一:1,二:2,三:3,四:4,五:5,六:6,日:0,天:0};

// 解析循环模式，返回 { recurrence, interval, dayOfWeek, day, month, cleanText } 或 null
function parseRecurrence(text) {
  let t = text;
  let rec = null;

  // 1. 从X开始 → 提取起始日期，同时移除该短语
  let fromDate = null;
  const fromMatch = t.match(/从(.+?)开始/);
  if (fromMatch) {
    const inner = fromMatch[1];
    // 尝试从"从"短语中提取具体日期
    const innerDate = parseSimpleDate(inner, new Date());
    if (innerDate) fromDate = innerDate.startDate;
    t = t.replace(fromMatch[0], '');
  }

  // 2. 间隔N天
  let m = t.match(/间隔\s*(\d+)\s*天/);
  if (m) { rec = { recurrence: 'daily', interval: parseInt(m[1]) }; t = t.replace(m[0], ''); }

  // 3. 每N个?天|日
  if (!rec) { m = t.match(/每\s*(\d+)\s*个?\s*[天日]/); if (m) { rec = { recurrence: 'daily', interval: parseInt(m[1]) }; t = t.replace(m[0], ''); } }

  // 4. 每天/每日（注意要放在数字匹配之后）
  if (!rec) { m = t.match(/每[天日]/); if (m) { rec = { recurrence: 'daily', interval: 1 }; t = t.replace(m[0], ''); } }

  // 5. 每N周周X
  if (!rec) { m = t.match(/每\s*(\d+)\s*个?\s*周\s*(?:周\s*)?([一二三四五六日天])/); if (m) { rec = { recurrence: 'weekly', interval: parseInt(m[1]), dayOfWeek: DOW_MAP[m[2]] }; t = t.replace(m[0], ''); } }

  // 6. 每周一~日
  if (!rec) { m = t.match(/每\s*周\s*(?:周\s*)?([一二三四五六日天])/); if (m) { rec = { recurrence: 'weekly', interval: 1, dayOfWeek: DOW_MAP[m[1]] }; t = t.replace(m[0], ''); } }

  // 7. 工作日
  if (!rec) { m = t.match(/[每各]?\s*工作\s*日/); if (m) { rec = { recurrence: 'weekdays' }; t = t.replace(m[0], ''); } }

  // 8. 周末/每周末
  if (!rec) { m = t.match(/[每各]?\s*周\s*末/); if (m) { rec = { recurrence: 'weekend' }; t = t.replace(m[0], ''); } }

  // 9. 每N月X号
  if (!rec) { m = t.match(/每\s*(\d+)\s*个?\s*月\s*(\d+)\s*[号日]/); if (m) { rec = { recurrence: 'monthly', interval: parseInt(m[1]), day: parseInt(m[2]) }; t = t.replace(m[0], ''); } }

  // 10. 每月X号
  if (!rec) { m = t.match(/每\s*月\s*(\d+)\s*[号日]/); if (m) { rec = { recurrence: 'monthly', interval: 1, day: parseInt(m[1]) }; t = t.replace(m[0], ''); } }

  // 11. 每N月（无具体日，默认今天日期）
  if (!rec) { m = t.match(/每\s*(\d+)\s*个?\s*月/); if (m) { rec = { recurrence: 'monthly', interval: parseInt(m[1]), day: new Date().getDate() }; t = t.replace(m[0], ''); } }

  // 12. 每N年X月X号
  if (!rec) { m = t.match(/每\s*(\d+)\s*个?\s*年\s*(\d+)\s*月\s*(\d+)\s*[号日]/); if (m) { rec = { recurrence: 'yearly', interval: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) }; t = t.replace(m[0], ''); } }

  // 13. 每年X月X号
  if (!rec) { m = t.match(/每\s*年\s*(\d+)\s*月\s*(\d+)\s*[号日]/); if (m) { rec = { recurrence: 'yearly', interval: 1, month: parseInt(m[1]), day: parseInt(m[2]) }; t = t.replace(m[0], ''); } }

  // 14. 每N年（无具体日期）
  if (!rec) { m = t.match(/每\s*(\d+)\s*个?\s*年/); if (m) { const now = new Date(); rec = { recurrence: 'yearly', interval: parseInt(m[1]), month: now.getMonth()+1, day: now.getDate() }; t = t.replace(m[0], ''); } }

  if (!rec) return null;

  // 清理剩余文本中的循环相关词
  t = t.replace(/[每各]|工作|周末|间隔|开始|个/g, '').replace(/\s+/g, ' ').trim();
  return { ...rec, fromDate, cleanText: t };
}

// 解析单次日期（不含循环），与原来的 parseScheduleDate 逻辑一致
function parseSimpleDate(text, now) {
  const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate();
  let result = null;

  if (/(今明两天|明后两天|明后天|明天后天|明天[到至\-~]后天)/.test(text)) {
    result = { startDate: dateStr(now, 1), endDate: dateStr(now, 2), pattern: RegExp.$1 };
  }
  else if (/(今天[到至\-~]后天|今天后天)/.test(text)) {
    result = { startDate: dateStr(now, 0), endDate: dateStr(now, 2), pattern: RegExp.$1 };
  }
  else if (/(今天[到至\-~]明天|今天明天)/.test(text)) {
    result = { startDate: dateStr(now, 0), endDate: dateStr(now, 1), pattern: RegExp.$1 };
  }
  else if (/大后天/.test(text)) {
    result = { startDate: dateStr(now, 3), endDate: dateStr(now, 3), pattern: '大后天' };
  }
  else if (/后天/.test(text)) {
    result = { startDate: dateStr(now, 2), endDate: dateStr(now, 2), pattern: '后天' };
  }
  else if (/明天/.test(text)) {
    result = { startDate: dateStr(now, 1), endDate: dateStr(now, 1), pattern: '明天' };
  }
  else if (/今天/.test(text)) {
    result = { startDate: dateStr(now, 0), endDate: dateStr(now, 0), pattern: '今天' };
  }

  if (!result) {
    const dayAfter = text.match(/(\d+)\s*天后/);
    if (dayAfter) {
      result = { startDate: dateStr(now, parseInt(dayAfter[1])), endDate: dateStr(now, parseInt(dayAfter[1])), pattern: dayAfter[0] };
    }
  }

  if (!result) {
    const nw = text.match(/下周(一|二|三|四|五|六|日|天)/);
    if (nw) {
      const target = DOW_MAP[nw[1]];
      const diff = (7 - now.getDay() + target) % 7 || 7;
      const sd = new Date(y, m, d + diff);
      result = { startDate: fmtDate(sd), endDate: fmtDate(sd), pattern: nw[0] };
    }
  }

  if (!result) {
    const range = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]\s*[到至\-~]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/);
    if (range) {
      result = { startDate: `${y}-${range[1].padStart(2,'0')}-${range[2].padStart(2,'0')}`, endDate: `${y}-${range[3].padStart(2,'0')}-${range[4].padStart(2,'0')}`, pattern: range[0] };
    }
  }
  if (!result) {
    const srange = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]\s*[到至\-~]\s*(\d{1,2})\s*[号日]/);
    if (srange) {
      result = { startDate: `${y}-${srange[1].padStart(2,'0')}-${srange[2].padStart(2,'0')}`, endDate: `${y}-${srange[1].padStart(2,'0')}-${srange[3].padStart(2,'0')}`, pattern: srange[0] };
    }
  }
  if (!result) {
    const single = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/);
    if (single) {
      const mon = single[1].padStart(2,'0'), day = single[2].padStart(2,'0');
      result = { startDate: `${y}-${mon}-${day}`, endDate: `${y}-${mon}-${day}`, pattern: single[0] };
    }
  }

  return result;
}

function parseScheduleDate(text) {
  const now = new Date();
  let result = null;

  // Step 1: 检测循环模式
  const rec = parseRecurrence(text);
  const cleanText = rec ? rec.cleanText : text;

  // Step 2: 解析日期
  result = parseSimpleDate(cleanText, now);

  // Step 3: 如果循环有"从X开始"，优先用那个日期
  if (rec && rec.fromDate) {
    if (result) {
      result.startDate = rec.fromDate;
      if (result.endDate === result.startDate || !result.endDate) result.endDate = rec.fromDate;
    } else {
      result = { startDate: rec.fromDate, endDate: rec.fromDate };
    }
  }

  // Step 4: 如果有循环但没有具体日期，默认今天
  if (!result && rec) {
    const today = fmtDate(now);
    result = { startDate: today, endDate: today };
  }

  // Step 5: 附加循环信息
  if (rec) {
    if (!result) result = { startDate: fmtDate(now), endDate: fmtDate(now) };
    result.recurrence = rec.recurrence;
    result.interval = rec.interval || 1;
    result.dayOfWeek = rec.dayOfWeek !== undefined ? rec.dayOfWeek : null;
    result.day = rec.day !== undefined ? rec.day : null;
    result.month = rec.month || null;
  }

  // Step 6: 清理标题
  if (result) {
    // 先用去除日期模式后的文本
    let cleaned = rec ? rec.cleanText : text;
    if (result.pattern) cleaned = cleaned.replace(result.pattern, '');
    cleaned = cleaned.replace(/[到至\-~去在的]/g, '').replace(/\s+/g, ' ').trim();
    if (!cleaned) cleaned = text;
    result.title = cleaned;
    result.pattern = result.pattern || rec?.cleanText || '';
  }

  return result;
}

function dateStr(base, offset) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return fmtDate(d);
}
function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtCalDate(s) { if(!s)return''; const p=s.split('-'); return `${parseInt(p[1])}/${parseInt(p[2])}`; }

// ===== 循环命中判断 =====
function matchesRecurrence(event, dateStr) {
  if (!event.recurrence) return false;
  const date = new Date(dateStr + 'T00:00:00');
  const start = new Date(event.startDate + 'T00:00:00');
  if (date < start) return false;

  const diffDays = Math.floor((date - start) / 86400000);
  switch (event.recurrence) {
    case 'daily':
      return diffDays % (event.interval || 1) === 0;

    case 'weekly': {
      const dow = date.getDay();
      if (event.dayOfWeek !== null && event.dayOfWeek !== undefined) {
        if (dow !== event.dayOfWeek) return false;
        // 找 startDate 之后第一个匹配的 dayOfWeek
        const first = new Date(start);
        while (first.getDay() !== event.dayOfWeek) first.setDate(first.getDate() + 1);
        const diff = Math.floor((date - first) / 86400000);
        return diff >= 0 && (diff / 7) % (event.interval || 1) === 0;
      }
      return diffDays % (7 * (event.interval || 1)) === 0;
    }

    case 'weekdays': {
      const d = date.getDay();
      return d >= 1 && d <= 5;
    }

    case 'weekend': {
      const d = date.getDay();
      return d === 0 || d === 6;
    }

    case 'monthly': {
      const targetDay = event.day || start.getDate();
      if (date.getDate() !== targetDay) return false;
      const monthDiff = (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth());
      return monthDiff >= 0 && monthDiff % (event.interval || 1) === 0;
    }

    case 'yearly': {
      const targetMonth = event.month || (start.getMonth() + 1);
      const targetDay = event.day || start.getDate();
      if (date.getMonth() + 1 !== targetMonth || date.getDate() !== targetDay) return false;
      const yearDiff = date.getFullYear() - start.getFullYear();
      return yearDiff >= 0 && yearDiff % (event.interval || 1) === 0;
    }

    default: return false;
  }
}

// 判断事件在 givenDate 是否命中（合并范围和循环）
function eventHitsDate(event, dateStr) {
  if (event.recurrence) {
    return matchesRecurrence(event, dateStr);
  }
  if (!event.startDate) return false;
  return event.startDate <= dateStr && (!event.endDate || event.endDate >= dateStr);
}

// 判断循环事件在 givenDate 是否已完成
function isRecurCompleted(event, dateStr) {
  return event.completedDates && event.completedDates.includes(dateStr);
}

function assignColor(events, monthYear) {
  const [y,m] = monthYear.split('-').map(Number);
  const usedColors = new Set();
  events.forEach(e => {
    if (e.startDate) {
      const [sy,sm] = e.startDate.split('-').map(Number);
      if (sy === y && sm === m) usedColors.add(e.color);
    }
  });
  for (const c of SCHEDULE_COLORS) { if (!usedColors.has(c)) return c; }
  return SCHEDULE_COLORS[Math.floor(Math.random() * SCHEDULE_COLORS.length)];
}

// ===== 日历渲染 =====
function renderCalendar() {
  if (!calYear) initCalendar();
  const events = lsGet('zhaozhao-events', []);
  const schedules = events.filter(e => e.type === 'schedule' || e.startDate);
  document.getElementById('calMonthTitle').textContent = `${calYear}年${calMonth+1}月`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const prevDays = new Date(calYear, calMonth, 0).getDate();
  const today = fmtDate(new Date());

  let html = '';
  // 上月尾
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-cell other-month"><div class="cal-date">${prevDays - i}</div></div>`;
  }
  // 当月
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dow = new Date(calYear, calMonth, day).getDay();
    const isToday = dateStr === today;
    const isWeekend = dow === 0 || dow === 6;
    let cls = 'cal-cell';
    if (isToday) cls += ' today';
    if (isWeekend) cls += ' weekend';

    // 查找当天日程（含循环命中）
    const daySchedules = [];
    schedules.forEach(s => {
      if (eventHitsDate(s, dateStr)) {
        daySchedules.push({ ...s, _recurCompleted: s.recurrence ? isRecurCompleted(s, dateStr) : false });
      }
    });

    let bars = '';
    const maxShow = 3;
    daySchedules.slice(0, maxShow).forEach(s => {
      const isDone = s.completed || s._recurCompleted;
      bars += `<div class="cal-event${isDone?' completed':''}" style="background:${safeColor(s.color)}" onclick="event.stopPropagation();showCalPopup(${s.id},'${dateStr}')" title="${esc(s.title)}${s.recurrence?' 🔁':''}"><span class="cal-event-dot"></span><span class="cal-event-text">${esc(s.title)}</span></div>`;
    });
    if (daySchedules.length > maxShow) {
      bars += `<div class="cal-more" onclick="event.stopPropagation();showCalDayPopup('${dateStr}')">+${daySchedules.length - maxShow} 更多</div>`;
    }

    html += `<div class="${cls}" onclick="showCalDayPopup('${dateStr}')"><div class="cal-date">${day}</div>${bars}</div>`;
  }
  // 下月头
  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-cell other-month"><div class="cal-date">${i}</div></div>`;
  }
  document.getElementById('calGrid').innerHTML = html;

  // 图例
  const monthKey = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
  const monthFirst = `${monthKey}-01`;
  const monthLast = `${monthKey}-${String(daysInMonth).padStart(2,'0')}`;
  const monthSchedules = schedules.filter(s => {
    if (s.recurrence) {
      // 循环事件：检查当月是否有命中
      const firstDay = new Date(calYear, calMonth, 1);
      const lastDay = new Date(calYear, calMonth + 1, 0);
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        if (matchesRecurrence(s, fmtDate(d))) return true;
      }
      return false;
    }
    if (!s.startDate) return false;
    const [sy,sm] = s.startDate.split('-').map(Number);
    if (sy !== calYear || sm !== calMonth + 1) {
      // 也检查 endDate 是否跨越本月
      if (s.endDate) {
        const [ey,em] = s.endDate.split('-').map(Number);
        if (ey === calYear && em === calMonth + 1) return s.startDate <= monthLast;
      }
      return false;
    }
    return true;
  });
  const legendHtml = monthSchedules.length ? monthSchedules.map(s => `
    <div class="cal-legend-item${s.completed?' completed':''}" onclick="showCalPopup(${s.id})">
      <div class="cal-legend-color${s.completed?' completed':''}" style="background:${safeColor(s.color)}"></div>
      <span class="cal-legend-name">${esc(s.title)}${s.recurrence?' <span style="font-size:10px;opacity:0.6">🔁</span>':''}</span>
      <span class="cal-legend-date">${esc(s.recurrence ? recurrenceDesc(s) : (fmtCalDate(s.startDate)+(s.endDate&&s.endDate!==s.startDate?' ~ '+fmtCalDate(s.endDate):'')))}</span>
      <span class="cal-legend-done${s.completed?' done':''}" onclick="event.stopPropagation();toggleEvent(${s.id})">${s.completed?'✓ 已完成':'标记完成'}</span>
    </div>
  `).join('') : '<div style="font-size:13px;color:var(--text-muted);padding:8px">本月暂无日程</div>';
  document.getElementById('calLegendList').innerHTML = legendHtml;
}

function calPrevMonth() { calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCalendar(); }
function calNextMonth() { calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCalendar(); }
function calGoToday() { const n=new Date(); calYear=n.getFullYear(); calMonth=n.getMonth(); renderCalendar(); }

function recurrenceDesc(e) {
  const map = { daily:'天', weekly:'周', weekdays:'工作日', weekend:'周末', monthly:'月', yearly:'年' };
  const dowName = ['日','一','二','三','四','五','六'];
  let d = '';
  switch (e.recurrence) {
    case 'daily': d = e.interval > 1 ? `每${e.interval}天` : '每天'; break;
    case 'weekly': d = e.interval > 1 ? `每${e.interval}周` : '每周'; if (e.dayOfWeek !== null && e.dayOfWeek !== undefined) d += '周' + dowName[e.dayOfWeek]; break;
    case 'weekdays': d = '工作日'; break;
    case 'weekend': d = '每周末'; break;
    case 'monthly': d = e.interval > 1 ? `每${e.interval}月` : '每月'; if (e.day) d += e.day + '号'; break;
    case 'yearly': d = e.interval > 1 ? `每${e.interval}年` : '每年'; if (e.month) d += e.month + '月'; if (e.day) d += e.day + '号'; break;
    default: d = '🔁';
  }
  return '🔁 ' + d;
}

function showCalPopup(id, dateStr) {
  const events = lsGet('zhaozhao-events', []);
  const e = events.find(x => x.id === id);
  if (!e) return;
  const isRecur = !!e.recurrence;
  const recurDone = isRecur && dateStr ? isRecurCompleted(e, dateStr) : false;
  const isDone = e.completed || recurDone;

  const overlay = document.createElement('div');
  overlay.className = 'cal-popup';
  overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="cal-popup-content">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      ${e.startDate?`<div style="width:12px;height:12px;border-radius:3px;background:${safeColor(e.color)};flex-shrink:0"></div>`:''}
      <div class="cal-popup-title">${esc(e.title)}</div>
    </div>
    ${isRecur ? `<div class="cal-popup-info">🔄 ${recurrenceDesc(e)} · 起始 ${e.startDate||'今天'}</div>` : ''}
    ${e.startDate?`<div class="cal-popup-info">📅 ${e.startDate}${e.endDate&&e.endDate!==e.startDate&&!isRecur?' ~ '+e.endDate:''}</div>`:''}
    ${dateStr?`<div class="cal-popup-info">📍 选中日期：${dateStr}</div>`:''}
    ${e.content?`<div class="cal-popup-info">📝 ${esc(e.content)}</div>`:''}
    <div class="cal-popup-info">状态：${isDone?'✅ 已完成':'⏳ 进行中'}</div>
    <div class="cal-popup-actions">
      <button class="btn-primary" onclick="toggleEvent(${e.id},'${dateStr||''}');document.querySelector('.cal-popup').remove();">${isDone?'↩ 取消完成':'✅ 标记完成'}</button>
      <button class="btn-secondary" onclick="document.querySelector('.cal-popup').remove()">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

function showCalDayPopup(dateStr) {
  const events = lsGet('zhaozhao-events', []);
  const daySchedules = events.filter(e => eventHitsDate(e, dateStr));
  const overlay = document.createElement('div');
  overlay.className = 'cal-popup';
  overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="cal-popup-content">
    <div class="cal-popup-title">📅 ${dateStr}</div>
    ${daySchedules.length ? daySchedules.map(s => {
      const rDone = s.recurrence ? isRecurCompleted(s, dateStr) : false;
      const done = s.completed || rDone;
      return `<div class="cal-legend-item${done?' completed':''}" style="margin-bottom:4px" onclick="document.querySelector('.cal-popup').remove();showCalPopup(${s.id},'${dateStr}')">
        <div class="cal-legend-color${done?' completed':''}" style="background:${s.color||'#888'}"></div>
        <span class="cal-legend-name">${esc(s.title)}${s.recurrence?' 🔁':''}</span>
        <span class="cal-legend-done${done?' done':''}">${done?'已完成':'进行中'}</span>
      </div>`;
    }).join('') : '<div class="cal-popup-info">当天没有日程</div>'}
    <div class="cal-popup-actions">
      <button class="btn-secondary" onclick="document.querySelector('.cal-popup').remove()">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

async function saveEvent() {
  const title = document.getElementById('eventTitle').value.trim();
  if (!title) return;
  const type = document.getElementById('eventType').value;
  const events = lsGet('zhaozhao-events', []);
  const event = {
    id: genId(),
    title,
    content: document.getElementById('eventContent').value,
    type,
    completed: false,
    createdAt: new Date().toISOString()
  };
  // 日程类型：自动解析日期和循环
  if (type === 'schedule') {
    const parsed = parseScheduleDate(title);
    if (parsed) {
      event.title = parsed.title || title;
      event.startDate = parsed.startDate;
      event.endDate = parsed.endDate;
      // 循环字段
      if (parsed.recurrence) {
        event.recurrence = parsed.recurrence;
        event.interval = parsed.interval || 1;
        event.dayOfWeek = parsed.dayOfWeek !== undefined ? parsed.dayOfWeek : null;
        event.day = parsed.day || null;
        event.month = parsed.month || null;
        event.completedDates = []; // 循环事件用数组记录每日完成
      }
    } else {
      event.startDate = fmtDate(new Date());
      event.endDate = fmtDate(new Date());
    }
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    event.color = assignColor(events, monthKey);
  }
  events.push(event);
  lsSet('zhaozhao-events', events);
  document.getElementById('eventTitle').value = '';
  document.getElementById('eventContent').value = '';
  document.getElementById('eventForm').style.display = 'none';
  loadEvents();
  if (currentPage === 'dashboard') loadDashboard();
  const dateInfo = event.recurrence ? ` (${recurrenceDesc(event)})` : (event.startDate ? ` (${fmtCalDate(event.startDate)}${event.endDate!==event.startDate?' ~ '+fmtCalDate(event.endDate):''})` : '');
  showToast('成功', '事件已保存', event.title + dateInfo);
}

async function toggleEvent(id, dateStr) {
  const events = lsGet('zhaozhao-events', []);
  const e = events.find(e => e.id === id);
  if (!e) return;

  if (e.recurrence && dateStr) {
    // 循环事件：切换具体日期的完成状态
    if (!e.completedDates) e.completedDates = [];
    const idx = e.completedDates.indexOf(dateStr);
    if (idx >= 0) e.completedDates.splice(idx, 1);
    else e.completedDates.push(dateStr);
  } else {
    // 普通事件
    e.completed = !e.completed;
  }

  lsSet('zhaozhao-events', events);
  loadEvents();
}

async function deleteEvent(id) {
  if (!confirm('确定删除？')) return;
  let events = lsGet('zhaozhao-events', []);
  events = events.filter(e => e.id !== id);
  lsSet('zhaozhao-events', events);
  loadEvents();
  if (currentPage === 'dashboard') loadDashboard();
}

// ===== 数据看板 =====
let currentDataTab = 'weight';
let chartInstance = null;

// ===== Chart.js 按需加载（不阻塞首屏；进入数据看板时才加载） =====
let _chartJsPromise = null;
function loadChartJs() {
  if (typeof Chart !== 'undefined') return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Chart.js 加载失败'));
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

function switchDataTab(tab) {
  currentDataTab = tab;
  document.querySelectorAll('.data-tab').forEach(t => t.classList.remove('active'));
  // 找到被点击的 tab
  const tabs = document.querySelectorAll('.data-tab');
  tabs.forEach(t => { if (t.textContent.includes({weight:'体重',habits:'习惯',ledger:'记账',reading:'阅读',worklog:'工作'}[tab])) t.classList.add('active'); });
  loadChartJs().then(() => {
    if (tab === 'weight') loadWeightTab();
    else if (tab === 'habits') loadHabitsTab();
    else if (tab === 'ledger') loadLedgerTab();
    else if (tab === 'reading') loadReadingTab();
    else if (tab === 'worklog') loadWorklogTab();
  }).catch(e => {
    document.getElementById('dataTabContent').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--text-muted)">图表组件加载失败（网络问题），数据本身不受影响。请检查网络后重试。</div>';
  });
}

function destroyChart() {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

// 体重追踪
async function loadWeightTab() {
  destroyChart();
  const data = lsGet('zhaozhao-weight', DEFAULT_WEIGHT);
  const container = document.getElementById('dataTabContent');
  const records = data.records.slice(-30);
  const dates = records.map(r => r.date.slice(5));
  const weights = records.map(r => r.weight);
  const latest = records.length ? records[records.length-1] : null;

  container.innerHTML = `
    <div class="data-panel">
      <div class="data-stats">
        <div class="data-stat"><span class="data-stat-num">${latest ? latest.weight + 'kg' : '--'}</span><span class="data-stat-label">最新体重</span></div>
        <div class="data-stat"><span class="data-stat-num">${data.goal}kg</span><span class="data-stat-label">目标体重</span></div>
        <div class="data-stat"><span class="data-stat-num">${records.length}</span><span class="data-stat-label">记录天数</span></div>
      </div>
      <div class="chart-container"><canvas id="weightChart"></canvas></div>
      <div class="data-form">
        <input type="number" id="weightInput" placeholder="体重 (kg)" step="0.1">
        <input type="date" id="weightDate" value="${fmtDate(new Date())}">
        <input type="text" id="weightGoal" placeholder="目标 (kg)" value="${data.goal}" style="width:80px">
        <button class="btn-secondary" style="padding:6px 10px;font-size:12px" onclick="saveWeightGoalOnly()">💾 只改目标</button>
        <button class="btn-primary" onclick="saveWeight()">记录</button>
      </div>
      <div class="data-list" id="weightList"></div>
    </div>
  `;

  renderWeightList(data.records);
  if (dates.length > 1) {
    const ctx = document.getElementById('weightChart').getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          { label:'体重', data:weights, borderColor:'#4f46e5', backgroundColor:'rgba(79,70,229,0.1)', fill:true, tension:0.3, pointRadius:3 },
          { label:'目标', data:Array(dates.length).fill(data.goal), borderColor:'#ef4444', borderDash:[5,5], pointRadius:0, fill:false }
        ]
      },
      options: { responsive:true, plugins:{ legend:{ display:true, position:'bottom' } }, scales:{ y:{ beginAtZero:false } } }
    });
  }
}

function renderWeightList(records) {
  const el = document.getElementById('weightList');
  if (!el) return;
  el.innerHTML = records.length ? records.slice().reverse().slice(0, 15).map((r, i) =>
    `<div class="data-item"><span>${r.date}</span><span><b>${r.weight}kg</b><button class="btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:8px" onclick="deleteWeightRecord(${records.length - 1 - i})">🗑️</button></span></div>`
  ).join('') : '<div class="data-item" style="text-align:center;color:var(--text-muted)">暂无记录</div>';
}

async function saveWeight() {
  const weight = document.getElementById('weightInput').value;
  const date = document.getElementById('weightDate').value;
  const goal = document.getElementById('weightGoal').value;
  if (!weight) return;
  const data = lsGet('zhaozhao-weight', DEFAULT_WEIGHT);
  // 同一天则更新
  const idx = data.records.findIndex(r => r.date === date);
  if (idx >= 0) data.records[idx].weight = parseFloat(weight);
  else data.records.push({ date, weight: parseFloat(weight) });
  data.records.sort((a, b) => a.date.localeCompare(b.date));
  if (goal) data.goal = parseInt(goal);
  lsSet('zhaozhao-weight', data);
  loadWeightTab();
}

async function deleteWeightRecord(index) {
  if (!confirm('确定删除这条体重记录？')) return;
  const data = lsGet('zhaozhao-weight', DEFAULT_WEIGHT);
  data.records.splice(index, 1);
  lsSet('zhaozhao-weight', data);
  loadWeightTab();
}

// 习惯打卡
async function loadHabitsTab() {
  destroyChart();
  const data = lsGet('zhaozhao-habits', DEFAULT_HABITS);
  const today = fmtDate(new Date());
  const todayLogs = data.logs[today] || {};
  const container = document.getElementById('dataTabContent');

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = fmtDate(new Date(Date.now() - i*86400000));
    const logs = data.logs[d] || {};
    last7.push({ date: d.slice(5), count: Object.values(logs).filter(v=>v).length });
  }

  container.innerHTML = `
    <div class="data-panel">
      <div class="data-stats">
        <div class="data-stat"><span class="data-stat-num">${Object.values(todayLogs).filter(v=>v).length}/${data.habits.length}</span><span class="data-stat-label">今日打卡</span></div>
        <div class="data-stat"><span class="data-stat-num" id="streakDays">--</span><span class="data-stat-label">连续天数</span></div>
      </div>
      <div class="habit-check-grid">
        ${data.habits.map(h => `
          <div style="display:flex;align-items:center;gap:4px">
            <button class="habit-check ${todayLogs[h.id]?'done':''}" onclick="toggleHabit('${h.id}')">
              <span class="habit-check-icon">${esc(h.icon)}</span>
              <span>${esc(h.name)}</span>
            </button>
            <button class="btn-secondary" style="padding:2px 6px;font-size:10px" onclick="deleteHabit('${h.id}')" title="删除习惯">✕</button>
          </div>
        `).join('')}
        ${data.habits.length === 0 ? '<div style="color:var(--text-muted);padding:20px">暂无习惯，请在设置中添加</div>' : ''}
      </div>
      <div class="chart-container"><canvas id="habitChart"></canvas></div>
    </div>
  `;

  if (last7.length > 1) {
    const ctx = document.getElementById('habitChart').getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: last7.map(d => d.date),
        datasets: [{ label:'打卡数', data:last7.map(d=>d.count), backgroundColor:'#4f46e5', borderRadius:6 }]
      },
      options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ max:data.habits.length||1, ticks:{ stepSize:1 } } } }
    });
  }
}

async function toggleHabit(habitId) {
  const data = lsGet('zhaozhao-habits', DEFAULT_HABITS);
  const today = fmtDate(new Date());
  if (!data.logs[today]) data.logs[today] = {};
  data.logs[today][habitId] = !data.logs[today][habitId];
  lsSet('zhaozhao-habits', data);
  loadHabitsTab();
  if (currentPage === 'dashboard') loadDashboard();
}

async function deleteHabit(habitId) {
  if (!confirm('确定删除这个习惯？')) return;
  const data = lsGet('zhaozhao-habits', DEFAULT_HABITS);
  data.habits = data.habits.filter(h => h.id !== habitId);
  lsSet('zhaozhao-habits', data);
  loadHabitsTab();
  if (currentPage === 'dashboard') loadDashboard();
}

// 记账本
async function loadLedgerTab() {
  destroyChart();
  const data = lsGet('zhaozhao-ledger', DEFAULT_LEDGER);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthRecords = data.records.filter(r => r.date.startsWith(thisMonth));
  const income = monthRecords.filter(r => r.type === 'income').reduce((s,r) => s+r.amount, 0);
  const expense = monthRecords.filter(r => r.type === 'expense').reduce((s,r) => s+r.amount, 0);

  const catMap = {};
  monthRecords.filter(r => r.type === 'expense').forEach(r => {
    catMap[r.category] = (catMap[r.category]||0) + r.amount;
  });
  const cats = Object.entries(catMap).sort((a,b) => b[1]-a[1]);

  const container = document.getElementById('dataTabContent');
  container.innerHTML = `
    <div class="data-panel">
      <div class="data-stats">
        <div class="data-stat"><span class="data-stat-num" style="color:var(--accent-green)">¥${income.toFixed(0)}</span><span class="data-stat-label">本月收入</span></div>
        <div class="data-stat"><span class="data-stat-num" style="color:var(--accent-amber)">¥${expense.toFixed(0)}</span><span class="data-stat-label">本月支出</span></div>
        <div class="data-stat"><span class="data-stat-num">¥${(data.monthlyBudget||3000) - expense.toFixed(0)}</span><span class="data-stat-label">剩余预算</span></div>
      </div>
      <div class="chart-container"><canvas id="ledgerChart"></canvas></div>
      <div class="data-form">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:13px;color:var(--text-muted)">月预算:</span>
          <input type="number" id="ledgerBudget" placeholder="预算" value="${data.monthlyBudget||3000}" style="width:90px">
          <button class="btn-secondary" style="padding:4px 10px;font-size:12px" onclick="saveBudgetOnly()">💾</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="number" id="ledgerAmount" placeholder="金额" step="0.01" style="width:100px">
        <select id="ledgerType"><option value="expense">支出</option><option value="income">收入</option></select>
        <select id="ledgerCat">
          <option>餐饮</option><option>交通</option><option>购物</option><option>娱乐</option><option>住房</option><option>医疗</option><option>学习</option><option>其他</option>
        </select>
        <input type="date" id="ledgerDate" value="${fmtDate(new Date())}">
        <button class="btn-primary" onclick="saveLedger()">记账</button>
        </div>
      </div>
      <div class="data-list" id="ledgerList"></div>
    </div>
  `;

  renderLedgerList(data.records);
  if (cats.length > 0) {
    const ctx = document.getElementById('ledgerChart').getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c[0]),
        datasets: [{ data:cats.map(c=>c[1]), backgroundColor:['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'] }]
      },
      options: { responsive:true, plugins:{ legend:{ position:'bottom' } } }
    });
  }
}

function renderLedgerList(records) {
  const el = document.getElementById('ledgerList');
  if (!el) return;
  el.innerHTML = records.slice(0, 20).map(r =>
    `<div class="data-item"><span>${r.date} ${r.category}</span><span style="color:${r.type==='expense'?'var(--accent-amber)':'var(--accent-green)'}">${r.type==='expense'?'-':'+'}¥${r.amount.toFixed(2)} <button class="btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:8px" onclick="deleteLedger(${r.id})">🗑️</button></span></div>`
  ).join('') || '<div class="data-item" style="text-align:center;color:var(--text-muted)">暂无记录</div>';
}

async function saveLedger() {
  const amount = document.getElementById('ledgerAmount').value;
  if (!amount) return;
  const data = lsGet('zhaozhao-ledger', DEFAULT_LEDGER);
  data.records.unshift({
    id: genId(),
    amount: parseFloat(amount),
    type: document.getElementById('ledgerType').value,
    category: document.getElementById('ledgerCat').value,
    date: document.getElementById('ledgerDate').value,
  });
  lsSet('zhaozhao-ledger', data);
  loadLedgerTab();
  if (currentPage === 'dashboard') loadDashboard();
}

async function deleteLedger(id) {
  if (!confirm('确定删除这条记账记录？')) return;
  const data = lsGet('zhaozhao-ledger', DEFAULT_LEDGER);
  data.records = data.records.filter(r => r.id !== id);
  lsSet('zhaozhao-ledger', data);
  loadLedgerTab();
  if (currentPage === 'dashboard') loadDashboard();
}

// 阅读记录
async function loadReadingTab() {
  destroyChart();
  const data = lsGet('zhaozhao-reading', DEFAULT_READING);
  const container = document.getElementById('dataTabContent');
  container.innerHTML = `
    <div class="data-panel">
      <div class="data-form">
        <input type="text" id="bookTitle" placeholder="书名">
        <input type="text" id="bookAuthor" placeholder="作者" style="width:120px">
        <input type="number" id="bookPages" placeholder="总页数" style="width:80px" min="1">
        <button class="btn-primary" onclick="saveBook()">添加</button>
      </div>
      <div class="data-list" id="readingList">
        ${data.books.length ? data.books.map(b => `
          <div class="data-item">
            <div style="flex:1"><b>${esc(b.title)}</b>${b.author ? ' - ' + esc(b.author) : ''}</div>
            <div style="display:flex;align-items:center;gap:8px">
              ${b.status === 'reading' ? `
                <input type="number" id="page-${b.id}" value="${b.currentPage}" min="0" max="${b.totalPages}" style="width:60px;padding:4px 6px" onchange="updateBookPage(${b.id})">
                <span style="font-size:12px;color:var(--text-muted)">/ ${b.totalPages || '?'}页</span>
                <span class="progress-bar-small"><span style="width:${b.totalPages ? Math.round(b.currentPage/b.totalPages*100) : 0}%"></span></span>
                <button class="btn-secondary" style="padding:2px 8px;font-size:11px" onclick="finishBook(${b.id})">读完</button>
              ` : '<span style="color:var(--accent-green);font-size:13px">✅ 已读完</span>'}
              <button class="btn-secondary" style="padding:2px 8px;font-size:11px" onclick="deleteBook(${b.id})">🗑️</button>
            </div>
          </div>
        `).join('') : '<div class="data-item" style="text-align:center;color:var(--text-muted)">暂无在读书籍</div>'}
      </div>
    </div>
  `;
}

async function saveBook() {
  const title = document.getElementById('bookTitle').value.trim();
  if (!title) return;
  const data = lsGet('zhaozhao-reading', DEFAULT_READING);
  data.books.push({
    id: genId(),
    title,
    author: document.getElementById('bookAuthor').value.trim(),
    totalPages: parseInt(document.getElementById('bookPages').value) || 0,
    currentPage: 0,
    status: 'reading'
  });
  lsSet('zhaozhao-reading', data);
  loadReadingTab();
}

async function updateBookPage(id) {
  const el = document.getElementById('page-' + id);
  const data = lsGet('zhaozhao-reading', DEFAULT_READING);
  const book = data.books.find(b => b.id === id);
  if (book) { book.currentPage = parseInt(el.value) || 0; lsSet('zhaozhao-reading', data); }
  loadReadingTab();
}

async function finishBook(id) {
  const data = lsGet('zhaozhao-reading', DEFAULT_READING);
  const book = data.books.find(b => b.id === id);
  if (book) { book.status = 'done'; lsSet('zhaozhao-reading', data); }
  loadReadingTab();
  if (currentPage === 'dashboard') loadDashboard();
}

async function deleteBook(id) {
  if (!confirm('确定删除这本书？')) return;
  const data = lsGet('zhaozhao-reading', DEFAULT_READING);
  data.books = data.books.filter(b => b.id !== id);
  lsSet('zhaozhao-reading', data);
  loadReadingTab();
  if (currentPage === 'dashboard') loadDashboard();
}

// 工作记录
async function loadWorklogTab() {
  destroyChart();
  const data = lsGet('zhaozhao-worklog', DEFAULT_WORKLOG);
  const container = document.getElementById('dataTabContent');
  const totalHours = data.logs.reduce((s,l) => s + l.hours, 0);
  container.innerHTML = `
    <div class="data-panel">
      <div class="data-stats">
        <div class="data-stat"><span class="data-stat-num">${data.logs.length}</span><span class="data-stat-label">记录条数</span></div>
        <div class="data-stat"><span class="data-stat-num">${totalHours.toFixed(1)}h</span><span class="data-stat-label">总工时</span></div>
      </div>
      <div class="data-form">
        <input type="text" id="worklogTitle" placeholder="工作标题">
        <input type="number" id="worklogHours" placeholder="工时(h)" step="0.5" style="width:80px">
        <input type="date" id="worklogDate" value="${fmtDate(new Date())}">
        <button class="btn-primary" onclick="saveWorklog()">记录</button>
      </div>
      <div class="data-list" id="worklogList"></div>
    </div>
  `;
  renderWorklogList(data.logs);
}

function renderWorklogList(logs) {
  const el = document.getElementById('worklogList');
  if (!el) return;
  el.innerHTML = logs.length ? logs.slice(0, 30).map(l =>
    `<div class="data-item"><span>${esc(l.date)} ${esc(l.title)}</span><span>${l.hours}h <button class="btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:8px" onclick="deleteWorklog(${l.id})">🗑️</button></span></div>`
  ).join('') : '<div class="data-item" style="text-align:center;color:var(--text-muted)">暂无记录</div>';
}

async function saveWorklog() {
  const title = document.getElementById('worklogTitle').value.trim();
  if (!title) return;
  const data = lsGet('zhaozhao-worklog', DEFAULT_WORKLOG);
  data.logs.unshift({
    id: genId(),
    title,
    hours: parseFloat(document.getElementById('worklogHours').value) || 0,
    date: document.getElementById('worklogDate').value,
  });
  lsSet('zhaozhao-worklog', data);
  loadWorklogTab();
}

async function deleteWorklog(id) {
  if (!confirm('确定删除这条工作记录？')) return;
  const data = lsGet('zhaozhao-worklog', DEFAULT_WORKLOG);
  data.logs = data.logs.filter(l => l.id !== id);
  lsSet('zhaozhao-worklog', data);
  loadWorklogTab();
}

// ===== 分享 =====
async function shareWorkspace() {
  try {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    showToast('链接已复制', '分享链接', url);
  } catch(e) {
    showToast('提示', '分享链接', '请在浏览器中复制地址栏链接');
  }
}

// ===== 饮食记录（饭搭子开放接口，只读拉取） =====
// 饭搭子接口无 CORS 头，浏览器直连被拦，走 Supabase 数据库函数(http)中转
// 只需在 Supabase SQL Editor 跑一次建函数脚本，无需部署任何 Edge Function / Worker
const MEALS_KEY_STORAGE = 'zhaozhao-meals-key';
const MEALS_CACHE = 'zhaozhao-meals-cache';

function mealsKey() { return (localStorage.getItem(MEALS_KEY_STORAGE) || '').trim(); }

async function waitForSyncGlobal(timeoutMs) {
  const until = Date.now() + (timeoutMs || 8000);
  while (typeof Sync === 'undefined' && Date.now() < until) await new Promise(r => setTimeout(r, 100));
  if (typeof Sync === 'undefined') throw new Error('云同步模块尚未加载，请刷新页面后重试');
  return Sync;
}

async function renderMealsDiagnostics(box, rpcState) {
  const el = document.getElementById('mealsDiagnostics');
  if (!el) return;
  const key = mealsKey();
  let syncState = { configured: false, signedIn: false };
  try {
    if (typeof Sync !== 'undefined') {
      await Sync.waitReady();
      syncState = await Sync.sessionStatus();
    }
  } catch (e) { syncState.error = e.message || String(e); }
  const channel = rpcState || (syncState.signedIn ? { state: 'warn', detail: '未测试' } : { state: 'bad', detail: '等待云登录' });
  const items = [
    { label: '饭搭子 Key', state: key ? 'ok' : 'bad', detail: key ? '已填写' : '未填写' },
    { label: 'Supabase 配置', state: syncState.configured ? 'ok' : 'bad', detail: syncState.configured ? '已配置' : '未配置' },
    { label: '云同步登录', state: syncState.signedIn ? 'ok' : 'warn', detail: syncState.signedIn ? (syncState.email || '已登录') : '未登录' },
    { label: '请求通道', state: channel.state, detail: channel.detail }
  ];
  el.innerHTML = items.map(x => `<span class="meals-diagnostic ${x.state}"><i class="dot"></i>${esc(x.label)}：${esc(x.detail)}</span>`).join('');
}

const MEALS_SQL = `create extension if not exists http with schema extensions;

create or replace function public.get_meals(p_api_key text, p_from text default null, p_to text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text := 'https://fandazi.coze.site/api/open/meals';
  v_status integer;
  v_body text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_from is not null then v_url := v_url || '?from=' || p_from; end if;
  if p_to is not null then v_url := v_url || case when position('?' in v_url) > 0 then '&' else '?' end || 'to=' || p_to; end if;
  select r.status, r.content into v_status, v_body
  from extensions.http((
    'GET', v_url, extensions.http_headers('x-api-key', p_api_key), null, null
  )::extensions.http_request) as r;
  if v_status < 200 or v_status >= 300 then raise exception '饭搭子接口 HTTP %: %', v_status, left(coalesce(v_body, ''), 300); end if;
  return v_body::json;
end;
$$;

grant execute on function public.get_meals(text, text, text) to authenticated;`;

function setMealsRpcState(state, detail) {
  const el = document.getElementById('mealsDiagnostics');
  if (!el) return;
  const item = [...el.querySelectorAll('.meals-diagnostic')].find(x => x.textContent.includes('请求通道'));
  if (!item) return;
  item.className = 'meals-diagnostic ' + state;
  item.innerHTML = `<i class="dot"></i>请求通道：${esc(detail)}`;
}

async function mealsFetch(params, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  await waitForSyncGlobal();
  await Sync.waitReady();
  const status = await Sync.sessionStatus();
  if (!status.configured) throw new Error('未配置 Supabase 云同步：请先到“设置 → 云同步”填写项目 URL 和 anon key');
  if (!status.signedIn) throw new Error('云同步尚未登录：请先到“设置 → 云同步”完成邮箱登录，再连接饭搭子');
  if (!Sync.client) throw new Error('云同步客户端未就绪，请刷新页面重试');
  setMealsRpcState('warn', '请求中');
  const result = await Promise.race([
    Sync.client.rpc('get_meals', {
      p_api_key: mealsKey(),
      p_from: (params && (params.from || params.date)) || null,
      p_to: (params && (params.to || params.date)) || null
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时：Supabase 数据库函数或饭搭子接口未响应')), timeoutMs))
  ]);
  if (result.error) {
    const msg = result.error.message || '';
    if (msg.includes('Could not find the function') || msg.includes('does not exist') || msg.includes('Could not find')) {
      setMealsRpcState('bad', '函数未创建');
      throw new Error('数据库函数 get_meals 未创建：请在饮食页展开说明，把 SQL 粘贴到 Supabase SQL Editor 并点击 Run');
    }
    if (msg.includes('http') || msg.includes('extensions') || msg.includes('http_request')) {
      setMealsRpcState('bad', 'http扩展错误');
      throw new Error('Supabase http 扩展未启用或函数配置错误：请在 Database → Extensions 启用 http 后重新运行 SQL');
    }
    if (msg.includes('Not authenticated') || msg.includes('JWT') || msg.includes('auth')) {
      setMealsRpcState('bad', '登录会话失效');
      throw new Error('Supabase 登录会话无效：请到设置退出登录后重新登录');
    }
    setMealsRpcState('bad', 'RPC错误');
    throw new Error('Supabase RPC 错误：' + msg);
  }
  const json = result.data;
  if (!json || !json.success) {
    setMealsRpcState('bad', '上游返回异常');
    throw new Error((json && json.error) || '饭搭子接口返回异常');
  }
  setMealsRpcState('ok', 'RPC正常');
  return json.data;
}

function mealsStars(rating) {
  rating = rating || 0;
  return '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));
}

function mealItemHtml(m) {
  return `
    <div class="card-item" style="align-items:flex-start">
      <span style="font-size:18px">${esc(m.mood_emoji || '🍽️')}</span>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:11px;background:#4f46e5;color:#fff;border-radius:4px;padding:1px 5px">${esc(m.meal_type_label || m.meal_type || '')}</span>
          <b style="font-size:13px">${esc(m.food_name || '')}</b>
          ${m.is_exploration ? '<span style="font-size:11px;color:#d97706">🧭 探店</span>' : ''}
        </div>
        ${m.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(m.description)}</div>` : ''}
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
          ${m.rating ? `<span style="color:#f59e0b">${mealsStars(m.rating)}</span> · ` : ''}
          ${m.restaurant_name ? esc(m.restaurant_name) : ''}${m.restaurant_name && m.restaurant_category ? ' · ' : ''}${m.restaurant_category ? esc(m.restaurant_category) : ''}
          ${m.photo_count ? ' · 📷' + m.photo_count : ''}
        </div>
      </div>
    </div>`;
}

async function loadMeals(force) {
  const box = document.getElementById('mealsContent');
  if (!box) return;
  await renderMealsDiagnostics(box);

  if (loadMeals._busy) return;
  loadMeals._busy = true;
  const key = mealsKey();
  if (!key) {
    loadMeals._busy = false;
    box.innerHTML = `
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 8px">🍽️ 连接饭搭子</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">
          输入饭搭子 App「设置 → 开放接口」里的 API Key，连接后在这里展示你每天吃了什么、吃得怎么样。只读展示，Key 只保存在本机浏览器，不进仓库不上云。
        </p>
        <details style="margin:0 0 12px;padding:8px 12px;background:var(--bg-secondary);border-radius:8px;font-size:12px;color:var(--text-muted)">
          <summary style="cursor:pointer;font-weight:600;color:var(--text-primary)">⚠️ 首次使用需跑一次 SQL（30秒，点开看步骤）</summary>
          <div style="margin-top:10px;line-height:1.8">
            饭搭子接口不允许网页跨域直连，走你已有的 Supabase 数据库中转（无需部署任何 Worker）。<br><br>
            <b>步骤：</b><br>
            1. 打开 <a href="https://supabase.com/dashboard/project/whmjurdqzzbitpwsuliq/sql/new" target="_blank">Supabase SQL Editor</a><br>
            2. 粘贴下方 SQL → 点 Run → 显示 Success 即可<br>
            3. 回这里输入 API Key → 点「连接」<br><br>
            <textarea readonly style="width:100%;height:200px;font-size:10px;margin-top:4px;font-family:monospace" onclick="this.select()">${MEALS_SQL}</textarea>
          </div>
        </details>
        <div class="event-form" style="display:flex">
          <input type="text" id="mealsKeyInput" placeholder="fdz_ 开头的 API Key" style="flex:1" onkeydown="if(event.key==='Enter')saveMealsKey()">
          <button class="btn-primary" onclick="saveMealsKey()">连接</button>
        </div>
      </div>`;
    return;
  }

  // 10 分钟内用缓存，刷新按钮绕过
  let payload = null;
  const cache = lsGet(MEALS_CACHE, null);
  if (!force && cache && cache.data && (Date.now() - (cache.fetchedAt || 0)) < 10 * 60 * 1000) payload = cache.data;

  box.innerHTML = '<div class="card" style="color:var(--text-muted);text-align:center;padding:40px">加载中…</div>';

  if (!payload) {
    const to = fmtDate(new Date());
    const from = fmtDate(new Date(Date.now() - 6 * 86400000));
    try {
      payload = await mealsFetch({ from: from, to: to, limit: 100 });
      lsSet(MEALS_CACHE, { fetchedAt: Date.now(), data: payload });
    } catch (e) {
      setMealsRpcState('bad', e.message && e.message.includes('超时') ? '请求超时' : 'RPC失败');
      box.innerHTML = `<div class="card" style="padding:24px;color:var(--text-muted)">⚠️ 拉取失败：${esc(e.message)}<br><br>
        <button class="btn-secondary" onclick="mealsClearKey()">换 Key</button>
        <button class="btn-primary" onclick="loadMeals(true)">重试</button></div>`;
      loadMeals._busy = false;
      return;
    }
  }

  loadMeals._busy = false;
  const meals = payload.meals || [];
  const rated = meals.filter(m => m.rating);
  const avg = rated.length ? (rated.reduce((s, m) => s + m.rating, 0) / rated.length).toFixed(1) : '--';
  const loveCount = meals.filter(m => m.mood === 'love' || m.mood === 'amazing').length;
  const exploreCount = meals.filter(m => m.is_exploration).length;

  // 按日期分组（接口已按日期倒序，同日最新在前）
  const groups = {};
  meals.forEach(m => { (groups[m.date] = groups[m.date] || []).push(m); });
  const days = Object.keys(groups).sort().reverse();
  const today = fmtDate(new Date());

  box.innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-value">${meals.length}</div><div class="stat-label">近7天餐数</div></div>
      <div class="stat-card"><div class="stat-value">${avg}</div><div class="stat-label">平均评分</div></div>
      <div class="stat-card"><div class="stat-value">${loveCount}</div><div class="stat-label">爱了/超棒</div></div>
      <div class="stat-card"><div class="stat-value">${exploreCount}</div><div class="stat-label">探店</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="card-header">
        <span class="card-title">${petIcon('meals', 16)} ${esc(payload.nickname || '')} 最近吃了啥</span>
        <span style="font-size:11px;color:var(--text-muted)">${esc(payload.range || '')} · <a href="javascript:void(0)" onclick="loadMeals(true)" style="color:inherit;text-decoration:underline">刷新</a> · <a href="javascript:void(0)" onclick="mealsClearKey()" style="color:inherit;text-decoration:underline">断开</a></span>
      </div>
      ${days.length ? days.map(d => `
        <div style="margin:10px 0 4px;font-size:12px;color:var(--text-muted);font-weight:600">${d === today ? '今天' : d} · ${groups[d].length} 餐</div>
        ${groups[d].map(mealItemHtml).join('')}`).join('')
      : '<div class="card-item" style="color:var(--text-muted)">近 7 天还没有记录，去饭搭子记一笔吧 🍜</div>'}
    </div>`;
}

function saveMealsKey() {
  const v = (document.getElementById('mealsKeyInput').value || '').trim();
  if (!v) { alert('请输入 API Key'); return; }
  localStorage.setItem(MEALS_KEY_STORAGE, v);
  localStorage.removeItem(MEALS_CACHE);
  loadMeals(true);
}

function mealsClearKey() {
  if (!confirm('断开饭搭子连接？（只清除本机保存的 Key，不影响饭搭子 App 里的数据）')) return;
  localStorage.removeItem(MEALS_KEY_STORAGE);
  localStorage.removeItem(MEALS_CACHE);
  loadMeals();
}

// Dashboard 今日饮食卡片（异步填充，不阻塞首屏）
async function updateMealsCard() {
  const list = document.getElementById('mealsCardList');
  const badge = document.getElementById('mealsCardCount');
  if (!list || !badge) return;
  const key = mealsKey();
  if (!key) {
    badge.textContent = '未连接';
    list.innerHTML = `<span style="color:var(--text-muted);font-size:12px">去 <a href="javascript:void(0)" onclick="navigate('meals')" style="text-decoration:underline">饮食页</a> 连接饭搭子后展示</span>`;
    return;
  }
  try {
    const today = fmtDate(new Date());
    const data = await mealsFetch({ from: today, to: today, date: today }, 8000);
    const meals = data.meals || [];
    badge.textContent = meals.length + ' 餐';
    list.innerHTML = meals.length
      ? meals.map(m => `<div class="card-item"><span>${esc(m.mood_emoji || '🍽️')}</span><span style="font-size:11px;color:var(--text-muted);min-width:30px">${esc(m.meal_type_label || '')}</span><span style="flex:1;font-size:13px">${esc(m.food_name || '')}</span>${m.rating ? `<span style="color:#f59e0b;font-size:12px">${mealsStars(m.rating)}</span>` : ''}</div>`).join('')
      : '<div style="color:var(--text-muted);font-size:12px">今天还没记录，去饭搭子记一笔 🍜</div>';
  } catch (e) {
    badge.textContent = '--';
    list.innerHTML = `<span style="color:var(--text-muted);font-size:12px">拉取失败：${esc(e.message)}</span>`;
  }
}

// ===== Toast =====
function showToast(name, desc, detail) {
  const toast = document.getElementById('achievementToast');
  document.getElementById('achievementName').textContent = name;
  document.getElementById('achievementDesc').textContent = desc + (detail ? ' · ' + detail : '');
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ===== 模块管理 =====
function addModule() {
  const name = prompt('输入新模块名称：');
  if (!name) return;
  const modules = lsGet('zhaozhao-modules', []);
  const id = 'mod-' + Date.now();
  modules.push({ id, name, type: 'page', icon: 'circle' });
  lsSet('zhaozhao-modules', modules);
  buildNav();
  // 创建对应页面
  if (!document.getElementById('page-' + id)) {
    const main = document.getElementById('mainContent');
    const section = document.createElement('section');
    section.className = 'page';
    section.id = 'page-' + id;
    section.innerHTML = `<div class="page-header"><h2>📌 ${esc(name)}</h2><span class="page-subtitle">自定义模块</span></div><p style="color:var(--text-muted)">这是一个空白模块，你可以在这里添加内容。</p>`;
    main.appendChild(section);
  }
  showToast('成功', '模块已添加', name);
}

// ===== 初始化 =====
function init() {
  applyTheme(currentTheme);
  buildNav();
  navigate('dashboard');
}

init();
