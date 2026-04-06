const body = $response.body;
if (!body || !body.includes('<head>')) {
  $done({});
  return;
}

const script = `<script> (function () {
  // 创建调试信息面板
  window.__xvmDebug = {
    dataCount: 0,
    renderCount: 0,
    errors: [],
    apiCalls: [],
    domChecks: []
  };

  const debug = window.__xvmDebug;
  function log(msg) {
    console.log('[XVM] ' + msg);
    debug.errors.push(msg);
  }

  log('脚本已启动');

  // ─── 样式 ───────────────────────────────────────────────────────────
  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = \`
    .xvm-badge{display:inline-flex;align-items:center;font-size:13px;font-family:-apple-system,sans-serif;margin-right:4px;cursor:default;line-height:20px;white-space:nowrap;}
    .xvm-badge–green{color:#4caf50}.xvm-badge–orange{color:#ff9800}.xvm-badge–red{color:#f44336}
    .xvm-badge–green:hover{color:#66bb6a}.xvm-badge–orange:hover{color:#ffa726}.xvm-badge–red:hover{color:#ef5350}
    .xvm-tooltip{display:none;position:fixed;z-index:2147483647;background:rgb(15,20,26);color:rgb(231,233,234);font-size:12px;padding:10px 12px;border-radius:8px;white-space:pre-line;line-height:1.6;border:1px solid rgb(47,51,54);}
    .xvm-debug{position:fixed;bottom:10px;right:10px;background:rgba(0,0,0,0.9);color:#0f0;font-family:monospace;font-size:11px;padding:10px;z-index:9999;max-width:300px;max-height:200px;overflow-y:auto;border:1px solid #0f0;}
    \`;
    (document.head || document.documentElement).appendChild(s);
  }
  injectStyle();

  // 创建调试面板
  const debugPanel = document.createElement('div');
  debugPanel.className = 'xvm-debug';
  debugPanel.style.display = 'none';

  // ─── 配置 ────────────────────────────────────────────────────────────
  const thresholds = { trending: 1000, viral: 10000 };
  const tweetDataStore = new Map();
  const processedTweets = new Set();

  // ─── i18n ─────────────────────────────────────────────────────────────
  const I18N = {
    en:{views:'Views',likes:'Likes',retweets:'Retweets',replies:'Replies',bookmarks:'Bookmarks',velocity:'Velocity',viralScore:'Viral Score',posted:'Posted'},
    zh:{views:'浏览量',likes:'点赞',retweets:'转发',replies:'回复',bookmarks:'收藏',velocity:'流速',viralScore:'爆帖指数',posted:'发布时间'},
    ja:{views:'表示回数',likes:'いいね',retweets:'リポスト',replies:'返信',bookmarks:'ブックマーク',velocity:'流速',viralScore:'バズ指数',posted:'投稿時刻'}
  };
  const strings = I18N[(navigator.language||'en').split('-')[0]] || I18N.en;

  // ─── 拦截 fetch ──────────────────────────────────────────────────────
  const GRAPHQL_RE = /\/i\/api\/graphql\//;
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _fetch.apply(this, args);
    try {
      const url = typeof args[0]==='string' ? args[0] : args[0]?.url||'';
      if (GRAPHQL_RE.test(url)) {
        debug.apiCalls.push(url);
        log('API call intercepted: ' + url);
        res.clone().json().then(data => {
          log('API data received, size: ' + JSON.stringify(data).length);
          scan(data);
        }).catch((e) => {
          log('API parse error: ' + e.message);
        });
      }
    } catch(e) {
      log('Fetch hook error: ' + e.message);
    }
    return res;
  };

  // ─── 拦截 XHR ────────────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url, ...r) {
    if (typeof url==='string' && GRAPHQL_RE.test(url)) {
      log('XHR GraphQL call: ' + url);
      this.addEventListener('load', function() {
        try {
          const data = JSON.parse(this.responseText);
          log('XHR data received');
          scan(data);
        } catch(e) {
          log('XHR parse error: ' + e.message);
        }
      });
    }
    return _open.call(this, m, url, ...r);
  };

  // ─── 数据提取 ──────────────────────────────────────────────────────────
  function scan(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 25) return;
    
    if (obj.tweet_results?.result) {
      log('Found tweet_results at depth ' + depth);
      const d = extract(obj.tweet_results.result);
      if (d) {
        tweetDataStore.set(d.id, d);
        debug.dataCount++;
        log('Extracted tweet: ' + d.id + ' views=' + d.views);
        render();
      }
    }

    for (const k of Object.keys(obj)) {
      if (k==='tweet_results') continue;
      if (obj[k] && typeof obj[k]==='object') scan(obj[k], depth + 1);
    }
  }

  function extract(result) {
    try {
      const tweet = result.tweet || result;
      const legacy = tweet.legacy;
      if (!legacy) {
        log('No legacy data found');
        return null;
      }
      if (legacy.retweeted_status_result?.result) return extract(legacy.retweeted_status_result.result);
      
      const views = parseInt(tweet.views?.count, 10);
      if (!views) {
        log('No view count');
        return null;
      }
      if (tweet.views?.state !== 'EnabledWithCount') {
        log('Views not enabled');
        return null;
      }
      if (legacy.promotedMetadata || tweet.promotedMetadata) {
        log('Promoted tweet, skipping');
        return null;
      }
      
      return {
        id: legacy.id_str,
        views,
        likes: legacy.favorite_count||0,
        retweets: legacy.retweet_count||0,
        replies: legacy.reply_count||0,
        bookmarks: legacy.bookmark_count||0,
        createdAt: legacy.created_at,
      };
    } catch(e) {
      log('Extract error: ' + e.message);
      return null;
    }
  }

  // ─── 评分 ─────────────────────────────────────────────────────────────
  function computeScore(data) {
    const hours = Math.max((Date.now()-new Date(data.createdAt).getTime())/3600000, 0.1);
    const velocity = data.views / hours;
    const s = Math.min(velocity/50000,1)*40
      + Math.min(((data.likes+data.retweets+data.replies)/Math.max(data.views,1))/0.1,1)*25
      + Math.min((data.retweets/Math.max(data.likes,1))/0.5,1)*20
      + Math.min((data.bookmarks/Math.max(data.likes,1))/0.3,1)*15;
    return { velocity, score: Math.min(Math.round(s),100) };
  }

  function fmt(v) {
    return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1000?(v/1000).toFixed(1)+'k':Math.round(v)+'';
  }

  // ─── Tooltip ──────────────────────────────────────────────────────────
  let tip = null;
  function getTip() {
    if (!tip) {
      tip=document.createElement('div');
      tip.className='xvm-tooltip';
      document.body.appendChild(tip);
    }
    return tip;
  }

  // ─── 渲染徽章 ─────────────────────────────────────────────────────────
  function render() {
    try {
      debug.renderCount++;
      
      const article = document.querySelector('article[data-testid="tweet"]');
      if (!article) {
        log('No article found');
        debug.domChecks.push('article[data-testid="tweet"]: not found');
        return;
      }
      debug.domChecks.push('article[data-testid="tweet"]: found ' + document.querySelectorAll('article[data-testid="tweet"]').length);

      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
        if (article.hasAttribute('data-xvm-scored')) continue;

        const id = getId(article);
        if (!id) continue;
        if (processedTweets.has(id)) continue;

        const data = tweetDataStore.get(id);
        if (!data) continue;

        processedTweets.add(id);
        article.setAttribute('data-xvm-scored','1');

        const {velocity, score} = computeScore(data);
        const isViral = velocity >= thresholds.viral;
        const isTrend = velocity >= thresholds.trending;

        const badge = document.createElement('span');
        badge.className = 'xvm-badge '+(isViral?'xvm-badge–red':isTrend?'xvm-badge–orange':'xvm-badge–green');
        badge.textContent = (isViral?'🔥':isTrend?'🚀':'🌱')+' '+fmt(velocity)+'/h';

        const d = new Date(data.createdAt);
        const pad = n => String(n).padStart(2,'0');
        const content = strings.views+': '+data.views.toLocaleString()+'\n'
          +strings.velocity+': '+fmt(velocity)+'/h\n'
          +strings.viralScore+': '+score+'/100';

        badge.addEventListener('mouseenter', () => {
          const t=getTip(); t.textContent=content;
          const r=badge.getBoundingClientRect();
          t.style.display='block'; t.style.top=(r.bottom+6)+'px';
          t.style.left=(r.left)+'px';
        });
        badge.addEventListener('mouseleave', () => { getTip().style.display='none'; });

        const caret = article.querySelector('[data-testid="caret"]');
        if (caret) {
          caret.parentElement.insertBefore(badge, caret);
          log('Badge inserted for tweet ' + id);
        }
      }
    } catch(e) {
      log('Render error: ' + e.message);
    }
  }

  function getId(article) {
    try {
      const a = article.querySelector('a[href*="/status/"]');
      if (!a) return null;
      const m = a.getAttribute('href').match(/\/status\/(\d+)/);
      return m ? m[1] : null;
    } catch(e) {
      return null;
    }
  }

  // 定期检查
  setInterval(() => {
    render();
    updateDebugPanel();
  }, 2000);

  // 监听 DOM 变化
  new MutationObserver(() => render()).observe(document.body, {childList:true, subtree:true});

  document.body.addEventListener('click', () => {
    debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
  }, {once: false});

  function updateDebugPanel() {
    debugPanel.innerHTML = 
      'Data: ' + debug.dataCount + '\n' +
      'Renders: ' + debug.renderCount + '\n' +
      'Stored: ' + tweetDataStore.size + '\n' +
      'Processed: ' + processedTweets.size + '\n' +
      'API calls: ' + debug.apiCalls.length + '\n' +
      (debug.errors.length > 0 ? '\nLast error:\n' + debug.errors.slice(-2).join('\n') : '');
  }

  document.body.appendChild(debugPanel);
  log('Debug panel created - click anywhere to show');

  // 页面加载时立即检查
  setTimeout(() => {
    log('Initial DOM check after 2s');
    render();
  }, 2000);
})();
</script>`;

const injected = body.replace('<head>', '<head>' + script);
$done({ body: injected });
