(function(){
  const API = 'https://selluminate-tracker.onrender.com'; // ← replace after deploy
  const CMT = {
    startTime: Date.now(),
    sessionId: null,
    pageTitle: document.title,
    pageUrl: window.location.href,
    clickLog: {},
    hbTimer: null,

    getSession() {
      let s = sessionStorage.getItem('smt_sid');
      if (!s) { s = 'smt_' + Math.random().toString(36).substr(2,12) + '_' + Date.now(); sessionStorage.setItem('smt_sid', s); }
      return s;
    },
    getDevice() { const w = window.innerWidth; return w <= 767 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop'; },
    getUTM() { const p = new URLSearchParams(location.search); return { source: p.get('utm_source')||'', medium: p.get('utm_medium')||'', campaign: p.get('utm_campaign')||'', content: p.get('utm_content')||'' }; },
    getReferrerSource() {
      const r = document.referrer;
      if (!r) return 'direct';
      const map = [['google','google'],['reddit','reddit'],['facebook','facebook'],['twitter','twitter'],['x.com','twitter'],['linkedin','linkedin'],['youtube','youtube'],['bing','bing']];
      for (const [k,v] of map) if (r.includes(k)) return v;
      return 'other';
    },
    getScroll() { return Math.min(100, Math.round((window.scrollY / (Math.max(document.body.scrollHeight - window.innerHeight, 1))) * 100)); },
    getTime() { return Math.round((Date.now() - this.startTime) / 1000); },

    send(endpoint, data) {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      if (navigator.sendBeacon) { navigator.sendBeacon(API + endpoint, blob); }
      else { fetch(API + endpoint, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {}); }
    },

    heartbeat() {
      fetch(API + '/api/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ session_id: this.sessionId, current_page: this.pageUrl, current_page_title: this.pageTitle }),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true
      }).catch(() => {});
    },

    init() {
      this.sessionId = this.getSession();
      const u = this.getUTM();
      this.send('/api/visit', {
        session_id: this.sessionId, device_type: this.getDevice(),
        screen_width: screen.width, screen_height: screen.height,
        referrer: document.referrer, referrer_source: this.getReferrerSource(),
        utm_source: u.source, utm_medium: u.medium, utm_campaign: u.campaign, utm_content: u.content,
        landing_page: this.pageUrl, current_page: this.pageUrl, current_page_title: this.pageTitle
      });
      this.send('/api/event', { session_id: this.sessionId, event_type: 'pageview', page_url: this.pageUrl, page_title: this.pageTitle, scroll_depth: 0, time_on_page: 0, viewport_w: window.innerWidth, viewport_h: window.innerHeight });

      setTimeout(() => this.heartbeat(), 2000);
      this.hbTimer = setInterval(() => this.heartbeat(), 15000);

      this.trackClicks();
      this.trackScroll();
      this.trackForms();
      this.trackCopy();
      this.trackExit();
      this.trackBackButton();
    },

    trackClicks() {
      document.addEventListener('click', e => {
        const el = e.target.closest('a,button,[data-track]') || e.target;
        const key = (el.innerText || el.href || el.tagName).substr(0, 50);
        const now = Date.now();
        if (!this.clickLog[key]) this.clickLog[key] = [];
        this.clickLog[key] = this.clickLog[key].filter(t => now - t < 2000);
        this.clickLog[key].push(now);
        const isRage = this.clickLog[key].length >= 3;
        this.send('/api/event', {
          session_id: this.sessionId, event_type: isRage ? 'rage_click' : 'click',
          page_url: this.pageUrl, page_title: this.pageTitle,
          element_tag: el.tagName, element_text: (el.innerText || el.value || '').substr(0, 200),
          element_href: el.href || '', click_x: e.clientX, click_y: e.clientY,
          viewport_w: window.innerWidth, viewport_h: window.innerHeight,
          scroll_depth: this.getScroll(), time_on_page: this.getTime()
        });
      });
    },

    trackScroll() {
      let reported = [];
      window.addEventListener('scroll', () => {
        const p = this.getScroll();
        [25, 50, 75, 90, 100].forEach(m => {
          if (p >= m && !reported.includes(m)) {
            reported.push(m);
            this.send('/api/event', { session_id: this.sessionId, event_type: 'scroll_depth', page_url: this.pageUrl, scroll_depth: m, time_on_page: this.getTime() });
          }
        });
      }, { passive: true });
    },

    trackForms() {
      document.querySelectorAll('input,textarea,select').forEach(f => {
        f.addEventListener('focus', () => this.send('/api/event', { session_id: this.sessionId, event_type: 'form_focus', page_url: this.pageUrl, element_tag: f.tagName, element_text: f.name || f.placeholder || f.id || '', time_on_page: this.getTime() }));
        f.addEventListener('blur', () => this.send('/api/event', { session_id: this.sessionId, event_type: 'form_blur', page_url: this.pageUrl, element_tag: f.tagName, element_text: f.name || f.placeholder || f.id || '', extra_data: JSON.stringify({ filled: f.value && f.value.length > 0 ? 1 : 0 }), time_on_page: this.getTime() }));
      });
    },

    trackCopy() {
      document.addEventListener('copy', () => {
        const sel = (window.getSelection() || '').toString().substr(0, 100);
        this.send('/api/event', { session_id: this.sessionId, event_type: 'copy', page_url: this.pageUrl, element_text: sel, time_on_page: this.getTime() });
      });
    },

    trackExit() {
      window.addEventListener('beforeunload', () => {
        clearInterval(this.hbTimer);
        this.send('/api/event', { session_id: this.sessionId, event_type: 'exit', page_url: this.pageUrl, scroll_depth: this.getScroll(), time_on_page: this.getTime() });
        this.send('/api/exit', { session_id: this.sessionId, exit_page: this.pageUrl, total_time: this.getTime() });
      });
    },

    trackBackButton() {
      window.addEventListener('pageshow', e => {
        if (e.persisted) this.send('/api/event', { session_id: this.sessionId, event_type: 'back_navigation', page_url: this.pageUrl, time_on_page: this.getTime() });
      });
    }
  };
  CMT.init();
})();
