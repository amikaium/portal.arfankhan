export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const myDomain = url.hostname;

    // কুকি চেক করে টার্গেট সাইট বের করা
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/active_target=([^;]+)/);
    let targetSite = match ? match[1] : null;

    // ম্যানুয়াল রিসেট লজিক
    if (url.pathname === '/reset') {
        return new Response('Going back to portal...', {
            status: 302,
            headers: {
                'Location': '/',
                'Set-Cookie': 'active_target=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
            }
        });
    }

    // টার্গেট না থাকলে ডিরেক্ট পোর্টাল লিস্ট দেখাবে
    if (!targetSite) {
        return this.servePortal();
    }

    const TARGET_DOMAIN = "https://" + targetSite;
    const API_DOMAINS = ["vrnlapi.com"]; 
    const MEDIA_AND_SCORE_DOMAINS = ["aax-eu1314.com"]; 
    const ALL_TARGETS = [...API_DOMAINS, ...MEDIA_AND_SCORE_DOMAINS]; 
    
    const originHeader = request.headers.get("Origin") || `https://${url.host}`;

    // =========================================================================
    // ⚙️ অটোমেটিক প্যাকার ইঞ্জিন
    // =========================================================================
    const autoPackJS = (rawCode) => {
        const obfuscated = btoa(unescape(encodeURIComponent(rawCode)));
        return `!function(){var e="${obfuscated}",t=decodeURIComponent(escape(atob(e)));new Function(t)()}();`;
    };

    // ==========================================
    // 🛡️ প্রফেশনাল সিকিউরিটি: Ghost Script Route
    // ==========================================
    if (url.pathname === '/__secure_core.js') {
        const referer = request.headers.get("Referer");
        
        if (!referer || !referer.includes(url.hostname)) {
            return new Response(`console.log("Access Denied: Nice try, but you can't copy this code! 😎");`, {
                status: 200,
                headers: { "Content-Type": "application/javascript" }
            });
        }

        const rawJs = `
          (function() {
            const proxyPrefix = '/__api_proxy/';
            const targetApis = ${JSON.stringify(ALL_TARGETS)};
            function shouldIntercept(url) {
              if (typeof url !== 'string') return false;
              if (url.includes('__api_proxy')) return false; 
              return targetApis.some(api => url.includes(api));
            }
            const originalFetch = window.fetch;
            window.fetch = async function(...args) {
              try {
                let reqUrl = args[0];
                if (typeof reqUrl === 'string' && shouldIntercept(reqUrl)) {
                  args[0] = proxyPrefix + reqUrl;
                } else if (reqUrl instanceof Request && shouldIntercept(reqUrl.url)) {
                  args[0] = new Request(proxyPrefix + reqUrl.url, reqUrl);
                }
              } catch(e) {}
              return originalFetch.apply(this, args);
            };
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              try {
                if (typeof url === 'string' && shouldIntercept(url)) {
                  url = proxyPrefix + url;
                }
              } catch(e) {}
              return originalOpen.call(this, method, url, ...rest);
            };
          })();
        `;
        
        const secretCode = autoPackJS(rawJs);

        return new Response(secretCode, {
            status: 200,
            headers: { 
                "Content-Type": "application/javascript",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            }
        });
    }

    // ১. CORS প্রিফ্লাইট
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": originHeader,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
          "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    // ২. API এবং Video Stream প্রক্সি
    if (url.pathname.startsWith('/__api_proxy/')) {
      let actualApiUrl = request.url.substring(request.url.indexOf('/__api_proxy/') + 13);
      if (!actualApiUrl.startsWith('http')) {
         actualApiUrl = 'https://' + actualApiUrl;
      }
      try {
        const targetApi = new URL(actualApiUrl);
        const apiReq = new Request(targetApi.toString(), request);
        apiReq.headers.set("Host", targetApi.host);
        apiReq.headers.set("Origin", TARGET_DOMAIN);
        apiReq.headers.set("Referer", TARGET_DOMAIN + "/");

        const apiRes = await fetch(apiReq);
        let newApiRes;
        const contentType = apiRes.headers.get("content-type") || "";
        
        if (contentType.includes("mpegurl") || contentType.includes("m3u8") || url.pathname.endsWith(".m3u8")) {
            let m3u8Text = await apiRes.text();
            const proxyPrefix = `https://${url.host}/__api_proxy/`;
            ALL_TARGETS.forEach(api => {
                m3u8Text = m3u8Text.replaceAll(`https://${api}`, `${proxyPrefix}https://${api}`);
            });
            const modHeaders = new Headers(apiRes.headers);
            modHeaders.delete("content-length"); 
            newApiRes = new Response(m3u8Text, { status: apiRes.status, statusText: apiRes.statusText, headers: modHeaders });
        } else {
            newApiRes = new Response(apiRes.body, apiRes);
        }
        
        const finalHeaders = new Headers(newApiRes.headers);
        finalHeaders.set("Access-Control-Allow-Origin", originHeader);
        finalHeaders.set("Access-Control-Allow-Credentials", "true");
        return new Response(newApiRes.body, { status: newApiRes.status, statusText: newApiRes.statusText, headers: finalHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Proxy Error" }), { status: 500 });
      }
    }

    // ৩. মেইন ওয়েবসাইট লোড করা
    const target = new URL(TARGET_DOMAIN);
    target.pathname = url.pathname;
    target.search = url.search;
    const proxyRequest = new Request(target.toString(), request);
    proxyRequest.headers.set("Host", target.hostname);
    proxyRequest.headers.set("Origin", target.origin);
    proxyRequest.headers.set("Referer", target.origin);
    proxyRequest.headers.delete("Accept-Encoding"); 

    try {
      const response = await fetch(proxyRequest);
      const contentType = response.headers.get("content-type") || "";
      let responseBody;
      const newResponseHeaders = new Headers(response.headers);

      if (contentType.includes("text/html") || contentType.includes("application/javascript") || contentType.includes("text/javascript")) {
        let text = await response.text();
        const proxyPrefix = `https://${url.host}/__api_proxy/`;
        
        MEDIA_AND_SCORE_DOMAINS.forEach(api => {
            const originalUrl = `https://${api}`;
            const proxyUrl = `${proxyPrefix}${originalUrl}`;
            text = text.replaceAll(originalUrl, proxyUrl);
            text = text.replaceAll(originalUrl.replace(/\//g, '\\/'), proxyUrl.replace(/\//g, '\\/'));
        });

        // ডোমেইন নেম রিপ্লেসমেন্ট
        text = text.replaceAll(/velki123\.win/gi, "velkix.live");
        text = text.replaceAll(/velki123/gi, "velkix.live");

        const newLogoUrl = "https://i.postimg.cc/J0P019Hr/20260408-225146.webp";
        const newLoginBanner = "https://i.postimg.cc/CLCXKkN6/20260408-232743.webp";

        text = text.replace(/([a-zA-Z0-9_./-]*velki-logo[a-zA-Z0-9_.-]*\.(png|webp|jpg|jpeg|svg))/gi, newLogoUrl);
        text = text.replace(/([a-zA-Z0-9_./-]*velki-login-signup-banner[a-zA-Z0-9_.-]*\.(png|webp|jpg|jpeg|svg))/gi, newLoginBanner);

        text = text.replaceAll('class="signup" href="/"', 'class="signup" href="https://playpbu.com"');

        // 🔹 আল্ট্রা সিকিউরিটি আপডেট এবং ট্যাব-ক্লোজ রিস্টার্ট চেকার 🔹
        if (contentType.includes("text/html")) {
            
            const rawForceJs = `
                // 🛑 ট্যাব ক্লোজ বা অ্যাপ রিস্টার্ট চেক লজিক 🛑
                // যদি নতুন ট্যাব হয়, তবে sessionStorage ফাঁকা থাকবে এবং এটি কুকি ক্লিয়ার করে পোর্টালে পাঠিয়ে দিবে
                if (!sessionStorage.getItem('proxy_session_active')) {
                    document.cookie = 'active_target=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;';
                    window.location.href = '/';
                }

                // ০. ইমেজ প্রি-লোড
                var p1 = document.createElement('link'); p1.rel = 'preload'; p1.as = 'image'; p1.href = '${newLogoUrl}';
                var p2 = document.createElement('link'); p2.rel = 'preload'; p2.as = 'image'; p2.href = '${newLoginBanner}';
                document.head.appendChild(p1); document.head.appendChild(p2);

                // ১. ডাইনামিক CSS ইনজেকশন
                var s = document.createElement('style');
                s.innerHTML = '.logo-sec img { content: url("${newLogoUrl}") !important; width: 115px !important; height: auto !important; max-width: none !important; } ' +
                              '.is-outsite-icon-new { background-color: rgba(255, 255, 255, 0.85) !important; border-radius: 5px !important; overflow: hidden !important; } ' +
                              '.is-outsite-icon-new img { content: url("${newLogoUrl}") !important; width: 100% !important; height: auto !important; object-fit: contain !important; } ' +
                              '.is-outsite-icon-new::after { content: ""; position: absolute; top: 0; left: -150%; width: 50%; height: 100%; background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 100%); transform: skewX(-25deg); animation: premiumShine 6s infinite ease-in-out; pointer-events: none; } ' +
                              '@keyframes premiumShine { 0% { left: -150%; } 30% { left: 150%; } 100% { left: 150%; } }';
                document.head.appendChild(s);

                // ২. সিকিউর কোর স্ক্রিপ্ট ইনজেকশন
                var sc = document.createElement('script');
                sc.src = '/__secure_core.js';
                document.head.appendChild(sc);

                // ৩. সাইন আপ বাটন ফোর্স লিংক
                setInterval(function() {
                    document.querySelectorAll('.signup').forEach(function(btn) {
                        if(btn.href !== 'https://playpbu.com/') {
                            btn.href = 'https://playpbu.com';
                            btn.onclick = function(e) {
                                e.preventDefault();
                                window.location.href = 'https://playpbu.com';
                            };
                        }
                    });
                }, 500);
            `;

            // শুধুমাত্র একটিমাত্র এনক্রিপ্টেড ট্যাগ ইনজেক্ট হবে
            const encryptedJsTag = `<script>${autoPackJS(rawForceJs)}</script>`;
            
            if (text.includes('<head>')) {
              text = text.replace('<head>', '<head>' + encryptedJsTag);
            } else {
              text = encryptedJsTag + text;
            }
        }
        
        responseBody = text;
        newResponseHeaders.delete("content-length"); 
        newResponseHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      } else {
        responseBody = response.body;
      }

      newResponseHeaders.delete("Content-Security-Policy");
      newResponseHeaders.delete("X-Frame-Options");
      newResponseHeaders.set("Access-Control-Allow-Origin", originHeader);
      
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders
      });
    } catch (error) {
      return new Response("System Error", { status: 500 });
    }
  },

  // ==========================================
  // ফ্রন্ট-এন্ড পোর্টাল ডিজাইন (Site List)
  // ==========================================
  servePortal() {
      const sites = [
          'ag.tenx365x.live', 
          'ag.all9x.com', 
          'ag.baji11.live',
          'ag.baji365x.live', 
          'ag.velki123.win', 
          'ag.vellki365.app'
      ];

      let listHtml = '';
      sites.forEach(site => {
          const displayName = site.replace(/^ag\./i, '');
          listHtml += `
          <div class="site-card">
              <div class="site-info">
                  <svg class="icon-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  <span class="site-name">${displayName}</span>
              </div>
              <button class="visit-btn" onclick="setTarget('${site}')">
                  Visit Site 
                  <svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
              </button>
          </div>`;
      });

      const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
          <title>Gateway Portal</title>
          <style>
              body {
                  background-color: #000000; color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  margin: 0; padding: 0; -webkit-tap-highlight-color: transparent;
                  user-select: text !important;
                  -webkit-user-select: text !important;
              }
              .app-container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; margin-top: 10px; }
              h1 { font-size: 28px; font-weight: 700; margin: 0; user-select: none; }
              
              .site-list { display: flex; flex-direction: column; gap: 12px; }
              .site-card {
                  background-color: #1C1C1E; border-radius: 14px; padding: 16px;
                  display: flex; justify-content: space-between; align-items: center;
              }
              
              .site-info { display: flex; align-items: center; gap: 12px; overflow: hidden; flex-grow: 1; }
              .icon-globe { width: 20px; height: 20px; color: #0A84FF; flex-shrink: 0; user-select: none; }
              .site-name { 
                  font-size: 16px; font-weight: 500; color: #F2F2F7; white-space: nowrap; 
                  overflow: hidden; text-overflow: ellipsis;
                  user-select: text !important;
                  -webkit-user-select: text !important;
              }
              
              .visit-btn {
                  background-color: #0A84FF; color: #FFFFFF; border: none; padding: 8px 16px; margin-left: 10px;
                  border-radius: 20px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; 
                  cursor: pointer; user-select: none;
              }
              .visit-btn:active { transform: scale(0.96); background-color: #007AFF; }
              .icon-arrow { width: 16px; height: 16px; }
          </style>
      </head>
      <body>
          <div class="app-container">
              <div class="header">
                  <h1>Platforms</h1>
              </div>
              <div class="site-list">
                  ${listHtml}
              </div>
          </div>

          <script>
              function setTarget(site) {
                  // 쿠কি সেট করা হলো
                  document.cookie = "active_target=" + site + "; path=/;";
                  
                  // 🛑 মূল ম্যাজিক: পোর্টালে ক্লিক করলেই এই নির্দিষ্ট ট্যাবের জন্য সেশন অ্যাক্টিভ হবে 🛑
                  sessionStorage.setItem("proxy_session_active", "true");
                  
                  window.location.href = "/";
              }
          </script>
      </body>
      </html>
      `;

      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
};
