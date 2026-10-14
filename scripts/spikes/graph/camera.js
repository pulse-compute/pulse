/* Presentation-only viewport: no report data or graph semantics are changed. */
(function (root) {
  'use strict';
  root.PulseGraphCamera = function ({ viewport, graph, overview, zoomLabel, onZoom }) {
    const ns = 'http://www.w3.org/2000/svg';
    let scale = 1, width = 1, height = 1, frame, points = [], drag = null, pending = false;
    const shape = (name, attrs) => { const n = document.createElementNS(ns, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
    const colors = { mount: '#b7a1ff', middleware: '#61dcc9', route: '#72a7ff', error: '#f496a1', event: '#e8c681', root: '#4d8594' };
    function update() {
      pending = false;
      if (!frame) return;
      frame.setAttribute('x', viewport.scrollLeft / scale); frame.setAttribute('y', viewport.scrollTop / scale);
      frame.setAttribute('width', Math.min(width, viewport.clientWidth / scale)); frame.setAttribute('height', Math.min(height, viewport.clientHeight / scale));
    }
    function schedule() { if (!pending) { pending = true; requestAnimationFrame(update); } }
    function setZoom(value, anchor) {
      const next = Math.max(.005, Math.min(2, value));
      const point = anchor || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
      const x = (viewport.scrollLeft + point.x) / scale, y = (viewport.scrollTop + point.y) / scale;
      scale = next; graph.style.zoom = scale;
      viewport.scrollLeft = x * scale - point.x; viewport.scrollTop = y * scale - point.y;
      zoomLabel.textContent = (scale < .1 ? (scale * 100).toFixed(1) : Math.round(scale * 100)) + '%';
      onZoom(scale); schedule();
    }
    function fit() {
      if (!points.length) return;
      const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
      const right = Math.max(...points.map(p => p.x + p.w)), bottom = Math.max(...points.map(p => p.y + p.h));
      setZoom(Math.min(1, (viewport.clientWidth - 32) / (right - left + 32), (viewport.clientHeight - 32) / (bottom - top + 32)));
      viewport.scrollLeft = Math.max(0, (left + right) / 2 * scale - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, (top + bottom) / 2 * scale - viewport.clientHeight / 2); schedule();
    }
    function refresh() {
      width = parseFloat(graph.style.width) || 1; height = parseFloat(graph.style.height) || 1;
      points = [...graph.querySelectorAll('.node')].map(n => ({ x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight, selected: n.classList.contains('selected'), kind: Object.keys(colors).find(k => n.classList.contains(k)) }));
      overview.replaceChildren(); overview.setAttribute('viewBox', `0 0 ${width} ${height}`);
      for (const p of points) overview.append(shape('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 6, fill: p.selected ? '#e7fff9' : colors[p.kind] || '#50698e' }));
      frame = shape('rect', { class: 'map-frame', fill: '#61dcc91a', stroke: '#61dcc9', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }); overview.append(frame);
      overview.closest('.minimap').hidden = !points.length; update();
    }
    function center(node) {
      if (!node) return;
      viewport.scrollLeft = (node.offsetLeft + node.offsetWidth / 2) * scale - viewport.clientWidth / 2;
      viewport.scrollTop = (node.offsetTop + node.offsetHeight / 2) * scale - viewport.clientHeight / 2; schedule();
    }
    function reveal(node) {
      if (!node) return;
      const x = node.offsetLeft * scale, y = node.offsetTop * scale, w = node.offsetWidth * scale, h = node.offsetHeight * scale;
      if (x < viewport.scrollLeft || x + w > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = Math.max(0, x - (viewport.clientWidth - w) / 2);
      if (y < viewport.scrollTop || y + h > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = Math.max(0, y - (viewport.clientHeight - h) / 2);
      schedule();
    }
    viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    viewport.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); const rect = viewport.getBoundingClientRect();
      setZoom(scale * Math.exp(-event.deltaY * .003), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });
    viewport.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button,a,input,select')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.setPointerCapture(event.pointerId); viewport.classList.add('panning'); event.preventDefault();
    });
    viewport.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      viewport.scrollLeft = drag.left - event.clientX + drag.x; viewport.scrollTop = drag.top - event.clientY + drag.y;
    });
    const stop = () => { drag = null; viewport.classList.remove('panning'); };
    viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop); viewport.addEventListener('lostpointercapture', stop);
    overview.addEventListener('click', event => {
      const rect = overview.getBoundingClientRect(), ratio = Math.min(rect.width / width, rect.height / height);
      const x = (event.clientX - rect.left - (rect.width - width * ratio) / 2) / ratio;
      const y = (event.clientY - rect.top - (rect.height - height * ratio) / 2) / ratio;
      viewport.scrollLeft = x * scale - viewport.clientWidth / 2; viewport.scrollTop = y * scale - viewport.clientHeight / 2; schedule();
    });
    overview.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-120, 0], ArrowRight: [120, 0], ArrowUp: [0, -120], ArrowDown: [0, 120] }[event.key];
      if (delta) { event.preventDefault(); viewport.scrollBy(...delta); }
      if (event.key === 'Home') { event.preventDefault(); fit(); }
    });
    return { setZoom, fit, refresh, reveal, center, get scale() { return scale; } };
  };
})(globalThis);
