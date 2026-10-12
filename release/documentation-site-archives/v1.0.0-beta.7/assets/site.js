(() => {
  'use strict';

  const documentElement = document.documentElement;
  const body = document.body;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function initNavigation() {
    const openButton = document.querySelector('[data-nav-open]');
    const closeButton = document.querySelector('[data-nav-close]');
    const overlay = document.querySelector('[data-nav-overlay]');
    const drawer = document.querySelector('[data-nav-drawer]');
    if (!openButton || !drawer) return;

    let returnFocus = openButton;
    drawer.inert = true;

    const focusableElements = () => [...drawer.querySelectorAll('a[href], button:not([disabled]), summary, select, input, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute('inert') && element.getClientRects().length > 0);

    const setOpen = (open, options = {}) => {
      if (open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : openButton;
      body.dataset.navOpen = open ? 'true' : 'false';
      openButton.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('aria-hidden', String(!open));
      drawer.inert = !open;
      if (open && closeButton) closeButton.focus();
      if (!open && options.restoreFocus !== false) returnFocus.focus({ preventScroll: true });
    };

    openButton.addEventListener('click', () => setOpen(true));
    if (closeButton) closeButton.addEventListener('click', () => setOpen(false));
    if (overlay) overlay.addEventListener('click', () => setOpen(false));
    drawer.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    window.addEventListener('keydown', (event) => {
      if (body.dataset.navOpen !== 'true') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === 'Tab') {
        const focusable = focusableElements();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 960 && body.dataset.navOpen === 'true') setOpen(false, { restoreFocus: false });
    });
  }

  function initSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    const source = body.dataset.searchIndex;
    if (!input || !results || !source) return;

    let entries = [];
    let loaded = false;
    let activeIndex = -1;

    async function load() {
      if (loaded) return entries;
      loaded = true;
      try {
        const response = await fetch(source, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`search index returned ${response.status}`);
        const value = await response.json();
        entries = Array.isArray(value.entries) ? value.entries : [];
      } catch (_) {
        entries = [];
      }
      return entries;
    }

    function hide() {
      results.hidden = true;
      results.innerHTML = '';
      activeIndex = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(next) {
      const links = [...results.querySelectorAll('[role="option"]')];
      if (!links.length) return;
      activeIndex = Math.max(0, Math.min(links.length - 1, next));
      for (const [index, link] of links.entries()) link.setAttribute('aria-selected', String(index === activeIndex));
      const active = links[activeIndex];
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }

    function scoreEntry(entry, query, terms) {
      const title = String(entry.title || '').toLowerCase();
      const section = String(entry.section || '').toLowerCase();
      const headings = Array.isArray(entry.headings) ? entry.headings.join(' ').toLowerCase() : '';
      const text = String(entry.text || '').toLowerCase();
      const haystack = `${title} ${section} ${headings} ${text}`;
      if (!terms.every((term) => haystack.includes(term))) return 0;
      let score = terms.length + (Number.isFinite(entry.priority) ? entry.priority : 0);
      if (title.includes(query)) score += 8;
      if (title.startsWith(query)) score += 4;
      if (section.includes(query)) score += 2;
      for (const term of terms) {
        if (title.includes(term)) score += 2;
        if (headings.includes(term)) score += 1;
      }
      return score;
    }

    async function search() {
      const query = input.value.trim().toLowerCase();
      if (!query) { hide(); return; }
      await load();
      const terms = query.split(/\s+/).filter(Boolean);
      const hits = entries
        .map((entry) => ({ entry, score: scoreEntry(entry, query, terms) }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || String(left.entry.title).localeCompare(String(right.entry.title)))
        .slice(0, 10);

      if (!hits.length) {
        results.innerHTML = '<div class="search-empty">No results in this release.</div>';
      } else {
        results.innerHTML = hits.map(({ entry }, index) => {
          const section = entry.section ? `${escapeHtml(entry.section)} · ` : '';
          return `<a id="search-result-${index}" class="search-result" role="option" aria-selected="false" href="${escapeHtml(entry.url)}"><strong>${escapeHtml(entry.title)}</strong><small>${section}${escapeHtml(entry.summary || '')}</small></a>`;
        }).join('');
      }
      activeIndex = -1;
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', search);
    input.addEventListener('focus', () => { if (input.value.trim()) search(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(activeIndex <= 0 ? 0 : activeIndex - 1);
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        const active = results.querySelector(`[id="search-result-${activeIndex}"]`);
        if (active) { event.preventDefault(); active.click(); }
      } else if (event.key === 'Escape') {
        hide();
        input.blur();
      }
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.search')) hide();
    });
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        input.focus();
      }
    });
  }

  function initVersionSelect() {
    const select = document.getElementById('version-select');
    if (!select) return;
    const basePath = body.dataset.basePath || '';
    const route = body.dataset.currentRoute || '';

    select.addEventListener('change', async () => {
      const segment = select.value;
      const root = `${basePath}/${segment}/`;
      let destination = root;
      try {
        const response = await fetch(`${root}search-index.json`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('version index unavailable');
        const value = await response.json();
        if (Array.isArray(value.entries) && value.entries.some((entry) => entry.route === route)) destination = `${root}${route}`;
      } catch (_) {
        destination = root;
      }
      window.location.assign(destination);
    });
  }

  function initCodeCopy() {
    if (!navigator.clipboard) return;
    for (const [index, block] of [...document.querySelectorAll('.docs-article pre')].entries()) {
      const code = block.querySelector('code');
      if (!code || block.querySelector('.copy-code')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', `Copy code block ${index + 1}`);
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code.textContent || '');
          button.textContent = 'Copied';
          window.setTimeout(() => { button.textContent = 'Copy'; }, 1400);
        } catch (_) {
          button.textContent = 'Unavailable';
        }
      });
      block.append(button);
    }
  }

  function initTableOfContents() {
    const links = [...document.querySelectorAll('[data-toc-link]')];
    if (!links.length || !('IntersectionObserver' in window)) return;
    const byId = new Map(links.map((link) => [decodeURIComponent(link.hash.slice(1)), link]));
    const headings = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    let active;
    const setActive = (id) => {
      if (id === active) return;
      active = id;
      for (const [candidate, link] of byId) link.dataset.active = String(candidate === id);
    };
    const observer = new IntersectionObserver((records) => {
      const visible = records.filter((record) => record.isIntersecting).sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-18% 0px -70% 0px', threshold: [0, 1] });
    for (const heading of headings) observer.observe(heading);
    if (headings[0]) setActive(headings[0].id);
  }


  documentElement.classList.add('site-ready');
  initNavigation();
  initSearch();
  initVersionSelect();
  initCodeCopy();
  initTableOfContents();
})();
