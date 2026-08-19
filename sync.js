// ===== 昭朝工作台 sync.js v11 — Supabase 云同步（邮箱+密码登录 + 管理员后台） =====
//
// 原则：
//   1) 本地优先：localStorage 永远是工作副本，未登录/断网时一切照旧
//   2) 零构建：supabase-js 从 CDN ESM 动态加载
//   3) 按键整体快照同步（key 白名单），冲突按 updated_at 最后写入优先
//   4) 第一个注册的用户自动成为管理员
//
// ====================== 数据库建表 SQL（Supabase SQL Editor 执行一次） ======================
//
// -- 用户资料表（扩展 auth.users）
// CREATE TABLE user_profiles (
//   id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
//   email text NOT NULL,
//   display_name text,
//   role text DEFAULT 'user' CHECK (role IN ('user', 'admin')),
//   created_at timestamptz DEFAULT now(),
//   last_login timestamptz DEFAULT now()
// );
//
// -- RLS
// ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "users can view own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
// CREATE POLICY "admins can view all profiles" ON user_profiles FOR SELECT USING (
//   EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
// );
// CREATE POLICY "users can update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id);
// CREATE POLICY "admins can update all profiles" ON user_profiles FOR UPDATE USING (
//   EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
// );
// CREATE POLICY "admins can delete profiles" ON user_profiles FOR DELETE USING (
//   EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
// );
//
// -- 自动创建 profile 的触发器
// CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
// DECLARE
//   is_first_user boolean;
// BEGIN
//   is_first_user := NOT EXISTS (SELECT 1 FROM user_profiles);
//   INSERT INTO user_profiles (id, email, role)
//   VALUES (NEW.id, NEW.email, CASE WHEN is_first_user THEN 'admin' ELSE 'user' END);
//   RETURN NEW;
// END;
// $$ LANGUAGE plpgsql SECURITY DEFINER;
//
// DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
// CREATE TRIGGER on_auth_user_created
//   AFTER INSERT ON auth.users
//   FOR EACH ROW EXECUTE FUNCTION handle_new_user();
//
// -- 已有的 workspace_data 表保持不变
// CREATE TABLE workspace_data (
//   user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
//   key text not null, value jsonb, updated_at timestamptz not null default now(),
//   primary key (user_id, key));
// ALTER TABLE workspace_data ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "own_select" ON workspace_data FOR SELECT USING (auth.uid() = user_id);
// CREATE POLICY "own_insert" ON workspace_data FOR INSERT WITH CHECK (auth.uid() = user_id);
// CREATE POLICY "own_update" ON workspace_data FOR UPDATE USING (auth.uid() = user_id);
// CREATE POLICY "own_delete" ON workspace_data FOR DELETE USING (auth.uid() = user_id);
//
// ====================================================================================

// ===== 默认 Supabase 配置（请替换为你的真实项目 URL 和 anon key） =====
const DEFAULT_SUPABASE_URL = 'https://your-project.supabase.co';
const DEFAULT_SUPABASE_KEY = 'your-anon-key';

const Sync = {
  client: null,
  user: null,
  _userProfile: null,   // 缓存当前用户的 profile（含 role）
  flushing: false,
  _applyGuard: false,   // 云端数据写回本地时，不触发 dirty 标记
  _timer: null,
  lastSync: null,
  ready: null,
  _authUnsubscribe: null,

  KEYS: [
    'zhaozhao-events', 'zhaozhao-habits', 'zhaozhao-ledger', 'zhaozhao-weight',
    'zhaozhao-reading', 'zhaozhao-worklog', 'zhaozhao-knowledge',
    'zhaozhao-theme', 'zhaozhao-modules', 'zhaozhao-weather-city',
    'zhaozhao-diary'
  ],

  cfg() {
    return {
      url: DEFAULT_SUPABASE_URL,
      key: DEFAULT_SUPABASE_KEY
    };
  },

  async ensureClient() {
    if (this.client) return this.client;
    const { url, key } = this.cfg();
    if (!url || !key || url === 'https://your-project.supabase.co' || key === 'your-anon-key') return null;
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.client = mod.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return this.client;
  },

  async waitReady() {
    if (this.ready) return this.ready;
    this.ready = this.boot();
    try { await this.ready; } finally { this.ready = null; }
    return this.client;
  },

  async sessionStatus() {
    const c = await this.ensureClient();
    if (!c) return { configured: false, signedIn: false, email: '' };
    const { data, error } = await c.auth.getSession();
    const session = data && data.session;
    if (error || !session || !session.user) {
      this.user = null;
      this._userProfile = null;
      return { configured: true, signedIn: false, email: '', error: error ? error.message : '未登录云同步' };
    }
    this.user = session.user;
    // 加载用户 profile
    await this._loadProfile();
    return { configured: true, signedIn: true, email: session.user.email || '' };
  },

  // ===== 加载当前用户的 profile =====
  async _loadProfile() {
    if (!this.client || !this.user) { this._userProfile = null; return; }
    try {
      const { data, error } = await this.client.from('user_profiles').select('*').eq('id', this.user.id).maybeSingle();
      if (!error && data) {
        this._userProfile = data;
      } else {
        // profile 表可能还没建好或触发器没跑，fallback
        this._userProfile = { id: this.user.id, email: this.user.email, role: 'user' };
      }
    } catch (e) {
      this._userProfile = { id: this.user.id, email: this.user.email, role: 'user' };
    }
  },

  // ===== 判断当前用户是否为管理员 =====
  isAdmin() {
    return this._userProfile && this._userProfile.role === 'admin';
  },

  // ===== 注册 =====
  async register(email, password) {
    const c = await this.ensureClient();
    if (!c) { alert('Supabase 未配置，请检查项目 URL 和 anon key'); return { error: { message: '未配置 Supabase' } }; }
    if (!password || password.length < 6) {
      alert('密码至少 6 位');
      return { error: { message: '密码至少 6 位' } };
    }
    const { data, error } = await c.auth.signUp({ email, password });
    if (error) {
      alert('注册失败：' + error.message);
      return { error };
    }
    this.user = data.user;
    // 如果是第一个用户，触发器会自动设为 admin
    await this._loadProfile();
    // 标记本地数据待同步
    this.markAllDirty();
    this.pull(false).then(() => this.flush());
    this.ui();
    if (typeof buildNav === 'function') buildNav();
    return { data, error: null };
  },

  // ===== 登录 =====
  async login(email, password) {
    const c = await this.ensureClient();
    if (!c) { alert('Supabase 未配置，请检查项目 URL 和 anon key'); return { error: { message: '未配置 Supabase' } }; }
    if (!password || password.length < 6) {
      alert('密码至少 6 位');
      return { error: { message: '密码至少 6 位' } };
    }
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) {
      alert('登录失败：' + error.message);
      return { error };
    }
    this.user = data.user;
    await this._loadProfile();
    // 更新 last_login
    try {
      await this.client.from('user_profiles').update({ last_login: new Date().toISOString() }).eq('id', this.user.id);
    } catch (e) { /* 静默 */ }
    // 标记本地数据待同步
    this.markAllDirty();
    this.pull(false).then(() => this.flush());
    this.ui();
    if (typeof buildNav === 'function') buildNav();
    return { data, error: null };
  },

  // ===== 获取所有用户列表（仅管理员） =====
  async getUsers() {
    if (!this.isAdmin()) { alert('仅管理员可操作'); return []; }
    const c = await this.ensureClient();
    if (!c) return [];
    const { data, error } = await c.from('user_profiles').select('*').order('created_at', { ascending: false });
    if (error) {
      alert('查询用户失败：' + error.message);
      return [];
    }
    return data || [];
  },

  // ===== 获取工作台数据统计（仅管理员） =====
  async getWorkspaceStats() {
    if (!this.isAdmin()) return {};
    const c = await this.ensureClient();
    if (!c) return {};
    try {
      // 获取总用户数
      const { data: users } = await c.from('user_profiles').select('id');
      const totalUsers = users ? users.length : 0;

      // 获取今日活跃（last_login 是今天的）
      const today = new Date().toISOString().slice(0, 10);
      const todayActive = users ? users.filter(u => u.last_login && u.last_login.startsWith(today)).length : 0;

      // 获取数据总量（从 workspace_data 表统计）
      // 管理员通过 RPC 或逐条查询，这里用简单的统计
      const { data: dataRows } = await c.from('workspace_data').select('user_id,key', { count: 'exact', head: false });
      const totalDataRows = dataRows ? dataRows.length : 0;

      // 各模块数据分布
      const keyDist = {};
      if (dataRows) {
        dataRows.forEach(r => {
          keyDist[r.key] = (keyDist[r.key] || 0) + 1;
        });
      }

      return { totalUsers, todayActive, totalDataRows, keyDist };
    } catch (e) {
      return { totalUsers: 0, todayActive: 0, totalDataRows: 0, keyDist: {} };
    }
  },

  // ===== 更新用户角色（仅管理员） =====
  async updateUserRole(userId, role) {
    if (!this.isAdmin()) { alert('仅管理员可操作'); return false; }
    if (role !== 'user' && role !== 'admin') { alert('无效角色'); return false; }
    const c = await this.ensureClient();
    if (!c) return false;
    const { error } = await c.from('user_profiles').update({ role }).eq('id', userId);
    if (error) {
      alert('更新失败：' + error.message);
      return false;
    }
    // 如果改的是自己，刷新 profile 缓存
    if (userId === this.user.id) {
      await this._loadProfile();
      if (typeof buildNav === 'function') buildNav();
    }
    return true;
  },

  // ===== 删除用户（仅管理员） =====
  async deleteUser(userId) {
    if (!this.isAdmin()) { alert('仅管理员可操作'); return false; }
    if (userId === this.user.id) { alert('不能删除自己'); return false; }
    const c = await this.ensureClient();
    if (!c) return false;
    // 删除 profile（cascade 会同步删除 auth.users 和 workspace_data）
    const { error } = await c.from('user_profiles').delete().eq('id', userId);
    if (error) {
      alert('删除失败：' + error.message);
      return false;
    }
    return true;
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

  // ===== 推送：本地 dirty 键 → 云端（逐项推进：成功的清掉，失败的保留并显示原因） =====
  async flush() {
    if (this.flushing || !this.user || !this.client) return;
    this.flushing = true;
    try {
      const dirty = JSON.parse(localStorage.getItem('zhaozhao-sync-dirty') || '[]');
      if (!dirty.length) return;
      const failed = [];
      let lastErr = '';
      const meta = JSON.parse(localStorage.getItem('zhaozhao-sync-meta') || '{}');
      for (const key of dirty) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue; // 本地无此键（未初始化），视为已处理
        let value;
        try { value = JSON.parse(raw); }
        catch (e) { failed.push(key); lastErr = key + ' 本地数据异常'; continue; }
        const { error } = await this.client.from('workspace_data').upsert({
          user_id: this.user.id,
          key: key,
          value: value,
          updated_at: new Date().toISOString()
        });
        if (error) { failed.push(key); lastErr = error.message; continue; }
        meta[key] = new Date().toISOString();
      }
      localStorage.setItem('zhaozhao-sync-meta', JSON.stringify(meta));
      localStorage.setItem('zhaozhao-sync-dirty', JSON.stringify(failed));
      this._lastErr = failed.length ? lastErr : '';
      if (!failed.length) {
        this.lastSync = new Date();
        this.status('云端已同步 ' + this.fmtTime(this.lastSync));
      } else {
        this.status('同步失败：' + lastErr);
      }
      this.ui();
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
    if (!session || !session.user) { this.user = null; this._userProfile = null; this.ui(); return; }
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
    this._userProfile = null;
    this.status('本地存储');
    this.ui();
    if (typeof buildNav === 'function') buildNav();
  },

  // ===== 设置页 UI（注入 #syncSection） =====
  ui() {
    const box = document.getElementById('syncSection');
    if (!box) return;

    if (!this.user) {
      // 未登录 → 显示登录/注册表单
      box.innerHTML = `
        <div class="auth-form">
          <div class="auth-tabs">
            <button class="auth-tab active" id="authTabLogin" onclick="Sync._switchAuthTab('login')">登录</button>
            <button class="auth-tab" id="authTabRegister" onclick="Sync._switchAuthTab('register')">注册</button>
          </div>
          <div id="authFormContent">
            <input type="email" id="authEmail" placeholder="邮箱">
            <input type="password" id="authPassword" placeholder="密码（至少 6 位）" minlength="6">
            <button class="btn-primary" id="authSubmitBtn" onclick="Sync._submitAuth()">登录</button>
          </div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px">
          ☁️ 登录后多设备数据自动同步。第一个注册的用户自动成为管理员。
        </p>`;
      // 更新管理员区域
      this._updateAdminSection();
      return;
    }

    // 已登录
    const dirty = JSON.parse(localStorage.getItem('zhaozhao-sync-dirty') || '[]');
    const roleBadge = this.isAdmin() ? ' 👑 管理员' : '';
    box.innerHTML = `
      <div class="sync-status">
        <span>👤 ${this.user.email}${roleBadge}</span>
        <span>${dirty.length ? '⏳ ' + dirty.length + ' 项待同步' + (this._lastErr ? '（' + this._lastErr + '）' : '') : '✅ ' + (this.lastSync ? '上次同步 ' + this.fmtTime(this.lastSync) : '已连接云端')}</span>
      </div>
      <div class="backup-actions" style="margin-top:10px">
        <button class="btn-primary" onclick="Sync.markAllDirty();Sync.pull(false).then(()=>Sync.flush())">🔄 立即同步</button>
        <button class="btn-secondary" onclick="Sync.logout()">退出登录</button>
      </div>`;
    // 更新管理员区域
    this._updateAdminSection();
  },

  // ===== 登录/注册表单切换 =====
  _authMode: 'login',

  _switchAuthTab(mode) {
    this._authMode = mode;
    const loginTab = document.getElementById('authTabLogin');
    const registerTab = document.getElementById('authTabRegister');
    const submitBtn = document.getElementById('authSubmitBtn');
    if (loginTab && registerTab && submitBtn) {
      loginTab.classList.toggle('active', mode === 'login');
      registerTab.classList.toggle('active', mode === 'register');
      submitBtn.textContent = mode === 'login' ? '登录' : '注册';
    }
  },

  async _submitAuth() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { alert('请输入有效邮箱'); return; }
    if (!password || password.length < 6) { alert('密码至少 6 位'); return; }
    const btn = document.getElementById('authSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
    try {
      if (this._authMode === 'register') {
        await this.register(email, password);
      } else {
        await this.login(email, password);
      }
    } catch (e) {
      alert('操作失败：' + (e.message || e));
      if (btn) { btn.disabled = false; btn.textContent = this._authMode === 'login' ? '登录' : '注册'; }
    }
  },

  // ===== 更新管理员区域 =====
  _updateAdminSection() {
    const adminBox = document.getElementById('adminSection');
    if (!adminBox) return;
    if (!this.user || !this.isAdmin()) {
      adminBox.innerHTML = '';
      adminBox.style.display = 'none';
      return;
    }
    adminBox.style.display = '';
    adminBox.innerHTML = `
      <h3>👑 管理员功能</h3>
      <div style="padding:12px;background:var(--accent-soft);border-radius:var(--radius);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text-primary)">🔧 管理后台</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">查看用户、管理权限、数据概览</div>
        </div>
        <button class="btn-primary" onclick="navigate('admin')" style="padding:8px 16px;font-size:13px">进入管理后台</button>
      </div>`;
  },

  // ===== 启动 =====
  async boot() {
    this.ui();
    const { url, key } = this.cfg();
    if (!url || !key || url === 'https://your-project.supabase.co' || key === 'your-anon-key') return;
    const c = await this.ensureClient();
    if (!c) return;
    if (this._authUnsubscribe) this._authUnsubscribe();
    const authListener = c.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        this.user = session?.user || null;
        this._loadProfile().then(() => {
          // 更新 last_login
          try {
            this.client.from('user_profiles').update({ last_login: new Date().toISOString() }).eq('id', this.user.id);
          } catch (e) { /* 静默 */ }
          this.markAllDirty();
          this.pull(false).then(() => this.flush());
          this.ui();
          if (typeof buildNav === 'function') buildNav();
        });
      } else if (event === 'SIGNED_OUT') {
        this.user = null;
        this._userProfile = null;
        this.ui();
        if (typeof buildNav === 'function') buildNav();
      }
    });
    this._authUnsubscribe = authListener && authListener.data && authListener.data.subscription
      ? () => authListener.data.subscription.unsubscribe() : null;
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
    Sync.markDirty(key);
  };
})();

// DOM 就绪后启动（module 脚本本身延迟执行，此时 DOM 已就绪）
Sync.ready = Sync.boot();
