/* ============================================================
   03c-priests: техножрецы сценки ремонта сервочерепа.
   Картинки — присланные владельцем рендеры (assets/src_art/wh_priest_*.jpg); tools/cutout.py вырезает фигуры,
   tools/pack_priests.py режет на слои: тело, подвижные манипуляторы, оверлей голограммы. Раскладка — PRIEST_LAYOUT (build.py).
   Анимация: JS ведёт положение, ход, поворот вокруг вертикальной оси (перспектива), крен, подъём в такт шагам и прицеливание
   манипулятора; CSS — мерцание голограммы и колыхание подола. Это «2.5D» из плоских рендеров, а не 3D-модель.
   ============================================================ */
const PRIEST_KINDS = {
  hood: { hf: 1, hover: 0, mirror: true, stride: .3, bob: .022, arms: ['arm'] },      // жрец в капюшоне: идёт по земле
  big: { hf: 1.06, hover: .075, mirror: false, stride: .42, bob: .014, arms: ['al', 'ar'] }   // старший на платформе: парит над землёй
};
const PRIEST_NEAR_ARM = { hood: () => 'arm', big: side => (side < 0 ? 'ar' : 'al') };   // манипулятор, ближний к черепу

/** DOM жреца. PH — высота «пехотинца» в px; размеры и позиции слоёв считаются из PRIEST_LAYOUT. */
function priestBuild(kind, PH, side) {
  const L = PRIEST_LAYOUT[kind], K = PRIEST_KINDS[kind];
  if (!L) return null;
  const h = Math.round(PH * K.hf), k = h / L.h, w = Math.round(L.w * k);
  const pc = (v, of) => (v / of * 100).toFixed(2) + '%';
  const mir = K.mirror && side > 0 ? -1 : 1;
  let parts = '';
  L.parts.forEach(p => {
    const pos = 'left:' + pc(p.x, L.w) + ';top:' + pc(p.y, L.h) + ';width:' + pc(p.w, L.w) + ';height:' + pc(p.h, L.h);
    if (p.kind === 'overlay') parts += '<i class="pr-img pr-holo ' + p.img + '" style="' + pos + '"></i>';
    else parts += '<div class="pr-part" data-p="' + p.id + '" style="' + pos + ';transform-origin:' + pc(p.px, p.w) + ' ' + pc(p.py, p.h) + '"><i class="pr-img ' + p.img + '"></i><i class="pr-tip" style="left:' + pc(p.tx, p.w) + ';top:' + pc(p.ty, p.h) + '"></i></div>';
  });
  const hem = L.hem;
  const bodyImgs = hem
    ? '<i class="pr-img ' + L.body + ' pr-hi" style="clip-path:inset(0 -10% ' + ((1 - hem) * 100).toFixed(1) + '% -10%)"></i><i class="pr-img ' + L.body + ' pr-lo" style="clip-path:inset(' + (hem * 100).toFixed(1) + '% -10% 0 -10%);transform-origin:50% ' + (hem * 100).toFixed(1) + '%"></i>'
    : '<i class="pr-img ' + L.body + '"></i>';
  const el = document.createElement('div');
  el.className = 'priest ' + kind + ' walk';
  el.style.width = w + 'px'; el.style.height = h + 'px';
  el.innerHTML = '<i class="pr-sh"></i>' + (K.hover ? '<i class="pr-glow"></i>' : '') +
    '<div class="pr-3d"><div class="pr-bob"><div class="pr-body" style="transform:scaleX(' + mir + ')">' + bodyImgs + parts + '</div></div></div>';
  const rec = { kind, el, w, h, k, mir, L, K, d3: $('.pr-3d', el), bob: $('.pr-bob', el), arms: {} };
  $$('.pr-part', el).forEach(a => {
    const def = L.parts.find(p => p.id === a.dataset.p);
    rec.arms[a.dataset.p] = { el: a, tip: $('.pr-tip', a), def, ang: 0, ext: 0, tx: 0, ty: 0 };
  });
  return rec;
}
