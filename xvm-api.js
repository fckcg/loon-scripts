/**
 * X Viral Monitor — Loon Script
 * 移植自 https://github.com/Icy-Cat/x-viral-monitor
 *
 * 工作原理：
 *   拦截 X GraphQL API 的 HTTP 响应，从中提取推文指标（浏览量、点赞、
 *   转发、回复、收藏、发布时间），计算「流速」与「爆帖指数」，
 *   然后通过 Loon 通知 / BoxJs 面板展示结果。
 *
 * 注意：Loon 无法直接向 X 的 React SPA 注入 DOM，
 *       因此本脚本采用「通知推送」方式：
 *       当检测到高流速推文时，发送系统通知。
 *       配合 BoxJs 面板可实时查看数据。
 */

// ─── 配置 ───────────────────────────────────────────────────────────────────
const KEY_STORE   = 'xvm_store';      // $persistentStore key：推文缓存
const KEY_CONFIG  = 'xvm_config';     // $persistentStore key：阈值配置
const MAX_STORE   = 200;              // 最多缓存推文条数

const DEFAULT_CFG = {
  trending : 1000,   // 流速达到此值标记为 🚀 趋势
  viral    : 10000,  // 流速达到此值标记为 🔥 爆帖
  notify   : true,   // 是否发送系统通知
  lang     : 'auto', // 'auto' | 'en' | 'zh' | 'ja'
};

// ─── i18n ───────────────────────────────────────────────────────────────────
const I18N = {
  en: {
    views: 'Views', likes: 'Likes', retweets: 'Retweets',
    replies: 'Replies', bookmarks: 'Bookmarks',
    velocity: 'Velocity', viralScore: 'Viral Score', posted: 'Posted',
    trending_alert: '🚀 Trending Tweet',
    viral_alert: '🔥 Viral Tweet',
  },
  zh: {
    views: '浏览量', likes: '点赞', retweets: '转发',
    replies: '回复', bookmarks: '收藏',
    velocity: '流速', viralScore: '爆帖指数', posted: '发布时间',
    trending_alert: '🚀 趋势推文',
    viral_alert: '🔥 爆帖来了！',
  },
  ja: {
    views: '表示回数', likes: 'いいね', retweets: 'リポスト',
    replies: '返信', bookmarks: 'ブックマーク',
    velocity: '流速', viralScore: 'バズ指数', posted: '投稿日時',
    trending_alert: '🚀 トレンドツイート',
    viral_alert: '🔥 バズツイート',
  },
};

function getLang(cfg) {
  if (cfg.lang && cfg.lang !== 'auto') return cfg.lang;
  const sys = $environment?.language || 'en';
  const base = sys.split('-')[0];
  return I18N[base] ? base : 'en';
}

function t(key, cfg) {
  const lang = getLang(cfg);
  return (I18N[lang] || I18N.en)[key] || key;
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────
function formatVelocity(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'k';
  return Math.round(v).toString();
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function loadConfig() {
  try {
    const raw = $persistentStore.read(KEY_CONFIG);
    return Object.assign({}, DEFAULT_CFG, raw ? JSON.parse(raw) : {});
  } catch { return { ...DEFAULT_CFG }; }
}

function loadStore() {
  try {
    const raw = $persistentStore.read(KEY_STORE);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveStore(store) {
  // 超出上限时，删除最旧的条目
  const entries = Object.entries(store);
  if (entries.length > MAX_STORE) {
    entries.sort((a, b) => new Date(a[1].createdAt) - new Date(b[1].createdAt));
    const trimmed = Object.fromEntries(entries.slice(entries.length - MAX_STORE));
    $persistentStore.write(JSON.stringify(trimmed), KEY_STORE);
  } else {
    $persistentStore.write(JSON.stringify(store), KEY_STORE);
  }
}

// ─── 推文数据提取 ─────────────────────────────────────────────────────────────
function extractTweetData(result) {
  const tweet  = result.tweet || result;
  const legacy = tweet.legacy;
  if (!legacy) return null;

  // 转推：指向原推
  const rtResult = legacy.retweeted_status_result?.result;
  if (rtResult) return extractTweetData(rtResult);

  const viewCount = parseInt(tweet.views?.count, 10);
  if (!viewCount || tweet.views?.state !== 'EnabledWithCount') return null;

  // 过滤推广推文
  if (legacy.promotedMetadata || tweet.promotedMetadata) return null;

  return {
    id        : legacy.id_str,
    views     : viewCount,
    likes     : legacy.favorite_count  || 0,
    retweets  : legacy.retweet_count   || 0,
    replies   : legacy.reply_count     || 0,
    bookmarks : legacy.bookmark_count  || 0,
    createdAt : legacy.created_at,
    text      : (legacy.full_text || '').slice(0, 80),
  };
}

function scanForTweets(obj, found = []) {
  if (!obj || typeof obj !== 'object') return found;

  if (obj.tweet_results?.result) {
    const data = extractTweetData(obj.tweet_results.result);
    if (data) found.push(data);
  }

  const keys = Object.keys(obj);
  for (const key of keys) {
    if (key === 'tweet_results') continue;
    const val = obj[key];
    if (val && typeof val === 'object') scanForTweets(val, found);
  }
  return found;
}

// ─── 评分 ────────────────────────────────────────────────────────────────────
function computeScore(data) {
  const now     = Date.now();
  const created = new Date(data.createdAt).getTime();
  const hours   = Math.max((now - created) / 3_600_000, 0.1);
  const velocity = data.views / hours;

  const velocityScore   = Math.min(velocity / 50_000, 1) * 40;
  const engagements     = data.likes + data.retweets + data.replies;
  const engagementRate  = data.views > 0 ? engagements / data.views : 0;
  const engagementScore = Math.min(engagementRate / 0.1, 1) * 25;
  const rtRatio         = data.likes > 0 ? data.retweets / data.likes : 0;
  const rtScore         = Math.min(rtRatio / 0.5, 1) * 20;
  const bmRatio         = data.likes > 0 ? data.bookmarks / data.likes : 0;
  const bmScore         = Math.min(bmRatio / 0.3, 1) * 15;

  return {
    velocity,
    score: Math.min(Math.round(velocityScore + engagementScore + rtScore + bmScore), 100),
  };
}

// ─── 通知 ────────────────────────────────────────────────────────────────────
function buildNotification(data, velocity, score, cfg) {
  const isViral   = velocity >= cfg.viral;
  const title     = isViral ? t('viral_alert', cfg) : t('trending_alert', cfg);
  const subtitle  = `${t('velocity', cfg)}: ${formatVelocity(velocity)}/h  |  ${t('viralScore', cfg)}: ${score}/100`;
  const body      = `${data.text}\n` +
    `👁 ${data.views.toLocaleString()}  ` +
    `❤️ ${data.likes.toLocaleString()}  ` +
    `🔁 ${data.retweets.toLocaleString()}  ` +
    `💬 ${data.replies.toLocaleString()}\n` +
    `🕐 ${formatDate(data.createdAt)}\n` +
    `🔗 https://x.com/i/web/status/${data.id}`;
  return { title, subtitle, body };
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
(function main() {
  const cfg = loadConfig();

  // 解析响应体
  let json;
  try {
    json = JSON.parse($response.body);
  } catch {
    $done({});
    return;
  }

  const tweets = scanForTweets(json);
  if (tweets.length === 0) {
    $done({});
    return;
  }

  const store = loadStore();
  let storeUpdated = false;

  for (const data of tweets) {
    const existing = store[data.id];
    // 若数据没变就跳过
    if (existing && existing.views === data.views) continue;

    store[data.id] = data;
    storeUpdated = true;

    const { velocity, score } = computeScore(data);
    const isTrending = velocity >= cfg.trending;
    const isViral    = velocity >= cfg.viral;

    // 只对趋势/爆帖推文发送通知
    if (cfg.notify && isTrending) {
      const notif = buildNotification(data, velocity, score, cfg);
      $notification.post(notif.title, notif.subtitle, notif.body);
    }
  }

  if (storeUpdated) saveStore(store);

  // 不修改响应，直接放行
  $done({});
})();
