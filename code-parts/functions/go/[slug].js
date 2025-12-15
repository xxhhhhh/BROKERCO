import LINKS from "../../sites-links.json" assert { type: "json" };

/** @param {import('@cloudflare/workers-types').PagesFunctionContext} context */
export async function onRequest(context) {
  const { request, env, params } = context;
  const reqUrl = new URL(request.url);
  const slug = String(params.slug || "").toLowerCase();

  let target = null;

  // 1) Берём из KV
  if (env?.LINKS_MAP && slug) {
    try { target = await env.LINKS_MAP.get(slug); } catch {}
  }
  // 2) Fallback на локальный JSON
  if (!target) target = LINKS[slug];
  if (!target) return new Response("Not found", { status: 404 });

  // 3) Пробрасываем только «безопасные» метки
  const allowed = /^(utm_|gclid$|yclid$|fbclid$|msclkid$|ref$)/i;
  const outUrl = new URL(target);
  for (const [k, v] of reqUrl.searchParams) {
    if (allowed.test(k) && !outUrl.searchParams.has(k)) outUrl.searchParams.set(k, v);
  }

  // 4) Лог клика (любой из вариантов)
  try {
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      slug, to: outUrl.toString(),
      country: request.cf?.country, asn: request.cf?.asn, colo: request.cf?.colo,
      ua: request.headers.get('user-agent')
    }));
    // или: await env.CLICKS.writeDataPoint({...})
  } catch {}

  // 5) Редирект
  return new Response(null, {
    status: 302, // для партнёрок это ок
    headers: {
      Location: outUrl.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow",
      Pragma: "no-cache"
    }
  });
}
