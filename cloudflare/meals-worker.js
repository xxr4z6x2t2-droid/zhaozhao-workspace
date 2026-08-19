// Cloudflare Workers 代理 — 饭搭子饮食接口 CORS 中转
// 部署：dash.cloudflare.com → Workers & Pages → Create Worker → 取名 meals → Deploy → Edit code → 粘贴此代码 → Deploy
// 地址形如：https://meals.你的名字.workers.dev

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: cors });
    }
    const u = new URL(request.url);
    const key = u.searchParams.get('key') || '';
    if (!key) {
      return new Response(JSON.stringify({ success: false, error: '缺少 key 参数' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const qs = new URLSearchParams();
    for (const p of ['from', 'to', 'limit', 'date']) {
      const v = u.searchParams.get(p);
      if (v) qs.set(p, v);
    }
    try {
      const r = await fetch('https://fandazi.coze.site/api/open/meals?' + qs.toString(), {
        headers: { 'x-api-key': key },
      });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: '上游请求失败: ' + String(e) }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
