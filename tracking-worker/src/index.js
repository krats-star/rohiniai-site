import { AFFILIATE_LINKS, ASTRO_GPT_URL } from "./links.js";

const ONE_DAY_SECONDS = 86400;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (path === "/admin") {
      return handleAdmin(request, env);
    }

    if (path === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (path === "/ask") {
      const event = await buildClickEvent(request, env, {
        slug: "ask",
        clickType: "gpt_open",
        destinationLabel: "Astro GPT"
      });
      ctx.waitUntil(saveClick(env, event));
      return redirect(ASTRO_GPT_URL);
    }

    const affiliateSlug = getAffiliateSlug(path);
    if (affiliateSlug && AFFILIATE_LINKS[affiliateSlug]) {
      const link = AFFILIATE_LINKS[affiliateSlug];
      const event = await buildClickEvent(request, env, {
        slug: affiliateSlug,
        clickType: "affiliate_click",
        destinationLabel: link.label
      });
      ctx.waitUntil(saveClick(env, event));
      return redirect(link.url);
    }

    return new Response("Tracked link not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};

function normalizePath(pathname) {
  const path = pathname.replace(/\/+$/, "");
  return path || "/";
}

function getAffiliateSlug(path) {
  if (path.startsWith("/go/")) return path.slice(4).split("/")[0];
  const slug = path.slice(1).split("/")[0];
  if (slug && slug !== "admin" && slug !== "ask" && slug !== "health") return slug;
  return null;
}

function redirect(destination) {
  return new Response(null, {
    status: 302,
    headers: {
      location: destination,
      "cache-control": "no-store, max-age=0"
    }
  });
}

async function buildClickEvent(request, env, details) {
  const cf = request.cf || {};
  const userAgent = request.headers.get("user-agent") || "";
  const ip = request.headers.get("cf-connecting-ip") || "";
  const visitorHash = await hashVisitor(ip, userAgent, env.VISITOR_SALT || env.ADMIN_PASSWORD || "change-me");

  return {
    slug: details.slug,
    clickType: details.clickType,
    destinationLabel: details.destinationLabel,
    country: cf.country || null,
    region: cf.region || null,
    city: cf.city || null,
    device: detectDevice(userAgent),
    visitorHash,
    referrerHost: getReferrerHost(request.headers.get("referer"))
  };
}

async function saveClick(env, event) {
  if (!env.DB) return;

  await env.DB.prepare(
    `INSERT INTO click_events (
      slug, click_type, destination_label, country, region, city, device, visitor_hash, referrer_host
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      event.slug,
      event.clickType,
      event.destinationLabel,
      event.country,
      event.region,
      event.city,
      event.device,
      event.visitorHash,
      event.referrerHost
    )
    .run();
}

async function handleAdmin(request, env) {
  if (!isAuthorized(request, env)) {
    return new Response("Login required", {
      status: 401,
      headers: {
        "www-authenticate": 'Basic realm="RohiniAI tracking"',
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }

  const days = Number(new URL(request.url).searchParams.get("days") || "30");
  const lookbackDays = Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 30;
  const since = new Date(Date.now() - lookbackDays * ONE_DAY_SECONDS * 1000).toISOString();

  const [summary, topLinks, indiaStates, countries, devices, daily] = await Promise.all([
    queryFirst(env, summarySql(), since),
    queryAll(env, topLinksSql(), since),
    queryAll(env, indiaStatesSql(), since),
    queryAll(env, countriesSql(), since),
    queryAll(env, devicesSql(), since),
    queryAll(env, dailySql(), since)
  ]);

  const gptOpens = summary?.gpt_opens || 0;
  const affiliateClicks = summary?.affiliate_clicks || 0;
  const affiliateRate = gptOpens ? `${((affiliateClicks / gptOpens) * 100).toFixed(1)}%` : "0%";

  return new Response(renderAdmin({
    lookbackDays,
    gptOpens,
    uniqueGptOpens: summary?.unique_gpt_opens || 0,
    affiliateClicks,
    affiliateRate,
    topLinks,
    indiaStates,
    countries,
    devices,
    daily
  }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0"
    }
  });
}

function isAuthorized(request, env) {
  if (!env.ADMIN_PASSWORD) return false;

  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return false;

  const decoded = atob(auth.slice(6));
  const separator = decoded.indexOf(":");
  const password = separator >= 0 ? decoded.slice(separator + 1) : decoded;
  return password === env.ADMIN_PASSWORD;
}

function summarySql() {
  return `SELECT
    SUM(CASE WHEN click_type = 'gpt_open' THEN 1 ELSE 0 END) AS gpt_opens,
    COUNT(DISTINCT CASE WHEN click_type = 'gpt_open' THEN visitor_hash END) AS unique_gpt_opens,
    SUM(CASE WHEN click_type = 'affiliate_click' THEN 1 ELSE 0 END) AS affiliate_clicks
    FROM click_events
    WHERE created_at >= ?`;
}

function topLinksSql() {
  return `SELECT destination_label, slug, COUNT(*) AS clicks
    FROM click_events
    WHERE created_at >= ? AND click_type = 'affiliate_click'
    GROUP BY destination_label, slug
    ORDER BY clicks DESC
    LIMIT 10`;
}

function indiaStatesSql() {
  return `SELECT COALESCE(region, 'Unknown') AS region, COUNT(*) AS clicks
    FROM click_events
    WHERE created_at >= ? AND country = 'IN'
    GROUP BY region
    ORDER BY clicks DESC
    LIMIT 15`;
}

function countriesSql() {
  return `SELECT COALESCE(country, 'Unknown') AS country, COUNT(*) AS clicks
    FROM click_events
    WHERE created_at >= ?
    GROUP BY country
    ORDER BY clicks DESC
    LIMIT 15`;
}

function devicesSql() {
  return `SELECT COALESCE(device, 'unknown') AS device, COUNT(*) AS clicks
    FROM click_events
    WHERE created_at >= ?
    GROUP BY device
    ORDER BY clicks DESC`;
}

function dailySql() {
  return `SELECT substr(created_at, 1, 10) AS date,
    SUM(CASE WHEN click_type = 'gpt_open' THEN 1 ELSE 0 END) AS gpt_opens,
    SUM(CASE WHEN click_type = 'affiliate_click' THEN 1 ELSE 0 END) AS affiliate_clicks
    FROM click_events
    WHERE created_at >= ?
    GROUP BY date
    ORDER BY date DESC
    LIMIT 30`;
}

async function queryFirst(env, sql, since) {
  if (!env.DB) return null;
  return env.DB.prepare(sql).bind(since).first();
}

async function queryAll(env, sql, since) {
  if (!env.DB) return [];
  const result = await env.DB.prepare(sql).bind(since).all();
  return result.results || [];
}

function renderAdmin(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RohiniAI Click Tracking</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; }
    body { margin: 0; background: #f7f7f4; color: #1c1b18; }
    main { max-width: 1080px; margin: 0 auto; padding: 28px 18px 48px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    h2 { margin: 28px 0 10px; font-size: 18px; }
    .muted { color: #666157; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 18px; }
    .card { background: #fff; border: 1px solid #dedbd2; border-radius: 8px; padding: 16px; }
    .label { color: #686256; font-size: 13px; }
    .value { font-size: 28px; font-weight: 700; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dedbd2; border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #eeeae2; text-align: left; font-size: 14px; }
    th { background: #fbfaf7; color: #514b42; }
    tr:last-child td { border-bottom: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
    a { color: #8a3b0f; }
  </style>
</head>
<body>
  <main>
    <h1>RohiniAI Click Tracking</h1>
    <div class="muted">Last ${escapeHtml(String(data.lookbackDays))} days. Change with <code>?days=7</code>, <code>?days=30</code>, or <code>?days=90</code>.</div>

    <section class="cards">
      ${metricCard("GPT opens", data.gptOpens)}
      ${metricCard("Unique GPT opens", data.uniqueGptOpens)}
      ${metricCard("Affiliate clicks", data.affiliateClicks)}
      ${metricCard("Affiliate click rate", data.affiliateRate)}
    </section>

    <div class="grid">
      ${tableSection("Top affiliate links", ["Offer", "Clicks"], data.topLinks.map(row => [row.destination_label || row.slug, row.clicks]))}
      ${tableSection("India states", ["State", "Clicks"], data.indiaStates.map(row => [row.region, row.clicks]))}
      ${tableSection("Countries", ["Country", "Clicks"], data.countries.map(row => [row.country, row.clicks]))}
      ${tableSection("Devices", ["Device", "Clicks"], data.devices.map(row => [row.device, row.clicks]))}
    </div>

    ${tableSection("Daily trend", ["Date", "GPT opens", "Affiliate clicks"], data.daily.map(row => [row.date, row.gpt_opens || 0, row.affiliate_clicks || 0]))}
  </main>
</body>
</html>`;
}

function metricCard(label, value) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value))}</div></div>`;
}

function tableSection(title, headers, rows) {
  const bodyRows = rows.length
    ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="muted">No data yet</td></tr>`;

  return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody></table></section>`;
}

function detectDevice(userAgent) {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android/.test(ua)) return "mobile";
  if (!ua) return "unknown";
  return "desktop";
}

function getReferrerHost(referrer) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname;
  } catch {
    return null;
  }
}

async function hashVisitor(ip, userAgent, salt) {
  const input = `${salt}:${ip}:${userAgent}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
