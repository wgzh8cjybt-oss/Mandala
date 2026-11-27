/* ============================================================
   03d-glass: «образ» оформления (стекло / металл / классика) и набор компонентов Glass.
   Образ (look) не зависит от цветовой палитры и семейства темы: любая тема может носить любой образ.
   На <body> стоит класс look-glass | look-metal | look-classic, сами стили лежат в styles8.css.
   Компоненты Glass.* возвращают HTML-строки (как и весь остальной интерфейс; текст экранируется esc())
   с классами-метками g-*, а как они выглядят — решает образ: стекло, склёпанная плита или классическая рамка.
   ============================================================ */
const LOOKS = { glass: 'Стекло', metal: 'Металл', classic: 'Классика' };
/* образ по умолчанию для темы; пользователь может заменить его в «Штабе» (settings.look: auto | glass | metal | classic) */
const THEME_LOOK = { onepiece: 'glass', purple: 'glass', cyan: 'glass', wh40k: 'metal', red: 'metal', amber: 'metal', scrooge: 'classic' };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const Look = {
  pref() { const v = S && S.settings && S.settings.look; return typeof v === 'string' && hasOwn(LOOKS, v) ? v : 'auto'; },
  current(themeId) {
    const p = this.pref();
    if (p !== 'auto') return p;
    const id = themeId || (S && S.activeTheme);
    return hasOwn(THEME_LOOK, id) ? THEME_LOOK[id] : 'classic';
  },
  apply(themeId) {
    const b = document.body, v = this.current(themeId);
    Object.keys(LOOKS).forEach(k => b.classList.toggle('look-' + k, k === v));
    b.dataset.look = v;
    return v;
  }
};

/* блик под пальцем на стеклянных кнопках: CSS рисует его в точке (--px, --py) */
document.addEventListener('pointerdown', e => {
  const b = document.body;
  if (!b.classList.contains('look-glass') || b.classList.contains('fx-off')) return;
  const t = e.target, el = t && t.closest ? t.closest('.btn') : null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  el.style.setProperty('--px', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
  el.style.setProperty('--py', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
}, { passive: true });

const Glass = (() => {
  const attrs = d => d ? Object.keys(d).filter(k => /^[a-z][a-z0-9-]*$/.test(k)).map(k => ' data-' + k + '="' + esc(d[k]) + '"').join('') : '';
  const cls = list => list.filter(Boolean).join(' ');
  const TAGS = ['section', 'div', 'article', 'header', 'aside'];
  return {
    /* GlassPanel — большая панель. o: { tag, cls, html, rivets, data } */
    panel(o) {
      o = o || {};
      const tag = TAGS.includes(o.tag) ? o.tag : 'section';
      return '<' + tag + ' class="' + cls(['panel', o.rivets === false ? '' : 'rivets', 'g-panel', o.cls]) + '"' + attrs(o.data) + '>' + (o.html || '') + '</' + tag + '>';
    },
    /* GlassButton. o: { label, icon, kind: 'primary' | 'ghost' | 'danger', sm, block, disabled, aria, cls, data } */
    button(o) {
      o = o || {};
      return '<button class="' + cls(['btn', 'g-btn', o.kind === 'ghost' ? 'ghost' : o.kind === 'danger' ? 'danger' : '', o.sm ? 'sm' : '', o.block ? 'block' : '', o.cls]) + '"' + attrs(o.data) +
        (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') + (o.disabled ? ' disabled' : '') + '>' + (o.icon ? I(o.icon) + (o.label ? ' ' : '') : '') + esc(o.label || '') + '</button>';
    },
    /* GlassCard — карточка внутри панели, с заголовком. o: { icon, title, sub, html, cls, data } */
    card(o) {
      o = o || {};
      const head = (o.title || o.sub) ? '<div class="h2"><span>' + (o.icon ? I(o.icon) + ' ' : '') + esc(o.title || '') + '</span>' + (o.sub ? '<span class="sub">' + esc(o.sub) + '</span>' : '') + '</div>' : '';
      return '<div class="' + cls(['box', 'g-card', o.cls]) + '"' + attrs(o.data) + '>' + head + (o.html || '') + '</div>';
    },
    /* GlassNavigation — капсульный переключатель разделов. o: { items: [{ v, label, icon }], active, act, aria, cls } */
    nav(o) {
      o = o || {};
      return '<div class="' + cls(['seg', 'g-nav', o.cls]) + '" role="group" style="width:100%" aria-label="' + esc(o.aria || 'Разделы') + '">' +
        (o.items || []).map(it => '<button class="' + (String(it.v) === String(o.active) ? 'active' : '') + '" data-act="' + esc(o.act || '') + '" data-v="' + esc(it.v) + '">' + (it.icon ? I(it.icon) + ' ' : '') + esc(it.label) + '</button>').join('') + '</div>';
    },
    /* GlassModal — окно поверх приложения (оболочка .modal.panel.g-modal создаётся в Modal.open).
       o: { title, html, buttons: [{ label, kind, r }], top, onClose }. Кнопки получают data-r — как в остальных окнах. */
    modal(o) {
      o = o || {};
      const btns = (o.buttons || []).map(b => '<button class="btn' + (b.kind === 'ghost' ? ' ghost' : b.kind === 'danger' ? ' danger' : '') + '" data-r="' + esc(b.r == null ? '1' : b.r) + '">' + esc(b.label) + '</button>').join('');
      return Modal.open((o.title ? '<h3>' + (o.icon ? I(o.icon) + ' ' : '') + esc(o.title) + '</h3>' : '') + (o.html || '') + (btns ? '<div class="btns">' + btns + '</div>' : ''), { top: o.top, onClose: o.onClose, sticky: o.sticky });
    },
    /* GlassRewardCard — карточка награды (внутри .rel-wrap). o: { kicker, art (готовый безопасный HTML), name, desc } */
    rewardCard(o) {
      o = o || {};
      return '<div class="rel-card g-reward"><div class="kicker">' + esc(o.kicker || '') + '</div><div class="art">' + (o.art || '') + '</div><div><div class="nm">' + esc(o.name || '') + '</div><div class="ds">' + esc(o.desc || '') + '</div></div></div>';
    }
  };
})();
