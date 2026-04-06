if ($response.status === 200) {
  let body = $response.body;
  if (!body || !body.includes('<html')) {
    $done({});
    return;
  }
  
  const code = `<script>(function(){console.log('XVM loaded');const s=new Map();window.fetch=(async (...a)=>{const r=await (window._fetch||fetch)(...a);const u=typeof a[0]==='string'?a[0]:'';if(/\\/i\\/api\\/graphql\\//i.test(u)){r.clone().json().then(o=>{function f(t,d=0){if(!t||typeof t!=='object'||d>20)return;if(t.tweet_results?.result?.tweet?.legacy){const l=t.tweet_results.result.tweet.legacy;if(l.id_str){s.set(l.id_str,{views:parseInt(t.tweet_results.result.tweet.views?.count),created:l.created_at})}}for(const k in t)if(t[k]&&typeof t[k]==='object')f(t[k],d+1)}f(o);setTimeout(()=>{for(const a of document.querySelectorAll('article[data-testid="tweet"]')){if(a.dataset.xvm)continue;const l=a.querySelector('a[href*="/status/"]');if(!l)continue;const m=l.href.match(/\\d+/);if(!m)continue;const d=s.get(m[0]);if(!d)continue;a.dataset.xvm=1;const h=Math.max((Date.now()-new Date(d.created).getTime())/3600000,0.1);const v=d.views/h;const t=document.createElement('span');t.style.cssText='color:'+(v>=10000?'#f44336':v>=1000?'#ff9800':'#4caf50')+';margin-right:4px;font-size:13px';t.textContent=(v>=10000?'🔥':v>=1000?'🚀':'🌱')+' '+(v>=1000?(v/1000).toFixed(1)+'k':Math.round(v))+'/h';const c=a.querySelector('[data-testid="caret"]');if(c?.parentElement)c.parentElement.insertBefore(t,c)}},500)}).catch(()=>{})}return r});window._fetch=window.fetch;setInterval(()=>{for(const a of document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm])')){const l=a.querySelector('a[href*="/status/"]');if(l&&l.href.match(/\\d+/)){}}},2000)})();</script>`;
  
  body = body.replace(/<head[^>]*>/i, (match) => match + code);
  $done({ body });
} else {
  $done({});
}
