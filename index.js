export default {
  async fetch(request, env, ctx) {
    if (!env.PORTAL_DB) {
        return new Response("Error: KV Namespace 'PORTAL_DB' is not bound.", { status: 500 });
    }

    const url = new URL(request.url);

    // ==========================================
    // 🔐 API রাউটিং (সাইট এবং পাসওয়ার্ড সেভ করার জন্য)
    // ==========================================
    if (url.pathname === '/__portal_api/data') {
        if (request.method === 'GET') {
            let data = await env.PORTAL_DB.get('portal_vault', 'json');
            if (!data) {
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

    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/active_target=([^;]+)/);
    let targetSite = match ? match[1] : null;

    if (url.pathname === '/reset') {
        return new Response('Going back to portal...', {
            status: 302, headers: { 'Location': '/', 'Set-Cookie': 'active_target=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT' }
        });
    }

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
              try { let reqUrl = args[0]; if (typeof reqUrl === 'string' && shouldIntercept(reqUrl)) { args[0] = proxyPrefix + reqUrl; } else if (reqUrl instanceof Request && shouldIntercept(reqUrl.url)) { args[0] = new Request(proxyPrefix + reqUrl.url, reqUrl); } } catch(e) {}
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

                window.__SERVER_VAULT__ = ${JSON.stringify(vaultData)};

                // 🔐 আল্ট্রা-প্রিমিয়াম ব্লার পপআপ অটোফিল 🔐
                setTimeout(function() {
                    const currentTargetSite = '${targetSite}';
                    const userInp = document.querySelector('#userid') || document.querySelector('input[type="text"]');
                    const passInp = document.querySelector('#password') || document.querySelector('input[type="password"]');
                    
                    if(userInp && passInp) {
                        userInp.setAttribute('autocomplete', 'off'); passInp.setAttribute('autocomplete', 'new-password');

                        // Full width blur overlay
                        const modalOverlay = document.createElement('div');
                        modalOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); backdrop-filter:blur(8px); z-index:999999; display:none; align-items:center; justify-content:center; padding: 0 10px; box-sizing: border-box;';
                        
                        const modalContent = document.createElement('div');
                        modalContent.style.cssText = 'background:#1C1C1E; width:100%; max-width:400px; border-radius:16px; box-shadow:0 10px 40px rgba(0,0,0,0.6); overflow:hidden; font-family:-apple-system, sans-serif; display:flex; flex-direction:column; border: 1px solid #38383A;';
                        
                        modalOverlay.appendChild(modalContent);
                        document.body.appendChild(modalOverlay);

                        userInp.addEventListener('focus', function(e) {
                            let accounts = window.__SERVER_VAULT__[currentTargetSite] || {};
                            if(Object.keys(accounts).length > 0) {
                                e.preventDefault();
                                userInp.blur(); // Hide keyboard to show modal nicely
                                
                                modalContent.innerHTML = '<div style="padding:16px 20px; font-size:16px; color:#fff; background:#2C2C2E; border-bottom:1px solid #38383A; font-weight:600; display:flex; justify-content:space-between; align-items:center;"><span>Select Account</span><span id="close-autofill" style="color:#FF453A; cursor:pointer; font-size:14px; font-weight:bold;">Close</span></div>';
                                
                                let listContainer = document.createElement('div');
                                listContainer.style.cssText = 'max-height:300px; overflow-y:auto; padding:12px;';
                                
                                for(let user in accounts) {
                                    let item = document.createElement('div');
                                    item.style.cssText = 'padding:14px 16px; margin-bottom:8px; border-radius:12px; font-size:16px; color:#FFFFFF; background:#2C2C2E; display:flex; align-items:center; cursor:pointer; border:1px solid #38383A; transition:background 0.2s;';
                                    item.innerHTML = '<svg style="width:20px;height:20px;margin-right:12px;color:#0A84FF;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>' + user;
                                    
                                    item.onclick = function() { userInp.value = user; passInp.value = accounts[user]; modalOverlay.style.display = 'none'; };
                                    listContainer.appendChild(item);
                                }
                                modalContent.appendChild(listContainer);
                                modalOverlay.style.display = 'flex';
                                
                                document.getElementById('close-autofill').onclick = () => modalOverlay.style.display = 'none';
                            }
                        });
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
  // ফ্রন্ট-এন্ড পোর্টাল ডিজাইন (Pro SVG UI)
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
              body { background-color: #000000; color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; user-select: text !important; -webkit-tap-highlight-color: transparent;}
              .app-container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; margin-top: 10px; }
              h1 { font-size: 28px; font-weight: 700; margin: 0; }
              .add-btn { background: rgba(10, 132, 255, 0.15); color: #0A84FF; border: none; padding: 8px 14px; border-radius: 20px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.1s; display: flex; align-items: center; gap: 4px;}
              .add-btn:active { transform: scale(0.95); }
              
              .site-list { display: flex; flex-direction: column; gap: 12px; }
              .site-card { background-color: #1C1C1E; border-radius: 14px; padding: 16px; display: flex; justify-content: space-between; align-items: center; transition: opacity 0.3s; }
              .pressing { opacity: 0.4; transform: scale(0.98); }
              
              .site-info { display: flex; align-items: center; gap: 12px; overflow: hidden; flex-grow: 1; cursor: pointer; user-select: none; -webkit-user-select: none; }
              .icon-globe { width: 20px; height: 20px; color: #0A84FF; flex-shrink: 0; }
              .site-name { font-size: 16px; font-weight: 500; color: #F2F2F7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text !important; -webkit-user-select: text !important;}
              
              /* Premium Button Styles */
              .action-btns { display: flex; gap: 8px; align-items: center; }
              .icon-sm { width: 16px; height: 16px; flex-shrink: 0; }
              
              .edit-btn { background-color: #5E5CE6; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: transform 0.1s; }
              .edit-btn:active { transform: scale(0.96); background-color: #4B49B8; }
              
              .visit-btn { background-color: #0A84FF; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: transform 0.1s; }
              .visit-btn:active { transform: scale(0.96); background-color: #007AFF; }
              
              /* Modal Styles */
              .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(5px); z-index: 999; display: none; align-items: center; justify-content: center; }
              .modal-content { background: #1C1C1E; width: 90%; max-width: 350px; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
              .modal-header { display: flex; justify-content: space-between; margin-bottom: 20px; align-items: center;}
              .modal-header h3 { margin: 0; font-size: 18px; color: #fff;}
              .close-btn { background: none; border: none; color: #FF453A; font-size: 15px; cursor: pointer; font-weight: bold; padding: 5px;}
              
              .pass-list { max-height: 200px; overflow-y: auto; margin-bottom: 15px; }
              .pass-item { display: flex; justify-content: space-between; background: #2C2C2E; padding: 12px; border-radius: 10px; margin-bottom: 8px; align-items: center; border: 1px solid #38383A;}
              .pass-actions { display: flex; gap: 10px; }
              .action-icon { background: none; border: none; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;}
              .action-icon:active { opacity: 0.5; }
              
              .add-form input { width: 100%; background: #2C2C2E; border: 1px solid #38383A; color: #fff; padding: 12px; border-radius: 8px; margin-bottom: 10px; box-sizing: border-box; font-size: 15px;}
              .add-form input:focus { outline: none; border-color: #0A84FF; }
              .add-form button { width: 100%; background: #30D158; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px; transition: transform 0.1s;}
              .add-form button:active { background: #28B44A; transform: scale(0.98);}
          </style>
      </head>
      <body>
          <div class="app-container">
              <div class="header">
                  <h1>Platforms</h1>
                  <button class="add-btn" onclick="addSite()">
                      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add Site
                  </button>
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
                      <input type="hidden" id="old-user">
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
                              <button class="edit-btn" onclick="openModal('\${site}')">
                                  <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                  Edit
                              </button>
                              <button class="visit-btn" onclick="setTarget('\${site}')">
                                  <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                  Visit
                              </button>
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

              // Long Press Delete Logic (১.৫ সেকেন্ড)
              let pressTimer;
              function startPress(site, el) {
                  el.parentElement.classList.add('pressing');
                  pressTimer = setTimeout(() => {
                      el.parentElement.classList.remove('pressing');
                      if(confirm("Are you sure you want to delete this site: " + site + "?")) {
                          delete vaultDB[site];
                          syncData();
                      }
                  }, 1500); // Changed to 1.5 Seconds
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

              function openModal(site) {
                  currentEditingSite = site;
                  document.getElementById('modal-title').innerText = site.replace(/^ag\\./i, '');
                  renderPasswords();
                  document.getElementById('pass-modal').style.display = 'flex';
              }
              
              function closeModal() { 
                  document.getElementById('pass-modal').style.display = 'none'; 
                  document.getElementById('old-user').value = '';
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
                              <div style="color: #fff; font-size: 15px; display:flex; align-items:center;">
                                  <svg style="width:16px;height:16px;margin-right:8px;color:#0A84FF;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                  <strong>\${user}</strong> <span style="color:#8E8E93; font-size:12px; margin-left: 6px;">(••••)</span>
                              </div>
                              <div class="pass-actions">
                                  <button class="action-icon" onclick="editPass('\${user}', '\${accounts[user]}')" title="Edit">
                                      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="#30D158" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                  </button>
                                  <button class="action-icon" onclick="deletePass('\${user}')" title="Delete">
                                      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="#FF453A" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                  </button>
                              </div>
                          </div>\`;
                      }
                  }
              }

              // Load data into inputs for editing
              function editPass(user, pass) {
                  document.getElementById('old-user').value = user;
                  document.getElementById('new-user').value = user;
                  document.getElementById('new-pass').value = pass;
                  document.getElementById('new-user').focus();
              }

              function savePassword() {
                  const oldUser = document.getElementById('old-user').value;
                  const u = document.getElementById('new-user').value.trim();
                  const p = document.getElementById('new-pass').value.trim();
                  
                  if (u && p) {
                      // If username was changed during edit, delete the old one
                      if(oldUser && oldUser !== u) {
                          delete vaultDB[currentEditingSite][oldUser];
                      }
                      vaultDB[currentEditingSite][u] = p;
                      
                      document.getElementById('old-user').value = '';
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

              window.onload = loadData;
          </script>
      </body>
      </html>
      `;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
};
