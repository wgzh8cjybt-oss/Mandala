/* ============================================================
   06d-3dprocs: оригинальные 3D-модели, собранные кодом (Three.js): без картинок и без чужих персонажей.
   Каждая модель возвращает { group, asp, update(t, dt) }: группа центрирована в нуле, высота = 1, asp = размах / высота.
   Эти модели — настоящие трёхмерные объекты (сетки, материалы, свет), а не картинки, и их можно показывать публично (rights: own).
   ============================================================ */
const Fig3DProcs = (() => {
  const TAU = Math.PI * 2;
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctx = (m, c, repeat) => { const t = new m.CanvasTexture(c); t.colorSpace = m.SRGBColorSpace; t.anisotropy = 4; if (repeat) t.wrapS = t.wrapT = m.RepeatWrapping; return t; };

  /** центрировать группу и привести высоту к 1 */
  function norm(m, g) {
    const b = new m.Box3().setFromObject(g), s = b.getSize(new m.Vector3()), c = b.getCenter(new m.Vector3()), k = 1 / s.y;
    g.position.set(-c.x, -c.y, -c.z);
    const o = new m.Group(); o.add(g); o.scale.setScalar(k);
    const w = new m.Group(); w.add(o);
    return { group: w, asp: Math.max(s.x, s.z) * k };
  }

  /* ---------- штурвал (тёмное дерево, латунь) ---------- */
  function woodTex(m) {
    const R = rng(7), c = cvs(256, 256), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#7b4b24'); g.addColorStop(.5, '#6a3f1d'); g.addColorStop(1, '#7d4d26'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 170; i++) { const y = R() * 256, h = .6 + R() * 2.2; x.fillStyle = R() < .55 ? 'rgba(30,15,5,' + (.06 + R() * .16).toFixed(3) + ')' : 'rgba(255,205,150,' + (.03 + R() * .08).toFixed(3) + ')'; x.fillRect(0, y, 256, h); }
    for (let k = 0; k < 3; k++) { const kx = R() * 256, ky = R() * 256, g2 = x.createRadialGradient(kx, ky, 1, kx, ky, 16 + R() * 10); g2.addColorStop(0, 'rgba(25,10,3,.55)'); g2.addColorStop(1, 'rgba(25,10,3,0)'); x.fillStyle = g2; x.fillRect(kx - 40, ky - 40, 80, 80); }
    return ctx(m, c, true);
  }
  function helm(m) {
    const wood = new m.MeshStandardMaterial({ map: woodTex(m), roughness: .5, metalness: .05 });
    const brass = new m.MeshStandardMaterial({ color: 0xc9a24b, metalness: 1, roughness: .27 });
    const g = new m.Group(), wheel = new m.Group(); wheel.position.y = .16; g.add(wheel);
    wheel.add(new m.Mesh(new m.TorusGeometry(.34, .04, 16, 80), wood));
    wheel.add(new m.Mesh(new m.TorusGeometry(.297, .013, 10, 80), brass));
    wheel.add(new m.Mesh(new m.TorusGeometry(.381, .008, 8, 80), brass));
    const hub = new m.Mesh(new m.CylinderGeometry(.085, .095, .13, 28), wood); hub.rotation.x = Math.PI / 2; wheel.add(hub);
    [.075, -.075].forEach(z => { const cap = new m.Mesh(new m.SphereGeometry(.058, 22, 14), brass); cap.scale.z = .6; cap.position.z = z; wheel.add(cap); });
    const prof = [[.0, .0], [.03, .01], [.024, .04], [.02, .07], [.034, .1], [.03, .14], [.0, .16]].map(p => new m.Vector2(p[0], p[1]));
    const spokeG = new m.CylinderGeometry(.017, .019, .32, 10), handleG = new m.LatheGeometry(prof, 14);
    for (let i = 0; i < 8; i++) {
      const sp = new m.Group(); sp.rotation.z = i / 8 * TAU; wheel.add(sp);
      const s = new m.Mesh(spokeG, wood); s.position.y = .24; sp.add(s);
      const h = new m.Mesh(handleG, wood); h.position.y = .36; sp.add(h);
      const k = new m.Mesh(new m.TorusGeometry(.02, .007, 6, 16), brass); k.rotation.x = Math.PI / 2; k.position.y = .395; sp.add(k);
    }
    const collar = new m.Mesh(new m.TorusGeometry(.07, .014, 8, 28), brass); collar.position.z = -.07; wheel.add(collar);
    const post = new m.Mesh(new m.CylinderGeometry(.05, .06, .78, 20), wood); post.position.set(0, -.2, -.11); g.add(post);
    const base = new m.Mesh(new m.CylinderGeometry(.26, .29, .06, 40), wood); base.position.set(0, -.58, -.05); g.add(base);
    const baseRing = new m.Mesh(new m.TorusGeometry(.28, .017, 8, 48), brass); baseRing.rotation.x = Math.PI / 2; baseRing.position.set(0, -.55, -.05); g.add(baseRing);
    const o = norm(m, g);
    o.update = t => { wheel.rotation.z = Math.sin(t * .55) * .55; };
    return o;
  }

  /* ---------- столбик золотых монет ---------- */
  function coinFace(m) {
    const c = cvs(256, 256), x = c.getContext('2d'), g = x.createRadialGradient(100, 90, 10, 128, 128, 150);
    g.addColorStop(0, '#fff2b8'); g.addColorStop(.5, '#f3b52c'); g.addColorStop(1, '#a8710d'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(110,65,5,.85)'; x.lineWidth = 7; x.beginPath(); x.arc(128, 128, 108, 0, TAU); x.stroke();
    x.lineWidth = 2.5; x.beginPath(); x.arc(128, 128, 93, 0, TAU); x.stroke();
    x.fillStyle = 'rgba(110,65,5,.92)'; x.font = 'bold 118px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 128, 138);
    return ctx(m, c);
  }
  function coins(m) {
    const face = new m.MeshStandardMaterial({ map: coinFace(m), color: 0xffffff, metalness: .9, roughness: .3 });
    const edge = new m.MeshStandardMaterial({ color: 0xd9a21b, metalness: 1, roughness: .34 });
    const body = new m.CylinderGeometry(.33, .33, .06, 44), rimG = new m.TorusGeometry(.335, .02, 8, 44);
    const R = rng(11), g = new m.Group();
    const coin = () => { const c = new m.Group(); c.add(new m.Mesh(body, [edge, face, face])); [.03, -.03].forEach(y => { const r = new m.Mesh(rimG, edge); r.rotation.x = Math.PI / 2; r.position.y = y; c.add(r); }); return c; };
    const stack = (x, z, n, jit) => { for (let i = 0; i < n; i++) { const c = coin(); c.position.set(x + (R() - .5) * jit, .03 + i * .064, z + (R() - .5) * jit); c.rotation.set((R() - .5) * .05, R() * TAU, (R() - .5) * .05); g.add(c); } };
    stack(0, 0, 14, .035); stack(.62, .26, 7, .05); stack(-.6, .18, 4, .05); stack(.28, .72, 2, .05);
    const lean = coin(); lean.position.set(-.12, .335, .5); lean.rotation.set(Math.PI / 2 - .2, .25, 0); g.add(lean);
    [[-.5, .74, .1], [.0, .95, 1.4], [-.9, .45, 2.2], [.95, -.2, .7]].forEach(p => { const c = coin(); c.position.set(p[0], .03, p[1]); c.rotation.y = p[2]; g.add(c); });
    const spin = new m.Group(), sc = coin(); sc.rotation.x = Math.PI / 2; spin.add(sc); spin.position.set(0, 1.28, 0); g.add(spin);
    const o = norm(m, g);
    o.update = t => { spin.rotation.y = t * 2.2; spin.position.y = 1.28 + Math.sin(t * 1.6) * .035; };
    return o;
  }

  /* ---------- кристалл фокуса ---------- */
  function crystal(m, glow) {
    const gc = new m.Color(glow || '#a78bfa'), light = gc.clone().lerp(new m.Color(0xffffff), .55), deep = gc.clone().multiplyScalar(.62);
    const mat = new m.MeshPhysicalMaterial({ color: deep, metalness: .2, roughness: .04, clearcoat: 1, clearcoatRoughness: .03, transparent: true, opacity: .74, emissive: gc, emissiveIntensity: .5, flatShading: true, side: m.DoubleSide });
    const rock = new m.MeshStandardMaterial({ color: 0x2b2733, roughness: .92, metalness: .05, flatShading: true });
    const g = new m.Group();
    const prism = (r, hb, ht) => { const p = new m.Group(), b = new m.Mesh(new m.CylinderGeometry(r, r * 1.05, hb, 6, 1), mat), t = new m.Mesh(new m.ConeGeometry(r, ht, 6, 1), mat); b.position.y = hb / 2; t.position.y = hb + ht / 2; p.add(b, t); return p; };
    [[0, 0, 0, 0, .17, .7, .42], [.21, .06, 0, -.38, .12, .38, .26], [-.2, .04, 0, .42, .13, .42, .28], [.04, .22, .4, 0, .11, .3, .22],
      [-.08, -.2, -.45, 0, .12, .36, .24], [.31, -.12, 0, -.8, .08, .2, .16], [-.32, -.1, 0, .85, .09, .22, .18]].forEach((d, i) => {
      const p = prism(d[4], d[5], d[6]); p.position.set(d[0], 0, d[1]); p.rotation.set(d[2], i * 1.1, d[3]); g.add(p);
    });
    const base = new m.Mesh(new m.IcosahedronGeometry(.36, 1), rock); base.scale.set(1, .3, 1); base.position.y = -.03; g.add(base);
    const coreMat = new m.MeshBasicMaterial({ color: light }), core = new m.Mesh(new m.OctahedronGeometry(.1, 0), coreMat); core.scale.set(.8, 2.6, .8); core.position.y = .4; g.add(core);
    const halo = new m.Mesh(new m.OctahedronGeometry(.17, 0), new m.MeshBasicMaterial({ color: gc, transparent: true, opacity: .35, blending: m.AdditiveBlending, depthWrite: false })); halo.scale.set(.9, 2.9, .9); halo.position.y = .4; g.add(halo);
    const shardMat = new m.MeshStandardMaterial({ color: gc, emissive: gc, emissiveIntensity: .8, metalness: .3, roughness: .2, flatShading: true }), shards = [];
    for (let i = 0; i < 7; i++) { const s = new m.Mesh(new m.OctahedronGeometry(.04 + (i % 3) * .008, 0), shardMat); g.add(s); shards.push(s); }
    const o = norm(m, g);
    o.update = t => {
      const p = Math.sin(t * 2.2); core.scale.set(.8 * (1 + .1 * p), 2.6 * (1 + .1 * p), .8 * (1 + .1 * p)); halo.scale.set(.9 * (1 + .14 * p), 2.9 * (1 + .14 * p), .9 * (1 + .14 * p)); mat.emissiveIntensity = .5 + .16 * p;
      shards.forEach((s, i) => { const a = t * (.5 + (i % 3) * .12) + i * 0.9, r = .52 + (i % 3) * .07; s.position.set(Math.cos(a) * r, .22 + Math.sin(a * 1.7 + i) * .12 + (i % 3) * .1, Math.sin(a) * r); s.rotation.set(a, a * 1.3, 0); });
    };
    return o;
  }

  return { helm, coins, crystal };
})();
