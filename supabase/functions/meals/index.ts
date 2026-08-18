// 饭搭子开放接口跨域代理（部署到 Supabase Edge Functions，函数名：meals）
// 背景：fandazi.coze.site 不返回 CORS 头，浏览器（github.io 页面）直接请求被拦。
// 用法：GET /functions/v1/meals?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=100&key=fdz_xxx
// 注意：部署后在函数 Details 里把「Verify JWT」关掉，否则要带 Authorization 头。

Deno.serve(async (req: Request) => {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  const u = new URL(req.url);
  const key = (u.searchParams.get('key') || '').trim();
  if (!key) {
    return new Response(JSON.stringify({ success: false, error: '缺少 key 参数' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  const qs = new URLSearchParams();
  for (const p of ['from', 'to', 'limit']) {
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
});
