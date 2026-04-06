// X Viral Monitor - Loon Optimized Version
// 确保在全局作用域中执行，不依赖隔离环境

(function() {
  'use strict';

  // ===== 数据存储 =====
  const tweetDataStore = new Map();
  const processedTweets = new Set();
  const DEFAULT_THRESHOLDS = { trending: 1000, viral: 10000 };

  // ===== 多语言支持 =====
  const I18N = {
    en: {
      views: 'Views', likes: 'Likes', retweets: 'Retweets',
      replies: 'Replies', bookmarks: 'Bookmarks', velocity: 'Velocity',
      viralScore: 'Viral Score', posted: 'Posted',
    },
    zh: {
      views: '浏览量', likes: '点赞', retweets: '转发',
      replies: '回复', bookmarks: '收藏', velocity: '流速',
      viralScore: '爆帖指数', posted: '发布时间',
    },
    ja: {
      views: '表示回数', likes: 'いいね', retweets: 'リポスト',
      replies: '返信', bookmarks: 'ブックマーク', velocity: '流速',
      viralScore: 'バズ指数', posted: '投稿日時',
    },
  };

  const userLang = (navigator.language || 'en').split('-')[0];
  const strings = I18N[userLang] || I18N.en;

  // ===== 工具函数 =====
  function i18n(key) {
    return strings[key] || key;
  }

  function formatVelocity(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Math.round(v).toString();
  }

  function computeScore(data) {
    const now = Date.now();
    const created = new Date(data.createdAt).getTime();
    const hours = Math.max((now - created) / 3600000, 0.1);
    const velocity = data.views / hours;

    const velocityScore = Math.min(velocity / 50000, 1) * 40;
    const engagements = data.likes + data.retweets + data.replies;
    const engagementRate = data.views > 0 ? engagements / data.views : 0;
    const engagementScore = Math.min(engagementRate / 0.1, 1) * 25;
    const rtRatio = data.likes > 0 ? data.retweets / data.likes : 0;
    const rtScore = Math.min(rtRatio / 0.5, 1) * 20;
    const bmRatio = data.likes > 0 ? data.bookmarks / data.likes : 0;
    const bmScore = Math.min(bmRatio / 0.3, 1) * 15;

    const totalScore = Math.round(velocityScore + engagementScore + rtScore + bmScore);

    return {
      velocity,
      score: Math.min(totalScore, 100),
    };
  }

  // ===== 样式注入 =====
  function injectStyles() {
    if (document.getElementById('xvm-styles')) return;

    const style = document.createElement('style');
    style.id = 'xvm-styles';
    style.textContent = `
      .xvm-badge {
        display: inline-flex;
        align-items: center;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin-right: 4px;
        cursor: default;
        line-height: 20px;
        white-space: nowrap;
      }
      .xvm-badge--green { color: #4caf50; }
      .xvm-badge--orange { color: #ff9800; }
      .xvm-badge--red { color: #f44336; }
      .xvm-badge--green:hover { color: #66bb6a; }
      .xvm-badge--orange:hover { color: #ffa726; }
      .xvm-badge--red:hover { color: #ef5350; }
      .xvm-tooltip {
        display: none;
        position: fixed;
        z-index: 2147483647;
        background: rgb(15, 20, 26);
        color: rgb(231, 233, 234);
        font-size: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        white-space: pre-line;
        line-height: 1.6;
        border: 1px solid rgb(47, 51, 54);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.4);
        pointer-events: none;
      }
    `;

    document.head.appendChild(style);
  }

  // ===== 获取或创建 Tooltip =====
  let tooltipEl = null;
  function getTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'xvm-tooltip';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  // ===== 数据提取 =====
  function extractTweetData(result) {
    try {
      const tweet = result.tweet || result;
      const legacy = tweet.legacy;

      if (!legacy) return null;

      // 处理转推
      const rtResult = legacy.retweeted_status_result?.result;
      if (rtResult) {
        return extractTweetData(rtResult);
      }

      const viewCount = parseInt(tweet.views?.count, 10);
      if (!viewCount || tweet.views?.state !== 'EnabledWithCount') return null;

      // 过滤广告
      if (legacy.promotedMetadata || tweet.promotedMetadata) return null;

      return {
        id: legacy.id_str,
        views: viewCount,
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        bookmarks: legacy.bookmark_count || 0,
        createdAt: legacy.created_at,
      };
    } catch (e) {
      console.error('[XVM] Extract error:', e);
      return null;
    }
  }

  // ===== 递归扫描 JSON =====
  function scanForTweets(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 25) return false;

    let found = false;

    // 检查 tweet_results 对象
    if (obj.tweet_results?.result) {
      const data = extractTweetData(obj.tweet_results.result);
      if (data) {
        tweetDataStore.set(data.id, data);
        found = true;
      }
    }

    // 递归遍历
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (scanForTweets(item, depth + 1)) found = true;
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (key === 'tweet_results') continue;
        const val = obj[key];
        if (val && typeof val === 'object') {
          if (scanForTweets(val, depth + 1)) found = true;
        }
      }
    }

    return found;
  }

  // ===== 获取推文 ID =====
  function getTweetIdFromArticle(article) {
    try {
      const links = article.querySelectorAll('a[href*="/status/"]');
      for (const link of links) {
        const match = link.getAttribute('href').match(/\/status\/(\d+)$/);
        if (match) {
          const id = match[1];
          if (tweetDataStore.has(id)) return id;
        }
      }

      const firstLink = article.querySelector('a[href*="/status/"]');
      if (!firstLink) return null;
      const match = firstLink.getAttribute('href').match(/\/status\/(\d+)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  // ===== 渲染徽章 =====
  function renderBadges() {
    try {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');

      for (const article of articles) {
        if (article.hasAttribute('data-xvm-scored')) continue;

        const tweetId = getTweetIdFromArticle(article);
        if (!tweetId) continue;

        const data = tweetDataStore.get(tweetId);
        if (!data) continue;

        // 找到插入位置
        const caretBtn = article.querySelector('[data-testid="caret"]');
        if (!caretBtn) continue;

        let headerRow = caretBtn;
        while (headerRow && headerRow !== article) {
          if (headerRow.getBoundingClientRect().width > 200) break;
          headerRow = headerRow.parentElement;
        }

        if (!headerRow || headerRow === article) continue;

        article.setAttribute('data-xvm-scored', '1');
        const tweetId_key = 'xvm_' + tweetId;
        if (processedTweets.has(tweetId_key)) continue;
        processedTweets.add(tweetId_key);

        const { velocity, score } = computeScore(data);
        const thresholds = DEFAULT_THRESHOLDS;

        const prefix =
          velocity >= thresholds.viral
            ? '🔥'
            : velocity >= thresholds.trending
              ? '🚀'
              : '🌱';

        const colorClass =
          velocity >= thresholds.viral
            ? 'xvm-badge--red'
            : velocity >= thresholds.trending
              ? 'xvm-badge--orange'
              : 'xvm-badge--green';

        const badge = document.createElement('span');
        badge.className = `xvm-badge ${colorClass}`;
        badge.textContent = `${prefix} ${formatVelocity(velocity)}/h`;

        // 创建 Tooltip 内容
        const postedDate = new Date(data.createdAt);
        const postedStr =
          postedDate.getFullYear() +
          ':' +
          String(postedDate.getMonth() + 1).padStart(2, '0') +
          ':' +
          String(postedDate.getDate()).padStart(2, '0') +
          ' ' +
          String(postedDate.getHours()).padStart(2, '0') +
          ':' +
          String(postedDate.getMinutes()).padStart(2, '0') +
          ':' +
          String(postedDate.getSeconds()).padStart(2, '0');

        const tooltipContent =
          `${i18n('views')}: ${data.views.toLocaleString()}\n` +
          `${i18n('likes')}: ${data.likes.toLocaleString()}\n` +
          `${i18n('retweets')}: ${data.retweets.toLocaleString()}\n` +
          `${i18n('replies')}: ${data.replies.toLocaleString()}\n` +
          `${i18n('bookmarks')}: ${data.bookmarks.toLocaleString()}\n` +
          `${i18n('velocity')}: ${formatVelocity(velocity)}/h\n` +
          `${i18n('viralScore')}: ${score}/100\n` +
          `${i18n('posted')}: ${postedStr}`;

        badge.addEventListener('mouseenter', () => {
          const tip = getTooltip();
          tip.textContent = tooltipContent;
          const rect = badge.getBoundingClientRect();
          tip.style.display = 'block';
          tip.style.top = rect.bottom + 6 + 'px';

          const tipWidth = tip.offsetWidth || 200;
          let left = rect.right - tipWidth;
          if (left < 8) left = 8;
          tip.style.left = left + 'px';
        });

        badge.addEventListener('mouseleave', () => {
          getTooltip().style.display = 'none';
        });

        headerRow.insertBefore(badge, headerRow.lastElementChild);
      }
    } catch (e) {
      console.error('[XVM] Render error:', e);
    }
  }

  // ===== API 拦截 =====
  function setupInterceptors() {
    const GRAPHQL_RE = /\/i\/api\/graphql\//;

    // 拦截 fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

      if (url && GRAPHQL_RE.test(url)) {
        try {
          const clone = response.clone();
          clone.json().then((data) => {
            if (scanForTweets(data)) {
              renderBadges();
            }
          }).catch(() => {});
        } catch (e) {}
      }

      return response;
    };

    // 拦截 XHR
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (typeof url === 'string' && GRAPHQL_RE.test(url)) {
        this.addEventListener('load', () => {
          try {
            const data = JSON.parse(this.responseText);
            if (scanForTweets(data)) {
              renderBadges();
            }
          } catch (e) {}
        });
      }
      return originalXHROpen.call(this, method, url, ...rest);
    };
  }

  // ===== MutationObserver =====
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let hasNewArticles = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node.nodeType === 1 &&
            (node.tagName === 'ARTICLE' ||
              node.querySelector?.('article[data-testid="tweet"]'))
          ) {
            hasNewArticles = true;
            break;
          }
        }
        if (hasNewArticles) break;
      }
      if (hasNewArticles) {
        renderBadges();
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      });
    }
  }

  // ===== 定期渲染 =====
  function setupPeriodicRender() {
    setInterval(() => {
      const unscored = document.querySelectorAll(
        'article[data-testid="tweet"]:not([data-xvm-scored])'
      );
      if (unscored.length > 0) {
        renderBadges();
      }
    }, 2000);
  }

  // ===== 初始化 =====
  function init() {
    injectStyles();
    setupInterceptors();
    setupObserver();
    setupPeriodicRender();

    // 立即尝试渲染（以防页面已加载）
    setTimeout(() => {
      renderBadges();
    }, 1000);
  }

  // 等待 DOM 准备好
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
