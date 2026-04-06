const body = $response.body;
if (!body || body.length === 0) {
  $done({});
  return;
}

if (body.includes('<head>')) {
  const script = `<script>
(function() {
  const tweetDataStore = new Map();
  
  // 样式
  const style = document.createElement('style');
  style.textContent = '.xvm-badge{display:inline-flex;align-items:center;font-size:13px;margin-right:4px;color:#4caf50}.xvm-badge.trending{color:#ff9800}.xvm-badge.viral{color:#f44336}';
  if (document.head) document.head.appendChild(style);
  
  // 数据提取
  function extract(result) {
    try {
      const tweet = result.tweet || result;
      const legacy = tweet.legacy;
      if (!legacy) return null;
      if (legacy.retweeted_status_result?.result) return extract(legacy.retweeted_status_result.result);
      const views = parseInt(tweet.views?.count, 10);
      if (!views || tweet.views?.state !== 'EnabledWithCount') return null;
      if (legacy.promotedMetadata) return null;
      return {
        id: legacy.id_str,
        views,
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        createdAt: legacy.created_at,
      };
    } catch(e) { return null; }
  }
  
  // 扫描 JSON
  function scan(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;
    if (obj.tweet_results?.result) {
      const d = extract(obj.tweet_results.result);
      if (d) {
        tweetDataStore.set(d.id, d);
        render();
      }
    }
    for (const key of Object.keys(obj)) {
      if (key !== 'tweet_results' && obj[key] && typeof obj[key] === 'object') {
        scan(obj[key], depth + 1);
      }
    }
  }
  
  // 拦截 fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && /\\/i\\/api\\/graphql\\//.test(url)) {
      res.clone().json().then(scan).catch(() => {});
    }
    return res;
  };
  
  // 渲染徽章
  function render() {
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (article.hasAttribute('data-xvm-scored')) continue;
      const link = article.querySelector('a[href*="/status/"]');
      if (!link) continue;
      const m = link.getAttribute('href').match(/\\/status\\/(\\d+)/);
      if (!m) continue;
      const id = m[1];
      const data = tweetDataStore.get(id);
      if (!data) continue;
      
      article.setAttribute('data-xvm-scored', '1');
      
      const hours = Math.max((Date.now() - new Date(data.createdAt).getTime()) / 3600000, 0.1);
      const velocity = data.views / hours;
      
      let cls = 'xvm-badge';
      let icon = '🌱';
      if (velocity >= 10000) {
        cls = 'xvm-badge viral';
        icon = '🔥';
      } else if (velocity >= 1000) {
        cls = 'xvm-badge trending';
        icon = '🚀';
      }
      
      const fmt = velocity >= 1000 ? (velocity / 1000).toFixed(1) + 'k' : Math.round(velocity);
      const badge = document.createElement('span');
      badge.className = cls;
      badge.textContent = icon + ' ' + fmt + '/h';
      
      const caret = article.querySelector('[data-testid="caret"]');
      if (caret && caret.parentElement) {
        caret.parentElement.insertBefore(badge, caret);
      }
    }
  }
  
  // 定期渲染
  setInterval(render, 2000);
  
  // 监听 DOM
  if (document.body) {
    new MutationObserver(render).observe(document.body, { childList: true, subtree: true });
  }
})();
</script>`;

  const injected = body.replace('<head>', '<head>' + script);
  $done({ body: injected });
} else {
  $done({});
}
