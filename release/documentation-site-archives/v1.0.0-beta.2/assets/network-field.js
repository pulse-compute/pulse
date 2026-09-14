'use strict';

document.addEventListener('DOMContentLoaded', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
( () => {

    function e(e, t, n) {
        return Math.max(t, Math.min(n, e))
    }
    function t(e, t, n) {
        return e + (t - e) * n
    }
    function n(e, t) {
        let n = e.x - t.x
          , r = e.y - t.y;
        return Math.sqrt(n * n + r * r)
    }
    function r(e, t) {
        let n = e.x - t.x
          , r = e.y - t.y;
        return n * n + r * r
    }
    function i(e) {
        return function() {
            let t = e += 1831565813;
            return t = Math.imul(t ^ t >>> 15, t | 1),
            t ^= t + Math.imul(t ^ t >>> 7, t | 61),
            ((t ^ t >>> 14) >>> 0) / 4294967296
        }
    }
    function a(e, t, n) {
        return t + (n - t) * e()
    }
    function o(e, t, n, r) {
        return e * n + t * r
    }
    function s(e, t) {
        return Math.sqrt(e * e + t * t) || 1
    }
    function c(e, t, n) {
        let r = 0;
        for (let n of e)
            r += Math.max(0, t(n));
        if (r <= 0)
            return e[Math.floor(n() * e.length)] || null;
        let i = n() * r;
        for (let n of e)
            if (i -= Math.max(0, t(n)),
            i <= 0)
                return n;
        return e[e.length - 1] || null
    }
    function l(e) {
        return e * e * (3 - 2 * e)
    }
    function u(e, t, n) {
        let r = Math.imul(e, 374761393) ^ Math.imul(t, 668265263) ^ n;
        return r = (r ^ r >>> 13) >>> 0,
        r = Math.imul(r, 1274126177) >>> 0,
        ((r ^ r >>> 16) >>> 0) / 4294967296
    }
    function d(e, n, r) {
        let i = Math.floor(e)
          , a = Math.floor(n)
          , o = i + 1
          , s = a + 1
          , c = l(e - i)
          , d = l(n - a)
          , f = u(i, a, r)
          , p = u(o, a, r)
          , m = u(i, s, r)
          , h = u(o, s, r);
        return t(t(f, p, c), t(m, h, c), d)
    }
    function f(e, t, n, r=4) {
        let i = 0
          , a = .5
          , o = 1
          , s = 0;
        for (let c = 0; c < r; c += 1)
            i += d(e * o, t * o, n + c * 1013) * a,
            s += a,
            a *= .5,
            o *= 2;
        return s ? i / s : 0
    }
    class p {
        constructor(e, t, n={}) {
            this.canvas = e,
            this.draw = t,
            this.ctx = e.getContext(`2d`, {
                alpha: !0,
                desynchronized: !0
            }),
            this.maxRatio = n.maxRatio || 2,
            this.minRatio = n.minRatio || 1,
            this.raf = 0,
            this.sizeKey = ``,
            this.running = !1,
            this.loop = this.loop.bind(this),
            this.resize = this.resize.bind(this),
            window.addEventListener(`resize`, this.resize, {
                passive: !0
            }),
            window.addEventListener(`orientationchange`, this.resize, {
                passive: !0
            }),
            window.addEventListener(`pageshow`, this.resize, {
                passive: !0
            }),
            document.addEventListener(`visibilitychange`, () => {
                document.hidden ? this.stop() : this.start()
            }
            )
        }
        resize(e=!1) {
            if (!this.ctx)
                return !1;
            let t = this.canvas.getBoundingClientRect()
              , n = Math.max(0, Math.round(t.width))
              , r = Math.max(0, Math.round(t.height));
            if (!n || !r)
                return !1;
            let i = Math.min(this.maxRatio, Math.max(this.minRatio, window.devicePixelRatio || 1))
              , a = Math.max(1, Math.round(n * i))
              , o = Math.max(1, Math.round(r * i))
              , s = `${a}x${o}@${i}`;
            return !e && s === this.sizeKey ? !0 : (this.canvas.width = a,
            this.canvas.height = o,
            this.canvas.style.width = n + `px`,
            this.canvas.style.height = r + `px`,
            this.ctx.setTransform(i, 0, 0, i, 0, 0),
            this.sizeKey = s,
            !0)
        }
        loop(e) {
            !this.running || !this.ctx || (this.resize() && this.draw({
                ctx: this.ctx,
                time: e,
                width: this.canvas.clientWidth,
                height: this.canvas.clientHeight
            }),
            this.raf = requestAnimationFrame(this.loop))
        }
        start() {
            this.running || !this.ctx || (this.running = !0,
            this.raf = requestAnimationFrame(this.loop))
        }
        stop() {
            this.running = !1,
            this.raf && cancelAnimationFrame(this.raf),
            this.raf = 0
        }
    }
    class m {
        constructor(e) {
            this.canvas = e,
            this.helper = new p(e,this.drawFrame.bind(this),{
                maxRatio: 2
            }),
            this.config = {
                "seed": Math.floor(Math.random() * 30000),
                "clusterCount": 20,
                "nodeCount": 1000,
                "scatterCount": 100,
                "bridgeCount": 22,
                "maxActivePulses": 20,
                "spawnRate": 100,
                "basePulseSpeed": 46,
                "pulseSpeedVariance": 50,
                "pulseTTLMin": 14,
                "pulseTTLMax": 24,
                "pulseHeadSize": 1.85,
                "pulseTailLength": 1000,
                "pulseTailDecay": 0.9,
                "pulseTailWidth": 1.4,
                "pulseTailGlow": 0.44,
                "pulseTailMinStep": 5,
                "pulseBranchChance": 0.7,
                "bridgeBias": 0.56,
                "idleEdgeOpacity": 0.1,
                "idleNodeOpacity": 0.18,
                "edgeGlow": 0.12,
                "nodeGlow": 0.22,
                "decay": 0.92,
                "pulseTrailDecay": 0.85,
                "hazeOpacity": 0.028,
                "gridColumns": 12,
                "gridRows": 6,
                "custerCount": 40
            },
            this.nodes = [],
            this.edges = [],
            this.adjacency = [],
            this.pulses = [],
            this.spawnAccumulator = 0,
            this.width = 0,
            this.height = 0,
            this.lastTime = 0,
            this.rng = i(this.config.seed),
            this.motionRng = i(this.config.seed ^ 2654435769),
            this.helper.start()
        }
        set(e={}) {
            return Object.assign(this.config, e),
            this.rng = i(this.config.seed),
            this.motionRng = i(this.config.seed ^ 2654435769),
            this.rebuild(!0),
            this.config
        }
        rebuild(e=!1) {
            !this.width || !this.height || (this.buildTopology(this.width, this.height),
            e && (this.pulses = [],
            this.spawnAccumulator = 0))
        }
        ensureTopology(e, t) {
            !e || !t || (!this.nodes.length || e !== this.width || t !== this.height) && (this.width = e,
            this.height = t,
            this.rebuild(!0))
        }
        buildTopology(t, o) {
            let s = this.config.seed + t * 17 + o * 13 >>> 0
              , c = i(s)
              , l = t * .035
              , d = o * .1
              , p = Math.max(1, t - l * 2)
              , m = Math.max(1, o - d * 2)
              , h = l + p * .5
              , g = d + m * .5
              , _ = p / m
              , v = Math.max(4, Math.ceil(Math.sqrt(this.config.clusterCount * Math.max(1, _) * 1.18)))
              , y = Math.max(3, Math.ceil(this.config.clusterCount / v))
              , b = p / v
              , x = m / y
              , S = [];
            for (let e = 0; e < y; e += 1)
                for (let t = 0; t < v; t += 1)
                    S.push({
                        row: e,
                        col: t
                    });
            for (let e = S.length - 1; e > 0; --e) {
                let t = Math.floor(c() * (e + 1));
                [S[e],S[t]] = [S[t], S[e]]
            }
            let C = S.slice(0, this.config.clusterCount).map( (e, t) => {
                let n = l + e.col * b
                  , r = d + e.row * x
                  , i = Math.min(b, x) * a(c, .72, 1.44)
                  , o = a(c, .72, 1.34);
                return {
                    id: t,
                    x: n + b * a(c, .18, .82),
                    y: r + x * a(c, .18, .82),
                    rx: i * o,
                    ry: i / o,
                    angle: c() * Math.PI * 2,
                    strength: a(c, .28, .62)
                }
            }
            )
              , w = (s ^ 2654435769) >>> 0
              , T = (e, t) => {
                let n = 0
                  , r = 1 / 0;
                for (let i = 0; i < C.length; i += 1) {
                    let a = C[i]
                      , o = e - a.x
                      , s = t - a.y
                      , c = o * o + s * s;
                    c < r && (r = c,
                    n = i)
                }
                return n
            }
              , E = (t, n) => {
                let r = .18;
                for (let e of C) {
                    let i = t - e.x
                      , a = n - e.y
                      , o = Math.cos(e.angle)
                      , s = Math.sin(e.angle)
                      , c = i * o + a * s
                      , l = -i * s + a * o
                      , u = c / e.rx
                      , d = l / e.ry
                      , f = u * u + d * d;
                    r += e.strength * Math.exp(-f * 2.6)
                }
                let i = f((t - l) / 210, (n - d) / 210, w, 4);
                r += (i - .5) * .24 + i * .08;
                let a = Math.abs(t - h) / (p * .5)
                  , o = Math.abs(n - g) / (m * .5);
                return r += .06 + Math.max(0, 1 - Math.max(a, o)) * .05,
                e(r, .03, 1)
            }
              , D = Math.max(32, this.config.nodeCount | 0)
              , O = p * m
              , k = Math.max(6.2, Math.sqrt(O / Math.max(1, D)) * .78)
              , A = []
              , j = (n, r) => {
                let a = i((s ^ (r + 1) * 73244475 ^ (n * 1e3 | 0)) >>> 0)
                  , c = n / Math.SQRT2
                  , u = Math.ceil(t / c)
                  , f = Math.ceil(o / c)
                  , h = Array(u * f).fill(null)
                  , g = []
                  , _ = []
                  , v = (e, t) => e + t * u
                  , y = (e, r, i=n) => {
                    if (e < l || r < d || e > t - l || r > o - d)
                        return !1;
                    let a = Math.floor(e / c)
                      , s = Math.floor(r / c)
                      , p = Math.max(2, Math.ceil(i / c) + 1);
                    for (let t = -p; t <= p; t += 1)
                        for (let n = -p; n <= p; n += 1) {
                            let o = a + n
                              , c = s + t;
                            if (o < 0 || c < 0 || o >= u || c >= f)
                                continue;
                            let l = h[v(o, c)];
                            if (!l)
                                continue;
                            let d = e - l.x
                              , p = r - l.y;
                            if (d * d + p * p < i * i)
                                return !1
                        }
                    return !0
                }
                  , b = (e, t) => {
                    let n = {
                        x: e,
                        y: t,
                        influence: E(e, t)
                    };
                    g.push(n),
                    _.push(n);
                    let r = Math.floor(e / c)
                      , i = Math.floor(t / c);
                    h[v(r, i)] = n
                }
                  , x = (t, n) => {
                    let r = e(.18 + E(t, n) ** 1.18 * .9, 0, 1);
                    return a() < r
                }
                  , S = (e=260) => {
                    for (let t = 0; t < e; t += 1) {
                        let e = l + a() * p
                          , t = d + a() * m;
                        if (y(e, t) && x(e, t))
                            return b(e, t),
                            !0
                    }
                    return !1
                }
                  , C = Math.max(8, Math.floor(this.config.clusterCount * .65))
                  , w = 0;
                for (; w < C && S(380); )
                    w += 1;
                for (; _.length > 0 && g.length < D * 1.08; ) {
                    let e = Math.floor(a() * _.length)
                      , t = _[e]
                      , r = !1;
                    for (let e = 0; e < 20; e += 1) {
                        let e = a() * Math.PI * 2
                          , i = n * (1 + a())
                          , o = t.x + Math.cos(e) * i
                          , s = t.y + Math.sin(e) * i;
                        if (y(o, s) && x(o, s) && (b(o, s),
                        r = !0,
                        g.length >= D * 1.08))
                            break
                    }
                    if (!r && (_.splice(e, 1),
                    _.length === 0 && g.length < D * .82)) {
                        let e = 0;
                        for (let t = 0; t < 10; t += 1)
                            S(260) && (e += 1);
                        if (!e)
                            break
                    }
                }
                let T = n * .9
                  , O = 0;
                for (; g.length < D && O < D * 18; ) {
                    O += 1;
                    let e = l + a() * p
                      , t = d + a() * m;
                    y(e, t, T) && x(e, t) && (b(e, t),
                    O > D * 10 && (T = n * .82))
                }
                return g
            }
            ;
            for (let e = 0; e < 5; e += 1)
                if (A = j(k, e),
                A.length > D * 1.06)
                    k *= 1.045;
                else if (A.length < D * .94)
                    k *= .955;
                else
                    break;
            A.length > D && (A = A.map( (e, t) => ({
                ...e,
                keep: u(e.x * 3 | 0, e.y * 3 | 0, w ^ t)
            })).sort( (e, t) => e.keep - t.keep).slice(0, D).sort( (e, t) => e.x - t.x || e.y - t.y)),
            this.nodes = A.map( (e, t) => {
                let n = T(e.x, e.y)
                  , r = e.influence > .72 ? a(c, .52, .82) : e.influence > .48 ? a(c, .34, .58) : a(c, .22, .4);
                return {
                    id: t,
                    x: e.x,
                    y: e.y,
                    radius: r,
                    heat: 0,
                    cluster: n,
                    influence: e.influence,
                    isScatter: e.influence < .34
                }
            }
            ),
            this.edges = [],
            this.adjacency = Array.from({
                length: this.nodes.length
            }, () => []);
            let M = new Set
              , N = (e, t, n={}) => {
                if (e === t)
                    return -1;
                let r = e < t ? `${e}:${t}` : `${t}:${e}`;
                if (M.has(r))
                    return -1;
                M.add(r);
                let i = this.edges.length
                  , a = {
                    a: e,
                    b: t,
                    heat: 0,
                    trail: 0,
                    use: 0,
                    isBridge: !!n.isBridge,
                    weight: n.weight || 1
                };
                return this.edges.push(a),
                this.adjacency[e].push({
                    to: t,
                    edgeIndex: i
                }),
                this.adjacency[t].push({
                    to: e,
                    edgeIndex: i
                }),
                i
            }
              , P = Math.max(k * 3.2, 26)
              , F = Array.from({
                length: this.nodes.length
            }, (e, t) => t).sort( (e, t) => {
                let n = this.nodes[e]
                  , r = this.nodes[t];
                return n.x + n.y * .61 - (r.x + r.y * .61)
            }
            );
            for (let t = 1; t < F.length; t += 1) {
                let r = F[t]
                  , i = this.nodes[r]
                  , a = []
                  , o = -1
                  , s = 1 / 0;
                for (let e = Math.max(0, t - 28); e < t; e += 1) {
                    let t = F[e]
                      , r = this.nodes[t]
                      , c = n(i, r);
                    if (c > P * 1.34)
                        continue;
                    let l = i.cluster === r.cluster
                      , u = c * (l ? .96 : 1.08) * (r.influence >= i.influence ? .94 : 1);
                    a.push({
                        id: t,
                        d: c,
                        sameCluster: l
                    }),
                    u < s && (s = u,
                    o = t)
                }
                if (o < 0)
                    for (let e = 0; e < t; e += 1) {
                        let t = F[e]
                          , r = this.nodes[t]
                          , a = n(i, r) * (i.cluster === r.cluster ? .98 : 1.05);
                        a < s && (s = a,
                        o = t)
                    }
                if (o >= 0) {
                    let e = this.nodes[o]
                      , t = n(i, e);
                    N(r, o, {
                        isBridge: i.cluster !== e.cluster && t > P * .9,
                        weight: 1
                    })
                }
                if (a.length) {
                    a.sort( (e, t) => e.d - t.d);
                    let t = e(.07 + i.influence * .2, .07, .28);
                    for (let e = 0; e < Math.min(5, a.length); e += 1) {
                        let n = a[e];
                        if (n.id === o)
                            continue;
                        let i = t * (e === 0 ? 1 : .62) * (n.sameCluster ? 1 : .54);
                        if (c() < i) {
                            N(r, n.id, {
                                isBridge: !n.sameCluster && n.d > P * .95,
                                weight: n.sameCluster ? .86 : 1.08
                            });
                            break
                        }
                    }
                }
            }
            let I = new Map;
            this.nodes.forEach(e => {
                I.has(e.cluster) || I.set(e.cluster, []),
                I.get(e.cluster).push(e.id)
            }
            );
            let L = C.map( (e, t) => {
                let n = I.get(t) || []
                  , i = n[0] || 0
                  , a = 1 / 0;
                for (let t of n) {
                    let n = this.nodes[t]
                      , o = r(n, e) / Math.max(.2, n.influence);
                    o < a && (a = o,
                    i = t)
                }
                return i
            }
            );
            for (let e = 0; e < L.length; e += 1) {
                let t = -1
                  , r = 1 / 0;
                for (let i = 0; i < L.length; i += 1) {
                    if (e === i)
                        continue;
                    let a = n(this.nodes[L[e]], this.nodes[L[i]]);
                    a < r && (r = a,
                    t = i)
                }
                t >= 0 && N(L[e], L[t], {
                    isBridge: !0,
                    weight: 1.3
                })
            }
            for (let e = 0; e < this.config.bridgeCount; e += 1) {
                let e = Math.floor(c() * L.length)
                  , t = Math.floor(c() * L.length);
                e === t && (t = (t + 1 + Math.floor(c() * Math.max(1, L.length - 1))) % L.length),
                N(L[e], L[t], {
                    isBridge: !0,
                    weight: 1.16
                })
            }
            for (let e = 0; e < this.nodes.length; e += 1) {
                if (this.adjacency[e].length)
                    continue;
                let t = -1
                  , r = 1 / 0;
                for (let i = 0; i < this.nodes.length; i += 1) {
                    if (e === i)
                        continue;
                    let a = n(this.nodes[e], this.nodes[i]);
                    a < r && (r = a,
                    t = i)
                }
                t >= 0 && N(e, t, {
                    weight: .9
                })
            }
        }
        spawnPulse(t=null, n={}) {
            if (this.pulses.length >= this.config.maxActivePulses || this.nodes.length < 2)
                return;
            let r = this.motionRng
              , i = t == null ? Math.floor(r() * this.nodes.length) : e(t, 0, this.nodes.length - 1)
              , o = this.adjacency[i];
            if (!o || !o.length)
                return;
            let s = c(o, ({edgeIndex: e}) => {
                let t = this.edges[e];
                return t && t.isBridge ? .55 : 1.2
            }
            , r);
            if (!s)
                return;
            let l = Math.max(18, this.config.basePulseSpeed + a(r, -this.config.pulseSpeedVariance, this.config.pulseSpeedVariance));
            this.pulses.push({
                currentNode: i,
                previousNode: -1,
                currentEdgeIndex: s.edgeIndex,
                progress: 0,
                speed: l,
                glow: n.glow || a(r, .58, .92),
                ttl: n.ttl || Math.floor(a(r, this.config.pulseTTLMin, this.config.pulseTTLMax + 1)),
                wantBridge: r() < this.config.bridgeBias,
                visited: new Set,
                age: 0,
                trail: []
            })
        }
        chooseNextHop(r, i) {
            let a = this.motionRng
              , l = this.adjacency[i];
            if (!l || !l.length)
                return null;
            let u = this.nodes[i]
              , d = r.previousNode >= 0 ? this.nodes[r.previousNode] : null;
            return c(l, ({to: i, edgeIndex: a}) => {
                let c = this.edges[a]
                  , l = this.nodes[i];
                if (!c || !l)
                    return 0;
                let f = c.isBridge ? .24 : 1;
                r.previousNode === i && (f *= .22),
                r.visited.has(a) && (f *= .58),
                c.use > 6 && (f *= .72),
                r.wantBridge ? f *= c.isBridge ? 2.25 : .64 : f *= c.isBridge ? .44 : 1,
                l.cluster === u.cluster ? f *= 1.08 : f *= c.isBridge ? 1.18 : .74;
                let p = Math.max(1, n(u, l));
                if (f *= e(58 / p, .45, 1.5),
                d) {
                    let n = u.x - d.x
                      , r = u.y - d.y
                      , i = l.x - u.x
                      , a = l.y - u.y
                      , c = o(n / s(n, r), r / s(n, r), i / s(i, a), a / s(i, a));
                    f *= t(.72, 1.34, e((c + 1) * .5, 0, 1))
                }
                return f
            }
            , a)
        }
        currentPulsePosition(e) {
            let n = this.edges[e.currentEdgeIndex];
            if (!n)
                return null;
            let r = e.currentNode
              , i = n.a === r ? n.b : n.a
              , a = this.nodes[r]
              , o = this.nodes[i];
            return !a || !o ? null : {
                x: t(a.x, o.x, e.progress),
                y: t(a.y, o.y, e.progress)
            }
        }
        pushPulseTrail(e, t, n) {
            let r = this.config.pulseTailMinStep
              , i = e.trail.length ? e.trail[e.trail.length - 1] : null;
            if (i) {
                let e = t - i.x
                  , a = n - i.y;
                if (e * e + a * a < r * r)
                    return
            }
            e.trail.push({
                x: t,
                y: n,
                age: 0
            });
            let a = Math.max(4, this.config.pulseTailLength | 0);
            e.trail.length > a && e.trail.splice(0, e.trail.length - a)
        }
        updatePulseTrail(e, t) {
            let n = Math.max(4, this.config.pulseTailLength | 0);
            e.trail.length > n && e.trail.splice(0, e.trail.length - n);
            for (let n = 0; n < e.trail.length; n += 1)
                e.trail[n].age += t
        }
        update(e) {
            for (let e of this.nodes)
                e.heat *= this.config.decay;
            for (let e of this.edges)
                e.heat *= this.config.decay,
                e.trail *= this.config.pulseTrailDecay,
                e.use *= .988;
            for (this.spawnAccumulator += e * this.config.spawnRate; this.spawnAccumulator >= 1 && (--this.spawnAccumulator,
            this.pulses.length < this.config.maxActivePulses); )
                this.spawnPulse();
            for (let t = this.pulses.length - 1; t >= 0; --t) {
                let r = this.pulses[t]
                  , i = this.edges[r.currentEdgeIndex];
                if (!i) {
                    this.pulses.splice(t, 1);
                    continue
                }
                let a = r.currentNode
                  , o = i.a === a ? i.b : i.a
                  , s = this.nodes[a]
                  , c = this.nodes[o];
                if (!s || !c) {
                    this.pulses.splice(t, 1);
                    continue
                }
                r.age += e,
                r.progress += r.speed * e / Math.max(1, n(s, c));
                let l = this.currentPulsePosition(r);
                if (l && this.pushPulseTrail(r, l.x, l.y),
                this.updatePulseTrail(r, e),
                r.visited.add(r.currentEdgeIndex),
                i.heat = Math.max(i.heat, .28 * r.glow),
                i.trail = Math.max(i.trail, .54 * r.glow),
                i.use += 1,
                s.heat = Math.max(s.heat, .06 * r.glow),
                c.heat = Math.max(c.heat, .06 * r.glow),
                r.progress < 1)
                    continue;
                if (c.heat = Math.max(c.heat, .46 * r.glow),
                i.heat = Math.max(i.heat, .46 * r.glow),
                r.progress = 0,
                r.previousNode = a,
                r.currentNode = o,
                this.pushPulseTrail(r, c.x, c.y),
                --r.ttl,
                r.ttl <= 0) {
                    this.pulses.splice(t, 1);
                    continue
                }
                this.pulses.length < this.config.maxActivePulses && this.motionRng() < this.config.pulseBranchChance * r.glow && this.spawnPulse(o, {
                    glow: r.glow * .78,
                    ttl: Math.max(4, Math.floor(r.ttl * .55))
                }),
                (i.isBridge || this.motionRng() < .12) && (r.wantBridge = !r.wantBridge);
                let u = this.chooseNextHop(r, o);
                if (!u) {
                    this.pulses.splice(t, 1);
                    continue
                }
                r.currentEdgeIndex = u.edgeIndex
            }
        }
        drawGrid(e, t, n) {
            e.save(),
            e.lineWidth = 1;
            for (let r = 0; r <= this.config.gridColumns; r += 1) {
                let i = r / this.config.gridColumns * t;
                e.strokeStyle = r % 2 == 0 ? `rgba(255,255,255,0.009)` : `rgba(255,255,255,0.005)`,
                e.beginPath(),
                e.moveTo(i + .5, 0),
                e.lineTo(i + .5, n),
                e.stroke()
            }
            for (let r = 0; r <= this.config.gridRows; r += 1) {
                let i = r / this.config.gridRows * n;
                e.strokeStyle = r % 2 == 0 ? `rgba(255,255,255,0.008)` : `rgba(255,255,255,0.004)`,
                e.beginPath(),
                e.moveTo(0, i + .5),
                e.lineTo(t, i + .5),
                e.stroke()
            }
            e.restore()
        }
        drawFrame({ctx: n, time: r, width: i, height: a}) {
            if (this.ensureTopology(i, a),
            !this.nodes.length)
                return;
            this.lastTime ||= r;
            let o = Math.min(.04, Math.max(.008, (r - this.lastTime) / 1e3));
            this.lastTime = r,
            this.update(o),
            n.clearRect(0, 0, i, a),
            this.drawGrid(n, i, a);
            let s = n.createRadialGradient(i * .74, a * .36, 0, i * .74, a * .36, Math.max(i, a) * .68);
            s.addColorStop(0, `rgba(255,77,79,${this.config.hazeOpacity})`),
            s.addColorStop(1, `rgba(255,77,79,0)`),
            n.fillStyle = s,
            n.fillRect(0, 0, i, a),
            n.save(),
            n.lineCap = `round`,
            n.lineJoin = `round`;
            for (let t of this.edges) {
                let r = this.nodes[t.a]
                  , i = this.nodes[t.b]
                  , a = e(t.heat + t.trail * .55, 0, 1)
                  , o = this.config.idleEdgeOpacity + a * this.config.edgeGlow;
                n.strokeStyle = t.isBridge ? `rgba(255,108,104,${o * 1.14})` : `rgba(255,92,92,${o})`,
                n.lineWidth = t.isBridge ? .75 : .56,
                n.beginPath(),
                n.moveTo(r.x, r.y),
                n.lineTo(i.x, i.y),
                n.stroke()
            }
            n.restore(),
            n.save(),
            n.lineCap = `round`,
            n.lineJoin = `round`;
            for (let t of this.pulses)
                if (t.trail && t.trail.length > 1) {
                    let r = t.trail.length
                      , i = e(this.config.pulseTailDecay, .5, .995);
                    for (let e = 1; e < r; e += 1) {
                        let a = t.trail[e - 1]
                          , o = t.trail[e]
                          , s = e / Math.max(1, r - 1)
                          , c = s * i ** (o.age * 60)
                          , l = this.config.pulseTailWidth * (.28 + s * .92);
                        n.strokeStyle = `rgba(255,128,118,${c * this.config.pulseTailGlow * t.glow})`,
                        n.lineWidth = l,
                        n.beginPath(),
                        n.moveTo(a.x, a.y),
                        n.lineTo(o.x, o.y),
                        n.stroke()
                    }
                }
            for (let e of this.pulses) {
                let r = this.edges[e.currentEdgeIndex];
                if (!r)
                    continue;
                let i = e.currentNode
                  , a = r.a === i ? r.b : r.a
                  , o = this.nodes[i]
                  , s = this.nodes[a]
                  , c = t(o.x, s.x, e.progress)
                  , l = t(o.y, s.y, e.progress)
                  , u = this.config.pulseHeadSize + e.glow * .22
                  , d = n.createRadialGradient(c, l, 0, c, l, u * 7.5);
                d.addColorStop(0, `rgba(255,130,122,${.32 * e.glow})`),
                d.addColorStop(.35, `rgba(255,86,82,${.14 * e.glow})`),
                d.addColorStop(1, `rgba(255,86,82,0)`),
                n.fillStyle = d,
                n.beginPath(),
                n.arc(c, l, u * 7.5, 0, Math.PI * 2),
                n.fill(),
                n.fillStyle = `rgba(255,210,204,${.76 * e.glow})`,
                n.beginPath(),
                n.arc(c, l, u, 0, Math.PI * 2),
                n.fill()
            }
            n.restore(),
            n.save();
            for (let t of this.nodes) {
                let r = e(t.heat, 0, 1);
                if (r > .025) {
                    let e = n.createRadialGradient(t.x, t.y, 0, t.x, t.y, 8 + r * 10);
                    e.addColorStop(0, `rgba(255,96,96,${r * .12})`),
                    e.addColorStop(1, `rgba(255,96,96,0)`),
                    n.fillStyle = e,
                    n.beginPath(),
                    n.arc(t.x, t.y, 8 + r * 10, 0, Math.PI * 2),
                    n.fill()
                }
                n.fillStyle = `rgba(255,221,214,${this.config.idleNodeOpacity + r * this.config.nodeGlow})`,
                n.beginPath(),
                n.arc(t.x, t.y, t.radius + r * .45, 0, Math.PI * 2),
                n.fill()
            }
            n.restore()
        }
    }
    let h = document.getElementById('networkField');
    if (h) {
        const field = new m(h);
        const toggle = document.querySelector('[data-hero-motion-toggle]');
        const label = toggle?.querySelector('[data-hero-motion-label]');
        let userPaused = false;
        let inViewport = true;

        const syncMotion = () => {
            const shouldRun = !userPaused && inViewport && !document.hidden;
            shouldRun ? field.helper.start() : field.helper.stop();
            if (toggle) {
                toggle.hidden = false;
                toggle.setAttribute('aria-pressed', String(userPaused));
                toggle.setAttribute('aria-label', userPaused ? 'Resume hero animation' : 'Pause hero animation');
            }
            if (label) label.textContent = userPaused ? 'Resume motion' : 'Pause motion';
        };

        toggle?.addEventListener('click', () => {
            userPaused = !userPaused;
            syncMotion();
        });

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                inViewport = entries.some((entry) => entry.isIntersecting);
                syncMotion();
            }, { rootMargin: '120px 0px', threshold: 0.01 });
            observer.observe(h);
        }

        document.addEventListener('visibilitychange', syncMotion);
        syncMotion();

        window.NetworkField = {
            config: field.config,
            set(value={}) {
                return field.set(value)
            },
            pause() {
                userPaused = true;
                syncMotion()
            },
            resume() {
                userPaused = false;
                syncMotion()
            },
            get paused() {
                return userPaused
            },
            instance: field
        }
    }
}
)();
}, { once: true});
