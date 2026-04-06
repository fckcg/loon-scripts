// ==UserScript==
// @name         XVM Test
// @namespace    test
// @version      1.0
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';
  const div = document.createElement('div');
  div.textContent = '✅ Userscripts 工作正常';
  div.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:red;color:white;padding:10px;font-size:16px;border-radius:8px;';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
})();
