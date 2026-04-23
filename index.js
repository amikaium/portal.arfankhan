export default {
  async fetch(request, env, ctx) {
    // 🛑 KV Binding চেক করা হচ্ছে
    if (!env.PORTAL_DB) {
        return new Response("Error: KV Namespace 'PORTAL_DB' is not bound. Please check Cloudflare settings.", { status: 500 });
    }

    const url = new URL(request.url);
    const myDomain = url.hostname;

    // ==========================================
    // 🔐 API রাউটিং (সাইট এবং পাসওয়ার্ড সেভ করার জন্য)
    // ==========================================
    if (url.pathname === '/__portal_api/data') {
        if (request.method === 'GET') {
            let data = await env.PORTAL_DB.get('portal_vault', 'json');
            if (!data) {
                // ডাটাবেস ফাঁকা থাকলে ডিফল্ট সাইটগুলো লোড হবে
                data = {
                    "ag.tenx365x.live": {}, "ag.all9x.com": {}, "ag.baji11.live": {},
                    "ag.baji365x.live": {}, "ag.velki123.win": {}, "ag.vellki365.app": {}
                };
                await env.PORTAL_DB.put('portal_vault', JSON.stringify(data));
            }
            return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
        }
        if (request.method === 'POST') {
            const body = await request.json();
            await env.PORTAL_DB.put('portal_vault', JSON.stringify(body));
            return new Response(JSON.stringify({ success: true }));
        }
    }

    // কুকি চেক করে টার্গেট সাইট বের করা
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/active_target=([^;]+)/);
    let targetSite = match ? match[1] : null;

    if (url.pathname === '/reset') {
        return new Response('Going back to portal...', {
            status: 302,
            headers: { 'Location': '/', 'Set-Cookie': 'active_target=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT' }
        });
    }

    // টার্গেট না থাকলে পোর্টাল লিস্ট দেখাবে
    if (!targetSite) {
        return this.servePortal();
    }

    const TARGET_DOMAIN = "https://" + targetSite;
    const API_DOMAINS = ["vrnlapi.com"]; 
    const MEDIA_AND_SCORE_DOMAINS = ["aax-eu1314.com"]; 
    const ALL_TARGETS = [...API_DOMAINS, ...MEDIA_AND_SCORE_DOMAINS]; 
    
    const originHeader = request.headers.get("Origin") || `https://${url.host}`;

    const autoPackJS = (rawCode) => {
        const obfuscated = btoa(unescape(encodeURIComponent(rawCode)));
        return `!function(){var e="${obfuscated}",t=decodeURIComponent(escape(atob(e)));new Function(t)()}();`;
    };

    if (url.pathname === '/__secure_core.js') {
        const referer = request.headers.get("Referer");
        if (!referer || !referer.includes(url.hostname)) {
            return new Response(`console.log("Access Denied!");`, { status: 200, headers: { "Content-Type": "application/javascript" }});
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
              try { if (typeof url === 'string' && shouldIntercept(url)) { url = proxyPrefix + url; } } catch(e) {}
              return originalOpen.call(this, method, url, ...rest);
            };
          })();
        `;
        return new Response(autoPackJS(rawJs), { status: 200, headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }});
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": originHeader, "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH", "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Max-Age": "86400" }});
    }

    if (url.pathname.startsWith('/__api_proxy/')) {
      let actualApiUrl = request.url.substring(request.url.indexOf('/__api_proxy/') + 13);
      if (!actualApiUrl.startsWith('http')) actualApiUrl = 'https://' + actualApiUrl;
      try {
        const targetApi = new URL(actualApiUrl);
        const apiReq = new Request(targetApi.toString(), request);
        apiReq.headers.set("Host", targetApi.host); apiReq.headers.set("Origin", TARGET_DOMAIN); apiReq.headers.set("Referer", TARGET_DOMAIN + "/");
        const apiRes = await fetch(apiReq);
        let newApiRes;
        const contentType = apiRes.headers.get("content-type") || "";
        if (contentType.includes("mpegurl") || contentType.includes("m3u8") || url.pathname.endsWith(".m3u8")) {
            let m3u8Text = await apiRes.text();
            const proxyPrefix = `https://${url.host}/__api_proxy/`;
            ALL_TARGETS.forEach(api => { m3u8Text = m3u8Text.replaceAll(`https://${api}`, `${proxyPrefix}https://${api}`); });
            const modHeaders = new Headers(apiRes.headers); modHeaders.delete("content-length"); 
            newApiRes = new Response(m3u8Text, { status: apiRes.status, statusText: apiRes.statusText, headers: modHeaders });
        } else { newApiRes = new Response(apiRes.body, apiRes); }
        const finalHeaders = new Headers(newApiRes.headers); finalHeaders.set("Access-Control-Allow-Origin", originHeader); finalHeaders.set("Access-Control-Allow-Credentials", "true");
        return new Response(newApiRes.body, { status: newApiRes.status, statusText: newApiRes.statusText, headers: finalHeaders });
      } catch (e) { return new Response("Proxy Error", { status: 500 }); }
    }

    // KV থেকে ভল্ট ডাটা আনা (ইনজেকশনের জন্য)
    let vaultData = await env.PORTAL_DB.get('portal_vault', 'json') || {};

    const target = new URL(TARGET_DOMAIN);
    target.pathname = url.pathname; target.search = url.search;
    const proxyRequest = new Request(target.toString(), request);
    proxyRequest.headers.set("Host", target.hostname); proxyRequest.headers.set("Origin", target.origin); proxyRequest.headers.set("Referer", target.origin); proxyRequest.headers.delete("Accept-Encoding"); 

    try {
      const response = await fetch(proxyRequest);
      const contentType = response.headers.get("content-type") || "";
      let responseBody;
      const newResponseHeaders = new Headers(response.headers);

      if (contentType.includes("text/html") || contentType.includes("application/javascript") || contentType.includes("text/javascript")) {
        let text = await response.text();
        const proxyPrefix = `https://${url.host}/__api_proxy/`;
        
        MEDIA_AND_SCORE_DOMAINS.forEach(api => {
            const originalUrl = `https://${api}`; const proxyUrl = `${proxyPrefix}${originalUrl}`;
            text = text.replaceAll(originalUrl, proxyUrl); text = text.replaceAll(originalUrl.replace(/\//g, '\\/'), proxyUrl.replace(/\//g, '\\/'));
        });

        text = text.replaceAll(/velki123\.win/gi, "velkix.live"); text = text.replaceAll(/velki123/gi, "velkix.live");

        const newLogoUrl = "https://i.postimg.cc/J0P019Hr/20260408-225146.webp";
        const newLoginBanner = "https://i.postimg.cc/CLCXKkN6/20260408-232743.webp";

        text = text.replace(/([a-zA-Z0-9_./-]*velki-logo[a-zA-Z0-9_.-]*\.(png|webp|jpg|jpeg|svg))/gi, newLogoUrl);
        text = text.replace(/([a-zA-Z0-9_./-]*velki-login-signup-banner[a-zA-Z0-9_.-]*\.(png|webp|jpg|jpeg|svg))/gi, newLoginBanner);
        text = text.replaceAll('class="signup" href="/"', 'class="signup" href="https://playpbu.com"');

        if (contentType.includes("text/html")) {
            const rawForceJs = `
                // 🛑 সেশন এবং ট্যাব-ক্লোজ রিস্টার্ট চেকার 🛑
                if (!sessionStorage.getItem('proxy_session_active')) {
                    document.cookie = 'active_target=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;'; window.location.href = '/';
                }
                var p1 = document.createElement('link'); p1.rel = 'preload'; p1.as = 'image'; p1.href = '${newLogoUrl}'; document.head.appendChild(p1);
                var p2 = document.createElement('link'); p2.rel = 'preload'; p2.as = 'image'; p2.href = '${newLoginBanner}'; document.head.appendChild(p2);

                var s = document.createElement('style');
                s.innerHTML = '.logo-sec img { content: url("${newLogoUrl}") !important; width: 115px !important; height: auto !important; max-width: none !important; } .is-outsite-icon-new { background-color: rgba(255, 255, 255, 0.85) !important; border-radius: 5px !important; overflow: hidden !important; } .is-outsite-icon-new img { content: url("${newLogoUrl}") !important; width: 100% !important; height: auto !important; object-fit: contain !important; } .is-outsite-icon-new::after { content: ""; position: absolute; top: 0; left: -150%; width: 50%; height: 100%; background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 100%); transform: skewX(-25deg); animation: premiumShine 6s infinite ease-in-out; pointer-events: none; } @keyframes premiumShine { 0% { left: -150%; } 30% { left: 150%; } 100% { left: 150%; } }';
                document.head.appendChild(s);

                var sc = document.createElement('script'); sc.src = '/__secure_core.js'; document.head.appendChild(sc);

                setInterval(function() {
                    document.querySelectorAll('.signup').forEach(function(btn) {
                        if(btn.href !== 'https://playpbu.com/') { btn.href = 'https://playpbu.com'; btn.onclick = function(e) { e.preventDefault(); window.location.href = 'https://playpbu.com'; }; }
                    });
                }, 500);

                // 🔐 KV ডাটাবেস থেকে ডাইরেক্ট পাসওয়ার্ড ইনজেকশন 🔐
                window.__SERVER_VAULT__ = ${JSON.stringify(vaultData)};

                setTimeout(function() {
                    const currentTargetSite = '${targetSite}';
                    const userInp = document.querySelector('#userid') || document.querySelector('input[type="text"]');
                    const passInp = document.querySelector('#password') || document.querySelector('input[type="password"]');
                    
                    if(userInp && passInp) {
                        // ডিফল্ট ব্রাউজার সাজেস্ট অফ করার চেষ্টা
                        userInp.setAttribute('autocomplete', 'off'); passInp.setAttribute('autocomplete', 'new-password');

                        // কাস্টম ড্রপডাউন UI তৈরি
                        const dropdown = document.createElement('div');
                        dropdown.style.cssText = 'position:absolute; display:none; background:#1C1C1E; border:1px solid #38383A; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.5); z-index:999999; overflow:hidden; font-family:-apple-system, sans-serif;';
                        document.body.appendChild(dropdown);

                        userInp.addEventListener('focus', function() {
                            let accounts = window.__SERVER_VAULT__[currentTargetSite] || {};
                            if(Object.keys(accounts).length > 0) {
                                dropdown.innerHTML = '<div style="padding:8px 12px; font-size:11px; color:#8E8E93; background:#2C2C2E; border-bottom:1px solid #38383A; font-weight:bold; letter-spacing: 1px;">SAVED ACCOUNTS</div>';
                                for(let user in accounts) {
                                    let item = document.createElement('div');
                                    item.style.cssText = 'padding:12px 15px; font-size:15px; color:#FFFFFF; display:flex; align-items:center; cursor:pointer; border-bottom:1px solid #38383A; transition: background 0.2s;';
                                    item.innerHTML = '<span style="background:#0A84FF; color:#fff; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; margin-right:12px;">' + user.charAt(0).toUpperCase() + '</span>' + user;
                                    
                                    item.onmouseover = () => item.style.background = '#3A3A3C';
                                    item.onmouseout = () => item.style.background = 'transparent';

                                    item.onclick = function(e) { e.preventDefault(); userInp.value = user; passInp.value = accounts[user]; dropdown.style.display = 'none'; };
                                    dropdown.appendChild(item);
                                }
                                let rect = userInp.getBoundingClientRect();
                                dropdown.style.top = (rect.bottom + window.scrollY + 8) + 'px'; dropdown.style.left = (rect.left + window.scrollX) + 'px'; dropdown.style.width = rect.width + 'px';
                                dropdown.style.display = 'block';
                            }
                        });
                        document.addEventListener('click', function(e) { if(e.target !== userInp && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });
                    }
                }, 1000);
            `;
            const encryptedJsTag = `<script>${autoPackJS(rawForceJs)}</script>`;
            if (text.includes('<head>')) { text = text.replace('<head>', '<head>' + encryptedJsTag); } else { text = encryptedJsTag + text; }
        }
        
        responseBody = text;
        newResponseHeaders.delete("content-length"); newResponseHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      } else { responseBody = response.body; }

      newResponseHeaders.delete("Content-Security-Policy"); newResponseHeaders.delete("X-Frame-Options"); newResponseHeaders.set("Access-Control-Allow-Origin", originHeader);
      return new Response(responseBody, { status: response.status, statusText: response.statusText, headers: newResponseHeaders });
    } catch (error) { return new Response("System Error", { status: 500 }); }
  },

  // ==========================================
  // ফ্রন্ট-এন্ড পোর্টাল ডিজাইন (React স্টাইল ডাইনামিক UI)
  // ==========================================
  servePortal() {
      const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
          <title>Gateway Portal</title>
          <style>
              body { background-color: #000000; color: #FFFFFF; font-family: -apple-system, sans-serif; margin: 0; padding: 0; user-select: text !important; -webkit-tap-highlight-color: transparent;}
              .app-container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; margin-top: 10px; }
              h1 { font-size: 28px; font-weight: 700; margin: 0; }
              .add-btn { background: rgba(10, 132, 255, 0.15); color: #0A84FF; border: none; padding: 8px 14px; border-radius: 20px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.1s;}
              .add-btn:active { transform: scale(0.95); }
              
              .site-list { display: flex; flex-direction: column; gap: 12px; }
              .site-card { background-color: #1C1C1E; border-radius: 14px; padding: 16px; display: flex; justify-content: space-between; align-items: center; transition: opacity 0.3s; }
              .pressing { opacity: 0.4; transform: scale(0.98); }
              
              .site-info { display: flex; align-items: center; gap: 12px; overflow: hidden; flex-grow: 1; cursor: pointer; user-select: none; -webkit-user-select: none; }
              .icon-globe { width: 20px; height: 20px; color: #0A84FF; flex-shrink: 0; }
              .site-name { font-size: 16px; font-weight: 500; color: #F2F2F7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text !important; -webkit-user-select: text !important;}
              
              .action-btns { display: flex; gap: 8px; align-items: center; }
              .edit-btn { background: #2C2C2E; color: #fff; border: none; padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; }
              .edit-btn:active { background: #3A3A3C; }
              .visit-btn { background-color: #0A84FF; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; }
              .visit-btn:active { transform: scale(0.96); background-color: #007AFF; }
              
              /* Modal Styles */
              .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(5px); z-index: 999; display: none; align-items: center; justify-content: center; }
              .modal-content { background: #1C1C1E; width: 90%; max-width: 350px; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
              .modal-header { display: flex; justify-content: space-between; margin-bottom: 20px; align-items: center;}
              .modal-header h3 { margin: 0; font-size: 18px; color: #fff;}
              .close-btn { background: none; border: none; color: #FF453A; font-size: 15px; cursor: pointer; font-weight: bold; padding: 5px;}
              
              .pass-list { max-height: 200px; overflow-y: auto; margin-bottom: 15px; }
              .pass-item { display: flex; justify-content: space-between; background: #2C2C2E; padding: 12px; border-radius: 10px; margin-bottom: 8px; align-items: center; }
              .pass-del { background: none; border: none; color: #FF453A; cursor: pointer; font-size: 16px; padding: 5px;}
              
              .add-form input { width: 100%; background: #2C2C2E; border: 1px solid #38383A; color: #fff; padding: 12px; border-radius: 8px; margin-bottom: 10px; box-sizing: border-box; font-size: 15px;}
              .add-form input:focus { outline: none; border-color: #0A84FF; }
              .add-form button { width: 100%; background: #30D158; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px;}
              .add-form button:active { background: #28B44A; }
          </style>
      </head>
      <body>
          <div class="app-container">
              <div class="header">
                  <h1>Platforms</h1>
                  <button class="add-btn" onclick="addSite()">+ Add Site</button>
              </div>
              <div class="site-list" id="site-list">
                 <p style="text-align:center; color:#888; font-style: italic;">Loading Data Vault...</p>
              </div>
          </div>

          <div class="modal-overlay" id="pass-modal">
              <div class="modal-content">
                  <div class="modal-header">
                      <h3 id="modal-title">Manage Passwords</h3>
                      <button class="close-btn" onclick="closeModal()">Close</button>
                  </div>
                  <div class="pass-list" id="pass-list"></div>
                  <div class="add-form">
                      <input type="text" id="new-user" placeholder="Enter Username">
                      <input type="password" id="new-pass" placeholder="Enter Password">
                      <button onclick="savePassword()">Save Credential</button>
                  </div>
              </div>
          </div>

          <script>
              let vaultDB = {};
              let currentEditingSite = '';

              async function loadData() {
                  try {
                      const res = await fetch('/__portal_api/data');
                      vaultDB = await res.json();
                      renderSites();
                  } catch(e) {
                      document.getElementById('site-list').innerHTML = '<p style="text-align:center; color:#FF453A;">Error loading database!</p>';
                  }
              }

              async function syncData() {
                  await fetch('/__portal_api/data', { method: 'POST', body: JSON.stringify(vaultDB) });
                  renderSites();
              }

              function renderSites() {
                  const list = document.getElementById('site-list');
                  list.innerHTML = '';
                  
                  if(Object.keys(vaultDB).length === 0) {
                      list.innerHTML = '<p style="text-align:center; color:#888;">No sites added yet.</p>';
                      return;
                  }

                  for (let site in vaultDB) {
                      const displayName = site.replace(/^ag\\./i, '');
                      list.innerHTML += \`
                      <div class="site-card">
                          <div class="site-info" 
                               onmousedown="startPress('\${site}', this)" 
                               onmouseup="cancelPress(this)" 
                               onmouseleave="cancelPress(this)" 
                               ontouchstart="startPress('\${site}', this)" 
                               ontouchend="cancelPress(this)">
                              <svg class="icon-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line></svg>
                              <span class="site-name">\${displayName}</span>
                          </div>
                          <div class="action-btns">
                              <button class="edit-btn" onclick="openModal('\${site}')" title="Manage Passwords">🔑</button>
                              <button class="visit-btn" onclick="setTarget('\${site}')">GO ➔</button>
                          </div>
                      </div>\`;
                  }
              }

              function addSite() {
                  let site = prompt("Enter domain name (e.g., ag.example.com):");
                  if (site) {
                      site = site.trim().toLowerCase();
                      if (!vaultDB[site]) {
                          vaultDB[site] = {};
                          syncData();
                      } else {
                          alert("Site already exists!");
                      }
                  }
              }

              // Long Press Delete Logic (3 Seconds)
              let pressTimer;
              function startPress(site, el) {
                  el.parentElement.classList.add('pressing');
                  pressTimer = setTimeout(() => {
                      el.parentElement.classList.remove('pressing');
                      if(confirm("Are you sure you want to delete this site: " + site + "?")) {
                          delete vaultDB[site];
                          syncData();
                      }
                  }, 3000);
              }
              function cancelPress(el) { 
                  clearTimeout(pressTimer); 
                  el.parentElement.classList.remove('pressing'); 
              }

              function setTarget(site) {
                  document.cookie = "active_target=" + site + "; path=/;";
                  sessionStorage.setItem("proxy_session_active", "true");
                  window.location.href = "/";
              }

              // Modal Logic for Password Manager
              function openModal(site) {
                  currentEditingSite = site;
                  document.getElementById('modal-title').innerText = site.replace(/^ag\\./i, '');
                  renderPasswords();
                  document.getElementById('pass-modal').style.display = 'flex';
              }
              function closeModal() { 
                  document.getElementById('pass-modal').style.display = 'none'; 
                  document.getElementById('new-user').value = '';
                  document.getElementById('new-pass').value = '';
              }
              
              function renderPasswords() {
                  const pList = document.getElementById('pass-list');
                  pList.innerHTML = '';
                  const accounts = vaultDB[currentEditingSite] || {};
                  
                  if(Object.keys(accounts).length === 0) {
                       pList.innerHTML = '<div style="text-align:center; color:#8E8E93; font-size:14px; padding:10px;">No credentials saved yet.</div>';
                  } else {
                      for (let user in accounts) {
                          pList.innerHTML += \`
                          <div class="pass-item">
                              <div style="color: #fff; font-size: 15px;"><strong>\${user}</strong> <span style="color:#8E8E93; font-size:12px; margin-left: 5px;">(••••)</span></div>
                              <button class="pass-del" onclick="deletePass('\${user}')" title="Delete">✖</button>
                          </div>\`;
                      }
                  }
              }

              function savePassword() {
                  const u = document.getElementById('new-user').value.trim();
                  const p = document.getElementById('new-pass').value.trim();
                  if (u && p) {
                      vaultDB[currentEditingSite][u] = p;
                      document.getElementById('new-user').value = '';
                      document.getElementById('new-pass').value = '';
                      syncData();
                      renderPasswords();
                  } else {
                      alert("Please enter both username and password!");
                  }
              }

              function deletePass(user) {
                  if(confirm("Delete credential for user: " + user + "?")) {
                      delete vaultDB[currentEditingSite][user];
                      syncData();
                      renderPasswords();
                  }
              }

              // Load data on start
              window.onload = loadData;
          </script>
      </body>
      </html>
      `;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
};

