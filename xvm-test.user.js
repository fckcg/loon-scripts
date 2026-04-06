// ==UserScript==
// @name         XVM Debug
// @namespace    test
// @version      1.0
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  // 测试1：fetch 拦截
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0]==='string' ? args[0] : args[0]?.url || '';
    if (url.includes('graphql')) {
      console.log('[XVM] 拦截到 graphql 请求:', url);
      showMsg('✅ 拦截到 graphql');
    }
    return _fetch.apply(this, args);
  };

  function showMsg(text) {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = 'position:fixed;top:60px;left:10px;z-index:99999;background:blue;color:white;padding:8px;font-size:14px;border-radius:6px;max-width:80vw;word-break:break-all;';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    showMsg('🔵 脚本已启动，等待请求...');
  });
})();
