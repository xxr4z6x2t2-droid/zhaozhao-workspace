// ===== 昭朝工作台 diary.js v2.3/v2.4 — 日记数据导出（Echo Diary 配套） =====
// 用法：
//   1) 网页模式 ?diary=1            → 页面只输出当日日记数据 JSON（供 iOS 快捷指令「在网页上运行 JavaScript」抓取）
//      可选 &date=YYYY-MM-DD | 昨天 | -N（往前 N 天）
//   2) 设置页「分享日记数据」按钮    → shareDiaryData()，系统分享面板 / 下载 JSON 文件
//   3) window.buildDiaryExport(dateStr) → 供其他脚本调用
// 本文件自包含，不依赖 app.js（diary 模式下不加载 app.js，轻量快速）。
(function () {
  'use strict';

  // ===== localStorage 读取（与 app.js 同语义） =====
  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ===== 循环日程命中判断（与 app.js 逻辑保持一致） =====
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
  function eventHitsDate(event, dateStr) {
    if (event.recurrence) return matchesRecurrence(event, dateStr);
    if (!event.startDate) return false;
    return event.startDate <= dateStr && (!event.endDate || event.endDate >= dateStr);
  }

  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  // UTC ISO 字符串 → 本地日期（createdAt 是 toISOString() 生成的 UTC，直接字符串匹配会跨日错位）
  function isoToLocalDate(iso) {
    try { return fmtDate(new Date(iso)); } catch (e) { return ''; }
  }

  // ===== 核心：组装某一天的日记数据 =====
  function buildDiaryExport(dateStr) {
    dateStr = dateStr || fmtDate(new Date());

    var events = lsGet('zhaozhao-events', []);
    var habits = lsGet('zhaozhao-habits', { habits: [], logs: {} });
    var ledger = lsGet('zhaozhao-ledger', { records: [], monthlyBudget: 0 });
    var weight = lsGet('zhaozhao-weight', { records: [], goal: null });
    var reading = lsGet('zhaozhao-reading', { books: [] });
    var worklog = lsGet('zhaozhao-worklog', { logs: [] });
    var city = localStorage.getItem('zhaozhao-weather-city') || '长春';

    // 当日日程（含循环）
    var schedules = events.filter(function (e) { return e.type === 'schedule' && eventHitsDate(e, dateStr); })
      .map(function (e) {
        return {
          title: e.title,
          content: e.content || '',
          time: (!e.endDate || e.endDate === e.startDate) ? (e.startDate || '') : (e.startDate + ' ~ ' + e.endDate),
          completed: e.recurrence ? (e.completedDates || []).indexOf(dateStr) >= 0 : !!e.completed,
          recurring: !!e.recurrence
        };
      });

    // 当日创建的待办 / 笔记（按本地日期匹配 createdAt）
    var todos = events.filter(function (e) { return e.type === 'todo' && isoToLocalDate(e.createdAt) === dateStr; })
      .map(function (e) { return { title: e.title, content: e.content || '', completed: !!e.completed }; });
    var notes = events.filter(function (e) { return e.type === 'note' && isoToLocalDate(e.createdAt) === dateStr; })
      .map(function (e) { return { title: e.title, content: e.content || '' }; });

    // 当日习惯打卡
    var dayLogs = ((habits.logs || {})[dateStr]) || {};
    var habitList = (habits.habits || []).map(function (h) {
      return { name: h.name, icon: h.icon || '', checked: !!dayLogs[h.id] };
    });

    // 当日记账
    var dayLedger = (ledger.records || []).filter(function (r) { return r.date === dateStr; });
    var expense = 0, income = 0;
    dayLedger.forEach(function (r) { if (r.type === 'income') income += (r.amount || 0); else expense += (r.amount || 0); });

    // 当日体重
    var wRecord = null;
    (weight.records || []).forEach(function (r) { if (r.date === dateStr) wRecord = r; });

    // 阅读清单
    var books = (reading.books || []).map(function (b) {
      return {
        title: b.title,
        author: b.author || '',
        totalPages: b.totalPages || 0,
        currentPage: b.currentPage || 0,
        status: b.status || 'reading'
      };
    });

    // 当日工作日志
    var dayWorklog = (worklog.logs || []).filter(function (l) { return l.date === dateStr; })
      .map(function (l) { return { title: l.title, hours: l.hours || 0 }; });

    var d = new Date(dateStr + 'T00:00:00');
    return {
      app: 'zhaozhao-workspace',
      export: 'diary',
      version: '2.6',
      date: dateStr,
      weekday: WEEKDAYS[d.getDay()],
      city: city,
      events: { schedules: schedules, todos: todos, notes: notes },
      habits: habitList,
      ledger: {
        records: dayLedger,
        dayExpense: Math.round(expense * 100) / 100,
        dayIncome: Math.round(income * 100) / 100,
        monthlyBudget: ledger.monthlyBudget || 0
      },
      weight: wRecord ? { kg: wRecord.weight, goal: weight.goal || null } : null,
      reading: { books: books },
      worklog: { logs: dayWorklog },
      generatedAt: new Date().toISOString()
    };
  }

  // 导出给外部（普通模式下设置页按钮 / 快捷指令网页 JS 均可调用）
  if (typeof window !== 'undefined') {
    window.buildDiaryExport = buildDiaryExport;

    // 设置页「分享日记数据」：优先系统分享面板，降级下载 JSON 文件
    window.shareDiaryData = async function () {
      var data = buildDiaryExport(fmtDate(new Date()));
      var text = JSON.stringify(data, null, 2);
      try {
        if (navigator.share) {
          await navigator.share({ title: '昭朝工作台日记数据 ' + data.date, text: text });
        } else {
          var blob = new Blob([text], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'echodiary_' + data.date + '.json';
          a.click();
          URL.revokeObjectURL(a.href);
        }
      } catch (e) { /* 用户取消分享，忽略 */ }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildDiaryExport: buildDiaryExport };

  // ===== ?diary=1 导出模式 =====
  if (typeof document !== 'undefined' && typeof location !== 'undefined') {
    var params = new URLSearchParams(location.search);
    if (params.get('diary')) {
      var target = fmtDate(new Date());
      var q = params.get('date');
      if (q) {
        if (q === '昨天' || q === '-1') {
          var d1 = new Date(); d1.setDate(d1.getDate() - 1); target = fmtDate(d1);
        } else if (/^-(\d+)$/.test(q)) {
          var d2 = new Date(); d2.setDate(d2.getDate() - parseInt(q.slice(1), 10)); target = fmtDate(d2);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
          target = q;
        }
      }
      var json = JSON.stringify(buildDiaryExport(target), null, 2);
      document.title = '日记数据 ' + target;
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;padding:12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;background:#fff;color:#111;';
      document.body.textContent = json;
    }
  }
})();
