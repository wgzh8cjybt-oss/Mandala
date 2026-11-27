// Финансовая аналитика. Считает фактические Stars по данным платежей; денежный эквивалент — отдельно и ориентировочно.
// Оборот ≠ прибыль: комиссии и условия вывода определяет Telegram, здесь они не вычисляются.
import { all, one } from './db.js';
import { CATEGORIES } from './catalog.js';
import { dayKey, jsonParse, monthKey, weekKey } from './util.js';

const DAY = 86400e3;
const catTitle = Object.fromEntries(CATEGORIES.map(c => [c.id, c.title]));

function bucketSeries(rows, keyFn, keys) {
  const m = new Map(keys.map(k => [k, { key: k, gross: 0, refunded: 0, net: 0, count: 0 }]));
  for (const p of rows) {
    const k = keyFn(p.created_at);
    if (m.has(k)) { const b = m.get(k); b.gross += p.amount; b.count += 1; }
    if (p.status === 'refunded' && p.refunded_at) { const k2 = keyFn(p.refunded_at); if (m.has(k2)) m.get(k2).refunded += p.amount; }
  }
  for (const b of m.values()) b.net = b.gross - b.refunded;
  return [...m.values()];
}

export function financialStats(ctx) {
  const tz = ctx.cfg.statsTz, now = ctx.now();
  const pays = all(ctx.db, `SELECT p.id, p.amount, p.status, p.created_at, p.refunded_at, p.resolved_at, o.product_id, o.product_snapshot
    FROM payments p LEFT JOIN orders o ON o.id = p.order_id`);
  const sales = pays.filter(p => p.status === 'succeeded' || p.status === 'refund_pending');
  const refunded = pays.filter(p => p.status === 'refunded');
  const anomalies = pays.filter(p => p.status === 'anomaly' && !p.resolved_at);
  const sum = a => a.reduce((s, p) => s + p.amount, 0);
  const gross = sum(pays), refundedStars = sum(refunded), net = gross - refundedStars;

  // периоды (по дате платежа; возвраты вычитаются в день возврата)
  const today = dayKey(now, tz), thisMonth = monthKey(now, tz);
  const dayKeys = n => Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * DAY, tz));
  const d7 = new Set(dayKeys(7)), d30 = new Set(dayKeys(30));
  const period = pred => {
    let g = 0, r = 0, c = 0;
    for (const p of pays) { if (pred(p.created_at)) { g += p.amount; c++; } if (p.status === 'refunded' && p.refunded_at && pred(p.refunded_at)) r += p.amount; }
    return { gross: g, refunded: r, net: g - r, count: c };
  };
  const periods = {
    today: period(ts => dayKey(ts, tz) === today),
    d7: period(ts => d7.has(dayKey(ts, tz))),
    d30: period(ts => d30.has(dayKey(ts, tz))),
    month: period(ts => monthKey(ts, tz) === thisMonth)
  };

  // по категориям и товарам (только действующие продажи)
  const byCat = new Map(), byProd = new Map();
  for (const p of sales) {
    const snap = jsonParse(p.product_snapshot, {});
    const cat = snap.category || 'unknown', pid = p.product_id || 'unknown';
    const c = byCat.get(cat) || { category: cat, title: catTitle[cat] || cat, count: 0, stars: 0 }; c.count++; c.stars += p.amount; byCat.set(cat, c);
    const q = byProd.get(pid) || { product_id: pid, title: snap.title || pid, count: 0, stars: 0 }; q.count++; q.stars += p.amount; byProd.set(pid, q);
  }

  // ряды: 30 дней, 12 недель, 12 месяцев
  const weekKeys = []; for (let i = 11; i >= 0; i--) { const k = weekKey(now - i * 7 * DAY, tz); if (!weekKeys.includes(k)) weekKeys.push(k); }
  const monthKeys = []; { const d = new Date(now); for (let i = 11; i >= 0; i--) { const k = monthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 15), tz); if (!monthKeys.includes(k)) monthKeys.push(k); } }

  const usersTotal = one(ctx.db, 'SELECT COUNT(*) AS n FROM users').n;
  const buyers = one(ctx.db, "SELECT COUNT(DISTINCT tg_id) AS n FROM payments WHERE status IN ('succeeded','refund_pending')").n;
  const rate = ctx.cfg.starUsdEstimate;
  return {
    generated_at: now, tz, currency: 'XTR',
    totals: {
      sales_count: sales.length, gross_stars: gross, refunds_count: refunded.length, refunded_stars: refundedStars, net_stars: net,
      avg_ticket: sales.length ? Math.round((sum(sales) / sales.length) * 100) / 100 : 0,
      anomalies_count: anomalies.length, anomalies_stars: sum(anomalies), users_total: usersTotal, buyers_total: buyers
    },
    periods,
    by_category: [...byCat.values()].sort((a, b) => b.stars - a.stars),
    top_products: [...byProd.values()].sort((a, b) => b.count - a.count || b.stars - a.stars).slice(0, 10),
    series: {
      day: bucketSeries(pays, ts => dayKey(ts, tz), dayKeys(30)),
      week: bucketSeries(pays, ts => weekKey(ts, tz), weekKeys),
      month: bucketSeries(pays, ts => monthKey(ts, tz), monthKeys)
    },
    estimate: {
      rate_usd_per_star: rate, net_usd: Math.round(net * rate * 100) / 100,
      note: 'Ориентировочный денежный эквивалент по курсу из настройки STAR_USD_ESTIMATE. Это не прибыль и не гарантия выплаты: условия вывода, комиссии и курс определяет Telegram.'
    }
  };
}
