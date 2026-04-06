const body = $response.body;
if (!body || !body.includes('<head>')) {
  $done({});
  return;
}

// NOTE: This string is a JS template literal.  Every backslash that must
// survive into the injected <script> must be doubled here (\\d → \d, etc.).
// Regex literals with \/ or \d are avoided entirely to prevent silent
// mangling; URL matching uses String#includes() and tweet-ID extraction
// uses plain string operations.
const script = `<script>(function(){
  // ─── 样式 ──────────────────────────────────────────────────────────────
  // Class names use regular hyphens (-), NOT en-dashes (–), so they are
  // valid CSS identifiers.
  var style = document.createElement('style');
  style.textContent =
    '.xvm-badge{display:inline-flex;align-items:center;font-size:13px;' +
      'font-family:-apple-system,sans-serif;margin-right:4px;cursor:default;' +
      'line-height:20px;white-space:nowrap}' +
    '.xvm-badge-green{color:#4caf50}' +
    '.xvm-badge-orange{color:#ff9800}' +
    '.xvm-badge-red{color:#f44336}' +
    '.xvm-badge-green:hover{color:#66bb6a}' +
    '.xvm-badge-orange:hover{color:#ffa726}' +
    '.xvm-badge-red:hover{color:#ef5350}' +
    '.xvm-tooltip{display:none;position:fixed;z-index:2147483647;' +
      'background:rgb(15,20,26);color:rgb(231,233,234);font-size:12px;' +
      'padding:10px 12px;border-radius:8px;white-space:pre-line;line-height:1.6;' +
      'border:1px solid rgb(47,51,54);box-shadow:0 4px 6px rgba(0,0,0,0.4);' +
      'pointer-events:none}';
  (document.head || document.documentElement).appendChild(style);

  // ─── 配置 ──────────────────────────────────────────────────────────────
  var THRESHOLDS = { trending: 1000, viral: 10000 };
  var store = new Map();
  var processed = new Set();

  // ─── i18n ──────────────────────────────────────────────────────────────
  var I18N = {
    en: { views: 'Views', likes: 'Likes', retweets: 'Retweets',
          replies: 'Replies', bookmarks: 'Bookmarks', velocity: 'Velocity',
          viralScore: 'Viral Score', posted: 'Posted' },
    zh: { views: '浏览量', likes: '点赞', retweets: '转发',
          replies: '回复', bookmarks: '收藏', velocity: '流速',
          viralScore: '爆帖指数', posted: '发布时间' },
    ja: { views: '表示回数', likes: 'いいね', retweets: 'リポスト',
          replies: '返信', bookmarks: 'ブックマーク', velocity: '流速',
          viralScore: 'バズ指数', posted: '投稿時刻' }
  };
  var T = I18N[(navigator.language || 'en').split('-')[0]] || I18N.en;

  // ─── 拦截 fetch ────────────────────────────────────────────────────────
  // Use String#includes() instead of a regex literal so that backslash
  // escaping inside the outer template literal cannot corrupt the pattern.
  var _fetch = window.fetch;
  window.fetch = async function() {
    var res = await _fetch.apply(this, arguments);
    try {
      var url = typeof arguments[0] === 'string'
        ? arguments[0]
        : (arguments[0] && arguments[0].url) || '';
      if (url.includes('/i/api/graphql/'))
        res.clone().json().then(scan).catch(function() {});
    } catch (e) {}
    return res;
  };

  // ─── 拦截 XHR ──────────────────────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url) {
    if (typeof url === 'string' && url.includes('/i/api/graphql/')) {
      this.addEventListener('load', function() {
        try { scan(JSON.parse(this.responseText)); } catch (e) {}
      });
    }
    return _open.apply(this, arguments);
  };

  // ─── 数据提取 ──────────────────────────────────────────────────────────
  function scan(obj, depth) {
    depth = depth || 0;
    if (!obj || typeof obj !== 'object' || depth > 25) return;
    if (obj.tweet_results && obj.tweet_results.result) {
      var d = extract(obj.tweet_results.result);
      if (d) { store.set(d.id, d); scheduleRender(); }
    }
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k !== 'tweet_results' && obj[k] && typeof obj[k] === 'object')
        scan(obj[k], depth + 1);
    }
  }

  function extract(r) {
    try {
      var t = r.tweet || r;
      var l = t.legacy;
      if (!l) return null;
      if (l.retweeted_status_result && l.retweeted_status_result.result)
        return extract(l.retweeted_status_result.result);
      var v = parseInt(t.views && t.views.count, 10);
      if (!v || !t.views || t.views.state !== 'EnabledWithCount') return null;
      if (l.promotedMetadata || t.promotedMetadata) return null;
      return {
        id: l.id_str, views: v,
        likes: l.favorite_count || 0, retweets: l.retweet_count || 0,
        replies: l.reply_count || 0, bookmarks: l.bookmark_count || 0,
        createdAt: l.created_at
      };
    } catch (e) { return null; }
  }

  // ─── 评分 ──────────────────────────────────────────────────────────────
  function computeScore(data) {
    var hours = Math.max(
      (Date.now() - new Date(data.createdAt).getTime()) / 3600000, 0.1);
    var vel = data.views / hours;
    var s = Math.min(vel / 50000, 1) * 40
      + Math.min(((data.likes + data.retweets + data.replies)
          / Math.max(data.views, 1)) / 0.1, 1) * 25
      + Math.min((data.retweets / Math.max(data.likes, 1)) / 0.5, 1) * 20
      + Math.min((data.bookmarks / Math.max(data.likes, 1)) / 0.3, 1) * 15;
    return { vel: vel, s: Math.min(Math.round(s), 100) };
  }

  function fmt(v) {
    return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
         : v >= 1000 ? (v / 1000).toFixed(1) + 'k'
         : Math.round(v) + '';
  }

  // ─── Tooltip ────────────────────────────────────────────────────────────
  var tip = null;
  function showTip(badge, content) {
    if (!document.body) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'xvm-tooltip';
      document.body.appendChild(tip);
    }
    tip.textContent = content;
    var r = badge.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.top = (r.bottom + 6) + 'px';
    tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 230)) + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  // ─── 渲染调度 ────────────────────────────────────────────────────────────
  var pending = false;
  function scheduleRender() {
    if (!pending) {
      pending = true;
      requestAnimationFrame(function() { pending = false; render(); });
    }
  }

  // ─── Tweet ID 提取（无正则，避免模板字面量转义问题）───────────────────
  function getStatusId(href) {
    var idx = href.indexOf('/status/');
    if (idx < 0) return null;
    var after = href.slice(idx + 8); // skip "/status/"
    var end = after.length;
    for (var i = 0; i < after.length; i++) {
      var c = after.charCodeAt(i);
      if (c < 48 || c > 57) { end = i; break; } // not 0-9
    }
    return end > 0 ? after.slice(0, end) : null;
  }

  function getId(article) {
    var links = article.querySelectorAll('a[href*="/status/"]');
    for (var i = 0; i < links.length; i++) {
      var id = getStatusId(links[i].getAttribute('href'));
      if (id && store.has(id)) return id;
    }
    var a = article.querySelector('a[href*="/status/"]');
    return a ? getStatusId(a.getAttribute('href')) : null;
  }

  // ─── 渲染徽章 ──────────────────────────────────────────────────────────
  function render() {
    if (!document.body) return;
    var arts = document.querySelectorAll(
      'article[data-testid="tweet"]:not([data-xvm-scored])');
    for (var i = 0; i < arts.length; i++) {
      var article = arts[i];
      var id = getId(article);
      if (!id) continue;
      var data = store.get(id);
      if (!data) continue;

      article.setAttribute('data-xvm-scored', '1');
      processed.add(id);

      var sc = computeScore(data);
      var vel = sc.vel, score = sc.s;
      var isViral = vel >= THRESHOLDS.viral;
      var isTrend = vel >= THRESHOLDS.trending;

      var badge = document.createElement('span');
      badge.className = 'xvm-badge ' +
        (isViral ? 'xvm-badge-red' : isTrend ? 'xvm-badge-orange' : 'xvm-badge-green');
      badge.textContent =
        (isViral ? '🔥' : isTrend ? '🚀' : '🌱') + ' ' + fmt(vel) + '/h';

      var d = new Date(data.createdAt);
      var pad = function(n) { return String(n).padStart(2, '0'); };
      var content =
        T.views     + ': ' + data.views.toLocaleString()    + '\\n' +
        T.likes     + ': ' + data.likes.toLocaleString()    + '\\n' +
        T.retweets  + ': ' + data.retweets.toLocaleString() + '\\n' +
        T.replies   + ': ' + data.replies.toLocaleString()  + '\\n' +
        T.bookmarks + ': ' + data.bookmarks.toLocaleString()+ '\\n' +
        T.velocity  + ': ' + fmt(vel) + '/h'                + '\\n' +
        T.viralScore + ': ' + score + '/100'                + '\\n' +
        T.posted    + ': ' + d.getFullYear() + '-' +
          pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
          pad(d.getHours()) + ':' + pad(d.getMinutes());

      (function(b, c) {
        b.addEventListener('mouseenter', function() { showTip(b, c); });
        b.addEventListener('mouseleave', hideTip);
      })(badge, content);

      insertBadge(article, badge);
    }
  }

  function insertBadge(article, badge) {
    var targets = [
      article.querySelector('[data-testid="caret"]'),
      article.querySelector('[role="group"]'),
      article.querySelector('a[href*="/status/"]')
    ];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t && t.parentElement && article.contains(t)) {
        t.parentElement.insertBefore(badge, t);
        return;
      }
    }
    article.insertBefore(badge, article.firstChild);
  }

  // ─── MutationObserver ──────────────────────────────────────────────────
  // Only start once document.body actually exists (script runs in <head>).
  function startObserver() {
    new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.nodeType === 1 && (
            (node.matches && node.matches('article[data-testid="tweet"]')) ||
            (node.querySelector && node.querySelector('article[data-testid="tweet"]'))
          )) { scheduleRender(); return; }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver);
  }

  // 兜底定时扫描（SPA 导航后推文已存在但 Observer 未触发时）
  setInterval(function() {
    if (document.body && store.size > 0) scheduleRender();
  }, 3000);
})();</script>`;

const injected = body.replace('<head>', '<head>' + script);
$done({ body: injected });
