const body = $response.body;
if (!body || !body.includes('<head>')) {
  $done({});
  return;
}

const script = `<script> (function () {
  // ─── 样式 ───────────────────────────────────────────────────────────
  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = \`
    .xvm-badge{display:inline-flex;align-items:center;font-size:13px;font-family:-apple-system,sans-serif;margin-right:4px;cursor:default;line-height:20px;white-space:nowrap;}
    .xvm-badge–green{color:#4caf50}.xvm-badge–orange{color:#ff9800}.xvm-badge–red{color:#f44336}
    .xvm-badge–green:hover{color:#66bb6a}.xvm-badge–orange:hover{color:#ffa726}.xvm-badge–red:hover{color:#ef5350}
    .xvm-tooltip{display:none;position:fixed;z-index:2147483647;background:rgb(15,20,26);color:rgb(231,233,234);font-size:12px;padding:10px 12px;border-radius:8px;white-space:pre-line;line-height:1.6;border:1px solid rgb(47,51,54);box-shadow:0 4px 6px rgba(0,0,0,0.4);pointer-events:none;}
    \`;
    (document.head || document.documentElement).appendChild(s);
  }
  injectStyle();

  // ─── 配置 ─────────────────��──────────────────────────────────────────
  const thresholds = { trending: 1000, viral: 10000 };
  const tweetDataStore = new Map();
  const processedTweets = new Set();
  
  // ─── 调试模式 ────────────────────────────────────────────────────────
  window.__xvmDebug = { dataCount: 0, renderCount: 0, errors: [] };

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
        res.clone().json().then(scan).catch((e) => {
          window.__xvmDebug.errors.push('fetch json parse error: ' + e.message);
        });
      }
    } catch(e) {
      window.__xvmDebug.errors.push('fetch error: ' + e.message);
    }
    return res;
  };

  // ─── 拦截 XHR ────────────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url, ...r) {
    if (typeof url==='string' && GRAPHQL_RE.test(url)) {
      this.addEventListener('load', function() {
        try { 
          scan(JSON.parse(this.responseText)); 
        } catch(e) {
          window.__xvmDebug.errors.push('XHR json parse error: ' + e.message);
        }
      });
    }
    return _open.call(this, m, url, ...r);
  };

  // ─── 数据提取 ──────────────────────────────────────────────────────────
  function scan(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;
    let found = false;
    
    if (obj.tweet_results?.result) {
      const d = extract(obj.tweet_results.result);
      if (d) { 
        tweetDataStore.set(d.id, d); 
        window.__xvmDebug.dataCount++;
        found = true; 
      }
    }
    
    for (const k of Object.keys(obj)) {
      if (k==='tweet_results') continue;
      if (obj[k] && typeof obj[k]==='object') scan(obj[k], depth + 1);
    }
    
    if (found) render();
  }

  function extract(result) {
    try {
      const tweet = result.tweet || result;
      const legacy = tweet.legacy;
      if (!legacy) return null;
      if (legacy.retweeted_status_result?.result) return extract(legacy.retweeted_status_result.result);
      const views = parseInt(tweet.views?.count, 10);
      if (!views || tweet.views?.state !== 'EnabledWithCount') return null;
      if (legacy.promotedMetadata || tweet.promotedMetadata) return null;
      return {
        id: legacy.id_str, views,
        likes: legacy.favorite_count||0, retweets: legacy.retweet_count||0,
        replies: legacy.reply_count||0, bookmarks: legacy.bookmark_count||0,
        createdAt: legacy.created_at,
      };
    } catch(e) {
      window.__xvmDebug.errors.push('extract error: ' + e.message);
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
      window.__xvmDebug.renderCount++;
      
      // 支持多个选择器
      const selectors = [
        'article[data-testid="tweet"]',
        'div[data-testid="tweet"]',
        'article[role="article"]'
      ];
      
      let articles = [];
      for (const selector of selectors) {
        articles = document.querySelectorAll(selector);
        if (articles.length > 0) break;
      }
      
      for (const article of articles) {
        if (article.hasAttribute('data-xvm-scored')) continue;
        
        const id = getId(article);
        if (!id || processedTweets.has(id)) continue;
        
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
          +strings.likes+': '+data.likes.toLocaleString()+'\n'
          +strings.retweets+': '+data.retweets.toLocaleString()+'\n'
          +strings.replies+': '+data.replies.toLocaleString()+'\n'
          +strings.bookmarks+': '+data.bookmarks.toLocaleString()+'\n'
          +strings.velocity+': '+fmt(velocity)+'/h\n'
          +strings.viralScore+': '+score+'/100\n'
          +strings.posted+': '+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
        
        badge.addEventListener('mouseenter', () => {
          const t=getTip(); t.textContent=content;
          const r=badge.getBoundingClientRect();
          t.style.display='block'; t.style.top=(r.bottom+6)+'px';
          let left=r.right-t.offsetWidth; if(left<8)left=8;
          t.style.left=left+'px';
        });
        badge.addEventListener('mouseleave', () => { getTip().style.display='none'; });
        
        // 改进的徽章插入位置查找
        const insertedBadge = tryInsertBadge(article, badge);
        if (!insertedBadge) {
          // 备选方案：直接插入到文章开头
          article.insertBefore(badge, article.firstElementChild);
        }
      }
    } catch(e) {
      window.__xvmDebug.errors.push('render error: ' + e.message);
    }
  }

  function tryInsertBadge(article, badge) {
    // 尝试多个插入位置
    const positions = [
      () => article.querySelector('[data-testid="caret"]')?.parentElement,
      () => article.querySelector('div[role="button"]'),
      () => article.querySelector('a[href*="/status/"]')?.closest('div'),
      () => article.querySelector('[role="group"]')
    ];
    
    for (const posGetter of positions) {
      try {
        const pos = posGetter();
        if (pos && pos !== article && article.contains(pos)) {
          const parent = pos.parentElement;
          if (parent) {
            parent.insertBefore(badge, pos.nextSibling);
            return true;
          }
        }
      } catch(e) {}
    }
    return false;
  }

  function getId(article) {
    try {
      // 先尝试从已存储的数据中查找
      for (const a of article.querySelectorAll('a[href*="/status/"]')) {
        const m = a.getAttribute('href').match(/\/status\/(\d+)$/);
        if (m && tweetDataStore.has(m[1])) return m[1];
      }
      
      // 备选方案：从任何状态链接中提取
      const a = article.querySelector('a[href*="/status/"]');
      if (!a) return null;
      const m = a.getAttribute('href').match(/\/status\/(\d+)/);
      return m ? m[1] : null;
    } catch(e) {
      window.__xvmDebug.errors.push('getId error: ' + e.message);
      return null;
    }
  }

  setInterval(() => {
    const unscored = document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm-scored])');
    if (unscored.length > 0) render();
  }, 2000);

  function startObserver() {
    new MutationObserver(mutations => {
      for (const mu of mutations)
        for (const node of mu.addedNodes)
          if (node.nodeType===1&&(node.tagName==='ARTICLE'||node.querySelector?.('article[data-testid="tweet"]')))
            { render(); return; }
    }).observe(document.body,{childList:true,subtree:true});
  }
  document.body ? startObserver() : document.addEventListener('DOMContentLoaded', startObserver);
})();
</script>`;

const injected = body.replace('<head>', '<head>' + script);
$done({ body: injected });
