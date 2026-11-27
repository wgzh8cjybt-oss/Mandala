/* ============================================================
   07d-shop-ui: вкладка «Магазин» в зале реликвий (каталог, мои покупки, слоты мандал, история, получение огоньков).
   Данные и покупка — в 07b-shop.js (Shop). Здесь только экран и применение выданных сервером прав у себя на устройстве.
   Правила: ничего не «засчитываем» сами; без сервера показываем ВИТРИНУ (07c-showcase.js) и честно блокируем покупку;
   продаём только то, что приложение умеет выдать прямо сейчас (SUPPORTED), остальное помечено «Скоро в приложении».
   ============================================================ */
const ShopUI = (() => {
  const CATS = [['slots', 'Слоты мандал'], ['universes', 'Вселенные'], ['wh40k', 'Warhammer 40,000'], ['onepiece', 'One Piece'], ['backgrounds', 'Фоны'], ['animated', 'Анимированные фоны'], ['effects', 'Эффекты'], ['characters', 'Персонажи и коллекции'], ['rewards', 'Награды'], ['features', 'Функции']];
  const KIND_IC = { slot: 'target', universe: 'palette', background: 'palette', animated_bg: 'sparkle', effect: 'bolt', relic: 'relic', figure: 'cube', flames: 'flame', feature: 'chart' };
  const KIND_NAME = { slot: 'Слот мандалы', universe: 'Вселенная', background: 'Фон', animated_bg: 'Анимация фона', effect: 'Эффект', relic: 'Коллекция реликвий', figure: 'Фигурка', flames: 'Огоньки', feature: 'Функция' };
  const FAM_NAME = { wh: 'Warhammer', op: 'One Piece', sc: 'Scrooge' };
  const STATUS_TXT = { paid: 'Оплачено', pending: 'Ждёт оплаты', created: 'Создан', refunded: 'Возврат', failed: 'Не прошёл', expired: 'Истёк', cancelled: 'Отменён' };
  const STATUS_TONE = { paid: 'good', refunded: 'warn', pending: 'info', created: 'info', failed: 'bad', expired: 'bad', cancelled: 'bad' };
  UI.shopCat = 'all';
  const hex = v => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) ? v : '';

  /* что приложение умеет выдать у себя прямо сейчас */
  function supported(p) {
    const g = p.grant || {};
    switch (p.kind) {
      case 'slot': return true;                              // лимит мандал включается подключённым магазином (Shop.slotLimit)
      case 'flames': return true;                            // огоньки зачисляются после получения (claimFlames)
      case 'universe': return typeof g.builtin === 'string' && !!THEMES.find(t => t.id === g.builtin);
      case 'relic': return Array.isArray(g.relics) && g.relics.length > 0 && g.relics.every(id => RELICS.some(r => r.id === id));
      case 'figure': return FIGURES.some(f => f.product === p.id) || Shop.customFigures().some(f => f.product === p.id);
      default: return false;                                 // фоны, анимации, эффекты, функции — в следующих сборках
    }
  }
  const live = () => Shop.catalog.length > 0;
  const products = () => (live() ? Shop.catalog : SHOWCASE).slice().sort((a, b) => (a.sort || 100) - (b.sort || 100));
  const byId = id => products().find(p => p.id === id) || null;
  const owned = p => {
    if (!live()) return false;
    if ((p.owned || 0) > 0) return true;
    if (p.kind === 'slot' || p.kind === 'flames') return false;           // повторяемые покупки
    return (((Shop.rights && Shop.rights.items) || []).some(x => x.product_id === p.id));   // право уже выдано, а каталог ещё не обновился
  };

  /* ---------- применение выданных прав на устройстве (идемпотентно) ---------- */
  function applyRights() {
    const r = Shop.rights; if (!r || !Array.isArray(r.items)) return;
    let changed = false;
    r.items.forEach(it => {
      const g = it && it.grant || {};
      if (it.kind === 'universe' && typeof g.builtin === 'string' && THEMES.find(t => t.id === g.builtin) && !S.unlockedThemes.includes(g.builtin)) { S.unlockedThemes.push(g.builtin); changed = true; }
      if (it.kind === 'relic' && Array.isArray(g.relics)) g.relics.forEach(id => { if (RELICS.some(x => x.id === id) && !S.unlockedRelics.includes(id)) { S.unlockedRelics.push(id); changed = true; } });
    });
    if (changed) { save(); scheduleRender(); }
  }
  /** Огоньки из купленных пачек: сначала записываем у себя (с защитой от повторов по номеру права), потом подтверждаем серверу. */
  let claiming = false;
  async function claimFlames() {
    if (claiming) return { ok: false, n: 0 };
    const s = Shop.status();
    if (!s.ok) { toast(s.text, 'err'); return { ok: false, n: 0 }; }
    claiming = true;
    try {
      /* Сначала свежий список с сервера: так другое устройство не успеет получить те же огоньки раньше нас. */
      try { await Shop.sync(); } catch (e) { toast('Не удалось обновить список покупок. Повторите, когда появится связь.', 'err'); return { ok: false, n: 0 }; }
      const list = (Shop.rights && Shop.rights.consumables) || [];
      if (!list.length) return { ok: true, n: 0 };
      const done = new Set(S.shopApplied.fl);
      let add = 0; const ids = [];
      list.forEach(c => {
        if (!Number.isSafeInteger(c.id)) return;
        ids.push(c.id);
        if (!done.has(c.id) && Number.isSafeInteger(c.flames) && c.flames > 0 && c.flames <= 100000) { add += c.flames; done.add(c.id); S.shopApplied.fl.push(c.id); }
      });
      if (S.shopApplied.fl.length > 500) S.shopApplied.fl = S.shopApplied.fl.slice(-500);
      if (add) { S.flames += add; save(); Hooks.change(); Snd.play('success'); Hap.notify('success'); toast('{ic:flame} +' + add + ' огоньков из магазина'); }
      try { await Shop.claim(ids); } catch (e) { toast('Огоньки зачислены. Подтвердить серверу пока не удалось — повторю при следующем обновлении.', 'err'); }
      return { ok: true, n: add };
    } finally { claiming = false; }
  }

  /* ---------- слот мандал: стена «нужен слот» и подсказки ---------- */
  function slotWall(lim) {
    const used = S.mandals.length;
    const offers = products().filter(p => p.kind === 'slot' && p.can_buy !== false);
    if (!offers.length) { toast('Все доступные слоты мандал уже куплены (' + lim + ')', 'err'); return; }
    const best = offers.reduce((a, b) => (a.price_stars <= b.price_stars ? a : b));
    Modal.confirm({ title: 'Нужен новый слот', msg: 'Слотов: ' + lim + ', все заняты (мандал: ' + used + ').\nНовый слот — от ' + best.price_stars + ' Stars. Уже созданные мандалы не затрагиваются.', ok: 'В магазин' })
      .then(yes => { if (yes) ACT['shop-open']({ dataset: { cat: 'slots' } }); });
  }
  function hqSub() { const s = Shop.status(); return s.ok ? 'подключён' : s.code === 'no_server' || s.code === 'no_telegram' ? 'витрина' : 'недоступен'; }
  function hqLine() {
    const s = Shop.status();
    if (s.ok) { const lim = Shop.slotLimit(), n = ((Shop.rights && Shop.rights.items) || []).length; return 'Слотов мандал: ' + (lim != null ? lim : '—') + ' · покупок: ' + n + '. Оплата только Telegram Stars.'; }
    if (s.code === 'no_server') return 'Каталог и цены уже здесь. Покупки откроются после подключения сервера оплаты.';
    return s.text;
  }
  function help() {
    const rec = Modal.open('<h3>' + I('info') + ' Как включить покупки</h3><div class="msg">Покупки за Telegram Stars идут через небольшой сервер: он проверяет платёж Telegram и выдаёт право. Само приложение ничего не «засчитывает».\n\nДля владельца нужно:\n1. Сервер с Node.js 22.13+ и постоянным диском под базу.\n2. Токен бота из @BotFather (хранится только на сервере).\n3. Адрес сервера по HTTPS и webhook бота на него.\n4. Адрес сервера прописывается в приложение — и кнопки «Купить» оживают.</div><div class="btns"><button class="btn" data-x="1">Понятно</button></div>', { top: true });
    rec.el.addEventListener('click', e => { if (e.target.closest('[data-x]')) Modal.close(rec); });
  }

  /* ---------- экран ---------- */
  function banner() {
    const s = Shop.status(), isLive = live();
    let tone = 'info', ic = 'info', title, text, btn = '';
    if (s.ok) { tone = 'good'; ic = 'check'; title = 'Магазин подключён'; text = 'Оплата проходит в окне Telegram. Право выдаёт сервер после платежа и оно сохраняется за вашим аккаунтом.'; btn = '<button class="btn sm ghost" data-act="shop-sync">' + I('cloudup') + ' Обновить права</button>'; }
    else if (s.code === 'loading') { title = 'Подключаюсь к магазину'; text = s.text; }
    else {
      tone = s.code === 'no_server' || s.code === 'no_telegram' ? 'info' : 'warn'; ic = tone === 'info' ? 'info' : 'warn';
      title = isLive ? 'Покупки временно недоступны' : 'Витрина магазина';
      text = s.text + (isLive ? '' : ' Ниже — примерный каталог: так магазин будет выглядеть после подключения. Цены и состав задаёт владелец.');
      if (s.code === 'no_server') btn = '<button class="btn sm ghost" data-act="shop-help">' + I('info') + ' Как включить покупки</button>';
    }
    const tools = btn + (s.ok ? '<button class="btn sm ghost" data-act="shop-history">' + I('scroll') + ' История покупок</button>' : '');   // истории без сервера нет: кнопку не показываем
    return '<div class="sh-banner ' + tone + '">' + I(ic) + '<div class="tx"><b>' + esc(title) + '</b><span>' + esc(text) + '</span></div></div>' + (tools ? '<div class="sh-tools">' + tools + '</div>' : '');
  }
  function slotsCard() {
    const lim = Shop.slotLimit(), used = S.mandals.length, r = Shop.rights && Shop.rights.slots;
    const body = '<div class="sh-slots"><div class="n"><b>' + used + '</b><span>' + Dt.plural(used, ['мандала', 'мандалы', 'мандал']) + '</span></div>' +
      '<div class="t">Первый слот бесплатный, дополнительные покупаются за Stars.' + (lim != null ? ' У вас слотов: <b>' + lim + '</b>' + (r && r.extra ? ' (куплено ' + r.extra + ')' : '') + (used >= lim ? '. Все заняты: чтобы создать ещё одну мандалу, нужен новый слот.' : '.') : ' Ограничение включится, когда магазин будет подключён к серверу.') + ' Покупка слота никогда не затрагивает существующие мандалы.</div></div>';
    return Glass.card({ icon: 'target', title: 'Слоты мандал', sub: lim != null ? used + ' / ' + lim : String(used), html: body, cls: 'sh-card' });
  }
  function claimCard() {
    const list = (Shop.rights && Shop.rights.consumables) || [], total = list.reduce((a, c) => a + (c.flames || 0), 0);
    if (!list.length) return '';
    return '<div class="sh-claim">' + I('flame') + '<div class="tx"><b>Ждут получения: ' + total + ' огоньков</b><span>Из купленных пачек. Зачислятся на этот аккаунт один раз.</span></div><button class="btn sm" data-act="shop-claim">Получить</button></div>';
  }
  /* картинка товара: настоящая миниатюра там, где она есть (фигурки, реликвии), иначе значок вида товара */
  function tint(p) {
    const g = p.grant || {};
    if (p.kind === 'universe') { const t = THEMES.find(x => x.id === g.builtin); return t ? t.c : ''; }
    if (p.kind === 'flames') return '#fb923c';
    if (p.kind === 'figure') { const f = FIGURES.find(x => x.product === p.id) || Shop.customFigures().find(x => x.product === p.id); return hex(f && f.glow) || hex(g.figure && g.figure.glow); }
    return '';
  }
  function art(p) {
    const g = p.grant || {};
    if (p.kind === 'figure') { const f = FIGURES.find(x => x.product === p.id); if (f) return '<i class="fgs fgd ' + esc(f.id) + '"></i>'; }
    if (p.kind === 'relic' && Array.isArray(g.relics)) { const r = RELICS.find(x => x.id === g.relics[0]); if (r && relicArt(r)) return '<span class="ra">' + relicArt(r) + '</span>'; }
    if (p.kind === 'flames' && g.flames) return I('flame') + '<b class="amt">' + (+g.flames) + '</b>';
    if (p.kind === 'slot' && g.slots) return I('target') + '<b class="amt">+' + (+g.slots) + '</b>';
    return I(KIND_IC[p.kind] || 'star');
  }
  function card(p) {
    const ok = Shop.status().ok, isLive = live(), sup = supported(p), own = owned(p), fam = p.family && FAM_NAME[p.family];
    const glow = tint(p);
    let btn;
    if (own && p.kind !== 'flames' && p.kind !== 'slot') btn = '<button class="btn sm" disabled>' + I('check') + ' Есть у вас</button>';
    else if (!sup) btn = '<button class="btn sm ghost" disabled>Скоро в приложении</button>';
    else if (!isLive || !ok) btn = '<button class="btn sm ghost" disabled>' + (isLive ? 'Недоступно' : 'Витрина') + '</button>';
    else if (p.can_buy === false) btn = '<button class="btn sm ghost" disabled>' + esc(p.reason === 'owned' ? 'Есть у вас' : Shop.reasonText(p.reason).replace(/\.$/, '')) + '</button>';
    else btn = '<button class="btn sm" data-act="shop-buy" data-id="' + esc(p.id) + '">' + I('star') + ' Купить</button>';
    return '<article class="sh-item" data-kind="' + esc(p.kind) + '" data-fam="' + esc(p.family || '') + '"' + (glow ? ' style="--g:' + glow + '"' : '') + '>' +
      '<div class="art" aria-hidden="true">' + art(p) + '</div>' +
      '<div class="bd"><div class="tags"><span>' + esc(KIND_NAME[p.kind] || 'Товар') + '</span>' + (fam ? '<span class="f">' + esc(fam) + '</span>' : '') + (p.kind === 'figure' && p.rights_status === 'own' ? '<span class="f">Оригинальная 3D-модель</span>' : '') + '</div>' +
      '<b class="t">' + esc(p.title) + '</b><p class="d">' + esc(p.description || '') + '</p>' +
      '<div class="ft"><span class="pr">' + I('star') + ' <b>' + p.price_stars + '</b> Stars</span>' + btn + '</div></div></article>';
  }
  function mine() {
    const r = Shop.rights, items = (r && r.items) || [];
    if (!items.length) return '';
    const rows = items.slice().reverse().slice(0, 12).map(it => {
      const p = byId(it.product_id), t = p ? p.title : it.product_id;
      return '<div class="sh-own">' + I(KIND_IC[it.kind] || 'star') + '<div class="tx"><b>' + esc(t) + '</b><span>' + esc(KIND_NAME[it.kind] || it.kind) + (it.created_at ? ' · ' + esc(fullStr(it.created_at)) : '') + '</span></div>' + I('check') + '</div>';
    }).join('');
    return Glass.card({ icon: 'crown', title: 'Мои покупки', sub: String(items.length), html: rows + (items.length > 12 ? '<div class="note">Показаны последние 12. Полный список — в «Истории покупок».</div>' : ''), cls: 'sh-card' });
  }
  function render() {
    const all = products(), cats = CATS.filter(c => all.some(p => p.category === c[0]));
    if (UI.shopCat !== 'all' && !cats.some(c => c[0] === UI.shopCat)) UI.shopCat = 'all';
    const list = all.filter(p => UI.shopCat === 'all' || p.category === UI.shopCat);
    let h = banner() + claimCard() + slotsCard() + mine();
    h += '<div class="an-chips" role="group" aria-label="Категории"><button class="' + (UI.shopCat === 'all' ? 'on' : '') + '" data-act="shop-cat" data-v="all">Все</button>' + cats.map(c => '<button class="' + (UI.shopCat === c[0] ? 'on' : '') + '" data-act="shop-cat" data-v="' + c[0] + '">' + esc(c[1]) + '</button>').join('') + '</div>';
    h += '<div class="sh-list">' + (list.length ? list.map(card).join('') : '<div class="empty">В этой категории пока ничего нет.</div>') + '</div>';
    h += '<div class="note">Все цифровые покупки оплачиваются только Telegram Stars. Если оплата прошла, а право не появилось, нажмите «Обновить права» или напишите боту команду /paysupport.</div>';
    return h;
  }

  /* ---------- история покупок ---------- */
  async function openHistory() {
    const s = Shop.status();
    if (!s.ok) { toast(s.text, 'err'); return; }
    const rec = Modal.open('<h3>' + I('scroll') + ' История покупок</h3><div class="msg" id="shHist">Загружаю…</div><div class="btns"><button class="btn ghost" data-x="1">Закрыть</button></div>');
    rec.el.addEventListener('click', e => { if (e.target.closest('[data-x]')) Modal.close(rec); });
    try {
      const list = await Shop.history(), box = $('#shHist', rec.el); if (!box) return;
      box.innerHTML = list.length ? list.map(o => '<div class="sh-ord"><div class="tx"><b>' + esc(o.title) + '</b><span>' + esc(fullStr(o.paid_at || o.created_at)) + '</span></div><div class="r"><b>' + (o.amount != null ? o.amount + ' ' : '') + I('star') + '</b><i class="' + (STATUS_TONE[o.status] || '') + '">' + esc(STATUS_TXT[o.status] || o.status) + '</i></div></div>').join('') : 'Покупок пока нет.';
    } catch (e) { const box = $('#shHist', rec.el); if (box) box.textContent = e.message || 'Не удалось загрузить историю.'; }
  }

  Shop.onChange(applyRights);
  return { render, applyRights, claimFlames, openHistory, supported, byId, live, slotWall, hqSub, hqLine, help };
})();

function renderShop() { return ShopUI.render(); }

Object.assign(ACT, {
  'shop-cat'(el) { UI.shopCat = String(el.dataset.v || 'all'); Snd.play('click'); Hap.select(); renderRelics(); },
  async 'shop-buy'(el) {
    const p = ShopUI.byId(el.dataset.id); if (!p) return;
    if (!ShopUI.supported(p)) { toast('Это появится в приложении позже', 'err'); return; }
    Snd.play('click'); Hap.impact('medium');
    const r = await Shop.buy(p.id);
    if (r && r.ok) {
      Snd.play('success'); Hap.notify('success'); ShopUI.applyRights();
      Shop.refresh(true);                                   // обновить «Есть у вас» и счётчики в каталоге
      if (p.kind === 'flames') await ShopUI.claimFlames();
      renderRelics();
    }
  },
  async 'shop-sync'() {
    Snd.play('click'); Hap.select();
    try { await Shop.sync(); ShopUI.applyRights(); await ShopUI.claimFlames(); toast('{ic:check} Права обновлены'); } catch (e) { toast(e.message || 'Не удалось обновить права', 'err'); }
    renderRelics();
  },
  'shop-history'() { Snd.play('click'); Hap.select(); ShopUI.openHistory(); },
  'shop-help'() { Snd.play('click'); Hap.select(); ShopUI.help(); },
  'shop-claim'() { Snd.play('click'); ShopUI.claimFlames().then(renderRelics); },
  'shop-open'(el) { UI.hall = 'shop'; if (el && el.dataset.cat) UI.shopCat = el.dataset.cat; switchTab('relics'); const sc = $('#relicsScroll'); if (sc) sc.scrollTop = 0; }
});
