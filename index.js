export default {
    async fetch(request) {
        const url = new URL(request.url);
        const myDomain = url.hostname;

        const cookieHeader = request.headers.get('Cookie') || '';
        const match = cookieHeader.match(/active_target=([^;]+)/);
        let targetSite = match ? match[1] : null;

        // পোর্টালে ফিরে যাওয়ার কমান্ড (url.com/reset)
        if (url.pathname === '/reset') {
            return new Response('Going back to portal...', {
                status: 302,
                headers: {
                    'Location': '/',
                    'Set-Cookie': 'active_target=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
                }
            });
        }

        // টার্গেট না থাকলে পোর্টাল লোড হবে
        if (!targetSite) {
            return this.servePortal();
        }

        // ==========================================
        // রিভার্স প্রক্সি লজিক
        // ==========================================
        url.hostname = targetSite;
        
        const newRequest = new Request(url.toString(), new Request(request, {
            redirect: 'manual' 
        }));
        
        newRequest.headers.set('Host', targetSite);
        newRequest.headers.set('Origin', `https://${targetSite}`);
        newRequest.headers.set('Referer', `https://${targetSite}${url.pathname}`);
        
        const response = await fetch(newRequest);
        let newResponse = new Response(response.body, response);
        
        const location = newResponse.headers.get('location');
        if (location) {
            newResponse.headers.set('location', location.replace(targetSite, myDomain));
        }
        
        const setCookies = newResponse.headers.get('set-cookie');
        if (setCookies) {
            newResponse.headers.set('set-cookie', setCookies.replace(new RegExp(targetSite, 'g'), myDomain));
        }

        return newResponse;
    },

    // ==========================================
    // ফ্রন্ট-এন্ড পোর্টাল ডিজাইন (টেক্সট কপি এনাবল করা হয়েছে)
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
                    /* টেক্সট কপি এনাবল করা হলো */
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
                
                .site-info { 
                    display: flex; align-items: center; gap: 12px; overflow: hidden; flex-grow: 1; 
                }
                
                .icon-globe { width: 20px; height: 20px; color: #0A84FF; flex-shrink: 0; user-select: none; }
                .site-name { 
                    font-size: 16px; font-weight: 500; color: #F2F2F7; white-space: nowrap; 
                    overflow: hidden; text-overflow: ellipsis;
                    /* নিশ্চিত করা হচ্ছে যেন টেক্সট কপি করা যায় */
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
                    document.cookie = "active_target=" + site + "; path=/;";
                    window.location.href = "/";
                }
            </script>
        </body>
        </html>
        `;

        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
}
