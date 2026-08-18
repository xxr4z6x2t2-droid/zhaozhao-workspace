// ===== 昭朝工作台 sync.js v2.4 — Supabase 云同步（可选功能） =====
// 原则：
//   1) 本地优先：localStorage 永远是工作副本，未配置/未登录/断网时一切照旧
//   2) 零构建：supabase-js 从 CDN ESM 动态加载，未配置凭据时不加载任何外部资源
//   3) 按键整体快照同步（key 白名单），冲突按 updated_at 最后写入优先
//
// 需要的 Supabase 配置（设置页填写，存 localStorage）：
//   zhaozhao-supabase-url / zhaozhao-supabase-key（anon key，可公开，安全由 RLS 保证）
// 数据库表（Supabase SQL Editor 建一次）：
//   create table workspace_data (
//     user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
//     key text not null, value jsonb, updated_at timestamptz not null default now(),
//     primary key (user_id, key));
//   alter table workspace_data enable row level security;
//   create policy "own_select" on workspace_data for select using (auth.uid() = user_id);
//   create policy "own_insert" on workspace_data for insert with check (auth.uid() = user_id);
//   create policy "own_update" on workspace_data for update using (auth.uid() = user_id);
//   create policy "own_delete" on workspace_data for delete using (auth.uid() = user_id);

const Sync = {
  client: null,
  user: null,
  flushing: false,
  _applyGuard: false,   // 云端数据写回本地时，不触发 dirty 标记
  _timer: null,
  lastSync: null,

  KEYS: [
    'zhaozhao-events', 'zhaozhao-habits', 'zhaozhao-ledger', 'zhaozhao-weight',
    'zhaozhao-reading', 'zhaozhao-worklog', 'zhaozhao-knowledge',
    'zhaozhao-theme', 'zhaozhao-modules', 'zhaozhao-weather-city'
  ],

  cfg() {
    return {
      url: localStorage.getItem('zhaozhao-supabase-url') || '',
      key: localStorage.getItem('zhaozhao-supabase-key') || ''
    };
  },

  async ensureClient() {
    if (this.client) return this.client;
    const { url, key } = this.cfg();
    if (!url || !key) return null;
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.client = mod.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return this.client;
  },

  // ===== 本地变更标记（由拦截的 localStorage.setItem 触发） =====
  markDirty(key) {
    if (this.KEYS.indexOf(key) < 0) return;
    try {
      const dirty = JSON.parse(localStorage.getItem('zhaozhao-sync-dirty') || '[]');
      if (dirty.indexOf(key) < 0) dirty.push(key);
      localStorage.setItem('zhaozhao-sync-dirty', JSON.stringify(dirty));
    } catch (e) { return; }
    this.scheduleFlush();
  },

  scheduleFlush() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 3000); // 3 秒防抖
  },

  // ===== 推送：本地 dirty 键 → 云端 =====
  async flush() {
    if (this.flushing || !this.user || !this.client) return;
    this.flushing = true;
    try {
      let dirty = JSON.parse(localStorage.getItem('zhaozhao-sync-dirty') || '[]');
      for (const key of dirty) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue; // 本地无此键（未初始化），跳过
        const { error } = await this.client.from('workspace_data').upsert({
          user_id: this.user.id,
          key: key,
          value: JSON.parse(raw),
          updated_at: new Date().toISOString()
        });
        if (error) { this.status('同步失败'); return; }
        const meta = JSON.parse(localStorage.getItem('zhaozhao-sync-meta') || '{}');
        meta[key] = new Date().toISOString();
        localStorage.setItem('zhaozhao-sync-meta', JSON.stringify(meta));
      }
      if (dirty.length) {
        localStorage.setItem('zhaozhao-sync-dirty', '[]');
        this.lastSync = new Date();
        this.status('云端已同步 ' + this.fmtTime(this.lastSync));
        this.ui();
      }
    } catch (e) {
      this.status('同步失败（网络？）');
    } finally {
      this.flushing = false;
    }
  },

  // ===== 拉取：云端 → 本地（云端更新且本地无未推送修改时覆盖） =====
  async pull(silent) {
    const c = await this.ensureClient();
    if (!c) return;
    const { data: { session } } = await c.auth.getSession();
    if (!session || !session.user) { this.user = null; this.ui(); return; }
    this.user = session.user;

    const { data, error } = await c.from('workspace_data').select('key,value,updated_at');
    if (error) { this.status('拉取失败'); return; }

    const meta = JSON.parse(localStorage.getItem('zhaozhao-sync-meta') || '{}');
    const dirty = new Set(JSON.parse(localStorage.getItem('zhaozhao-sync-dirty') || '[]'));
    let changed = false;
    for (const row of (data || [])) {
      if (this.KEYS.indexOf(row.key) < 0) continue;
      if (row.updated_at > (meta[row.key] || '') && !dirty.has(row.key)) {
        this._applyGuard = true;
        try { localStorage.setItem(row.key, JSON.stringify(row.value)); }
        catch (e) { /* 超配额等，忽略 */ }
        this._applyGuard = false;
        meta[row.key] = row.updated_at;
        changed = true;
      }
    }
    localStorage.setItem('zhaozhao-sync-meta', JSON.stringify(meta));
    if (changed && !silent) this.rerender();
    await this.flush();
    this.ui();
  },

  // 云端数据写回后刷新当前界面
  rerender() {
    try {
      if (typeof buildNav === 'function') buildNav();
      if (typeof navigate === 'function' && typeof currentPage !== 'undefined') navigate(currentPage);
    } catch (e) { /* 界面刷新失败不影响数据 */ }
  },

  status(txt) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = txt;
  },

  fmtTime(d) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  // ===== 登录（邮箱验证码 OTP） =====
  async saveCfg() {
    const url = document.getElementById('syncUrl').value.trim().replace(/\/+$/, '');
    const key = document.getElementById('syncKey').value.trim();
    if (url && !/^https?:\/\//.test(url)) { alert('Project URL 需以 https:// 开头'); return; }
    localStorage.setItem('zhaozhao-supabase-url', url);
    localStorage.setItem('zhaozhao-supabase-key', key);
    this.client = null;
    this.ui();
    if (url && key) this.pull(true);
  },

  async sendCode() {
    const c = await this.ensureClient();
    if (!c) { alert('请先填写 Supabase URL 和 anon key'); return; }
    const email = document.getElementById('syncEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { alert('请输入有效邮箱'); return; }
    const { error } = await c.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } });
    if (error) alert('发送失败：' + error.message);
    else { this._pendingEmail = email; alert('验证码已发送到 ' + email + '，请查收（含垃圾邮件箱）'); }
  },

  async verifyCode() {
    const c = await this.ensureClient();
    if (!c) return;
    const email = this._pendingEmail || document.getElementById('syncEmail').value.trim();
    const token = document.getElementById('syncCode').value.trim();
    if (!token) { alert('请输入 6 位验证码'); return; }
    const { error } = await c.auth.verifyOtp({ email: email, token: token, type: 'email' });
    if (error) { alert('登录失败：' + error.message); return; }
    this.markAllDirty(); // 首次登录：标记全部本地数据待推送
    this.pull(false).then(() => this.flush());
  },

  // 标记所有本地数据为待同步（首次登录 / 强制全量推送时用）
  markAllDirty() {
    const dirty = [];
    for (const k of this.KEYS) {
      if (localStorage.getItem(k) !== null) dirty.push(k);
    }
    localStorage.setItem('zhaozhao-sync-dirty', JSON.stringify(dirty));
  },

  async logout() {
    if (this.client) await this.client.auth.signOut();
    this.user = null;
    this.status('本地存储');
    this.ui();
  },

  // ===== 设置页 UI（注入 #syncSection） =====
  ui() {
    const box = document.getElementById('syncSection');
    if (!box) return;
    const { url, key } = this.cfg();

    if (!url || !key) {
      // 状态 1：未配置
      box.innerHTML = `
        <div class="sync-form">
          <input type="text" id="syncUrl" placeholder="Supabase Project URL（https://xxx.supabase.co）">
          <input type="text" id="syncKey" placeholder="Supabase anon key（公开无害，安全由 RLS 保证）">
          <button class="btn-primary" onclick="Sync.saveCfg()">保存配置</button>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px">
          还没有 Supabase 项目？supabase.com 免费注册 → 新建项目 → SQL Editor 执行 sync.js 顶部注释里的建表语句 →
          Project Settings → API 复制 URL 和 anon key 填到上面。
        </p>`;
      return;
    }

    if (!this.user) {
      // 状态 2：已配置未登录
      box.innerHTML = `
        <div class="sync-form">
          <input type="email" id="syncEmail" placeholder="邮箱（用于登录并隔离你的数据）">
          <div style="display:flex;gap:8px">
            <input type="text" id="syncCode" placeholder="6 位验证码" style="width:120px" inputmode="numeric">
            <button class="btn-primary" onclick="Sync.sendCode()">发送验证码</button>
            <button class="btn-primary" onclick="Sync.verifyCode()">登录</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px">
          已配置：${url} · <a href="javascript:void(0)" onclick="localStorage.removeItem('zhaozhao-supabase-url');localStorage.removeItem('zhaozhao-supabase-key');Sync.client=null;Sync.ui()">清除配置</a>
        </p>`;
      return;
    }

    // 状态 3：已登录
    const dirty = JSON.parse(localStorage.getItem('zhaozhao-sync-dirty') || '[]');
    box.innerHTML = `
      <div class="sync-status">
        <span>👤 ${this.user.email}</span>
        <span>${dirty.length ? '⏳ ' + dirty.length + ' 项待同步' : '✅ ' + (this.lastSync ? '上次同步 ' + this.fmtTime(this.lastSync) : '已连接云端')}</span>
      </div>
      <div class="backup-actions" style="margin-top:10px">
        <button class="btn-primary" onclick="Sync.markAllDirty();Sync.pull(false).then(()=>Sync.flush())">🔄 立即同步</button>
        <button class="btn-secondary" onclick="Sync.logout()">退出登录</button>
      </div>`;
  },

  // ===== 启动 =====
  async boot() {
    this.ui();
    const { url, key } = this.cfg();
    if (!url || !key) return;
    // 魔法链接回调：URL hash 里有 session token 时，等客户端自动解析后再拉取
    if (location.hash && (location.hash.includes('access_token') || location.hash.includes('error'))) {
      const c = await this.ensureClient();
      if (c) {
        // 客户端 detectSessionInUrl 会自动解析 hash 并存 session
        // 清掉 hash 防止重复触发，延迟一下让客户端完成解析
        setTimeout(() => {
          history.replaceState(null, '', location.pathname + location.search);
          this.markAllDirty(); // 魔法链接首次登录也全量推送
          this.pull(false).then(() => this.flush());
        }, 800);
      }
    }
    // 先尝试恢复会话并拉取，失败静默（离线照常可用）
    try {
      await this.pull(true);
      // 每 5 分钟定时拉取
      setInterval(() => { if (navigator.onLine) this.pull(true); }, 5 * 60 * 1000);
      // 页面回到前台时拉取
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) this.pull(false);
      });
    } catch (e) { this.status('本地存储'); }
  }
};

// 暴露给 onclick 内联调用
window.Sync = Sync;

// ===== 拦截 localStorage.setItem：所有 zhaozhao-* 写入自动标记待同步 =====
(function () {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, val) {
    orig.call(this, key, val);
    if (Sync._applyGuard) return;
    if (key === 'zhaozhao-sync-dirty' || key === 'zhaozhao-sync-meta') return;
    if (key.indexOf('zhaozhao-') !== 0) return;
    if (key === 'zhaozhao-supabase-url' || key === 'zhaozhao-supabase-key') return;
    Sync.markDirty(key);
  };
})();

// DOM 就绪后启动（module 脚本本身延迟执行，此时 DOM 已就绪）
Sync.boot();
