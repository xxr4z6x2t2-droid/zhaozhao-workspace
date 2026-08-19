# 昭朝工作台 v3.0 更新日志

## 版本信息
- **版本号**: v3.0
- **版本名**: 邮箱登录 + 管理后台版
- **发布日期**: 2025

---

## 核心改动

### 1. sync.js v11 — 登录方式重构

**移除:**
- Magic Link（邮箱验证码/魔法链接）登录方式
- `sendCode()`, `pasteLink()`, `verifyCode()` 等 Magic Link 相关方法
- 手动配置 Supabase URL/Key 的 UI 和流程
- `saveCfg()` 方法

**新增:**
- `DEFAULT_SUPABASE_URL` / `DEFAULT_SUPABASE_KEY` 硬编码常量（占位符，需替换为真实值）
- `register(email, password)` — 邮箱+密码注册（密码至少 6 位）
- `login(email, password)` — 邮箱+密码登录
- `isAdmin()` — 检查当前用户是否为管理员
- `getUsers()` — 查询所有用户列表（仅管理员）
- `getWorkspaceStats()` — 获取工作台数据统计（仅管理员）
- `updateUserRole(userId, role)` — 更新用户角色（仅管理员）
- `deleteUser(userId)` — 删除用户（仅管理员，不可删除自己）
- `_userProfile` 缓存当前用户的 profile 信息
- `_loadProfile()` — 从 `user_profiles` 表加载当前用户信息
- `_switchAuthTab()` / `_submitAuth()` — 登录/注册表单交互

**保留:**
- KEYS 白名单不变
- localStorage 拦截、dirty 标记、push/pull 同步逻辑不变
- `boot()` 启动流程（去掉 Magic Link hash 检测）
- `markAllDirty()`, `markDirty()`, `flush()`, `pull()`, `logout()` 等

### 2. index.html — 新增管理员页面

**新增:**
- `#page-admin` — 管理后台页面（统计卡片、用户列表、数据概览）
- `#adminSection` — 设置页管理员快捷入口容器

**修改:**
- 云同步说明文案微调
- 版本号更新为 v3.0
- 缓存版本号更新（app.js?v=30, sync.js?v=11）

### 3. app.js — 导航与管理功能

**新增:**
- `loadAdminData()` — 加载管理后台数据（用户列表、统计、数据概览）
- `updateAdminUser(userId, newRole)` — 修改用户角色
- `removeAdminUser(userId)` — 删除用户

**修改:**
- `buildNav()` — 管理员用户自动在底部导航添加「管理后台」入口
- `getPageName()` — 新增 admin 显示名
- `navigate()` — 新增 admin 页面加载和权限检查
- `renderSettings()` — 管理员区域显隐控制
- `navIcons` — 新增 admin 图标映射

### 4. style.css — 新增样式

**新增:**
- `.auth-form` — 登录/注册表单卡片样式
- `.auth-tabs` / `.auth-tab` — 登录/注册切换标签
- `.admin-stats` — 管理后台统计卡片网格
- `.admin-table` — 用户列表表格样式
- `.admin-badge` — 角色标签（admin/user 两种样式）
- 暗色主题适配（tech/night 主题的 admin badge）
- 响应式适配（移动端表格隐藏日期列）

---

## 数据库变更

新增 `user_profiles` 表及相关 RLS 策略、触发器：

```sql
CREATE TABLE user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  role text DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz DEFAULT now(),
  last_login timestamptz DEFAULT now()
);
```

- 第一个注册的用户自动成为管理员（通过触发器实现）
- RLS 策略：用户只能查看/更新自己的 profile，管理员可以查看所有
- 详细的建表 SQL 见 sync.js 顶部注释

---

## 向后兼容性

- ✅ 已有 localStorage 数据不受影响
- ✅ 所有现有功能（dashboard、饮食、知识库、事件、数据看板、日记）正常工作
- ✅ 饭搭子联动部分（meals）保持 API Key 方式不变
- ✅ 8 套主题全部兼容新增组件

---

## 部署步骤

1. 在 Supabase SQL Editor 执行 sync.js 顶部的建表 SQL
2. 替换 sync.js 中的 `DEFAULT_SUPABASE_URL` 和 `DEFAULT_SUPABASE_KEY` 为真实值
3. 部署静态文件（无需后端变更）
4. 第一个注册的用户自动成为管理员
