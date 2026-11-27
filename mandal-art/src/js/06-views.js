/* ============================================================
   06-views: реликвии, достижения, штаб (настройки/данные),
   склад огоньков, просмотр реликвии, импорт/экспорт, действия
   ============================================================ */
const timeStr = ts => ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
const fullStr = ts => ts ? fmtDate(ts) : '—';
function setScrollHTML(sel, html) { const sc = $(sel), top = sc.scrollTop; sc.innerHTML = html; sc.scrollTop = top; }

/* ---------- вкладка «Реликвии» ---------- */
function relicTile(r) {
  const st = relicStatus(r);
  if (st === 'owned') return '<button class="relic" data-act="relic" data-id="' + r.id + '"><div class="art">' + relicArt(r) + '</div><div class="nm">' + esc(r.name) + '</div></button>';
  const cost = st === 'ready' ? '<div class="cost"><b style="color:var(--accent-2)">Открыть!</b></div>' : '<div class="cost">' + r.minXp + ' XP' + (r.flames ? '<br>или ' + I('flame') + r.flames : '') + '</div>';
  return '<button class="relic locked' + (st === 'ready' ? ' ready' : '') + '" data-act="relic" data-id="' + r.id + '"><div class="art">' + (st === 'ready' ? I('unlock') : I('lock')) + '</div><div class="nm">' + (st === 'ready' ? esc(r.name) : '???') + '</div>' + cost + '</button>';
}
function hallTabs() {
  const all = allFigs(); if (!all.length) return '';
  const rd = figReadyCount(), tab = UI.hall === 'figs' ? 'figs' : UI.hall === 'shop' ? 'shop' : 'relics';
  const claimable = !!(Shop.rights && Shop.rights.consumables && Shop.rights.consumables.length);
  return '<div class="seg hall-seg three" role="tablist" aria-label="Раздел зала">' +
    '<button role="tab" aria-selected="' + (tab === 'relics') + '" class="' + (tab === 'relics' ? 'active' : '') + '" data-act="hall" data-v="relics">' + esc(T('relicsTab')) + ' <span class="pill">' + S.unlockedRelics.length + '/' + RELICS.length + '</span></button>' +
    '<button role="tab" aria-selected="' + (tab === 'figs') + '" class="' + (tab === 'figs' ? 'active' : '') + '" data-act="hall" data-v="figs">' + esc(T('figs')) + ' <span class="pill">' + figOwnedCount() + '/' + all.length + '</span>' + (rd ? '<i class="seg-dot" title="Есть фигурки, которые можно забрать"></i>' : '') + '</button>' +
    '<button role="tab" aria-selected="' + (tab === 'shop') + '" class="' + (tab === 'shop' ? 'active' : '') + '" data-act="hall" data-v="shop">' + esc(T('shopTab')) + (claimable ? '<i class="seg-dot" title="Есть купленные огоньки, которые можно получить"></i>' : '') + '</button></div>';
}
function renderRelics() {
  let h = '<div class="h2"><span>' + I('relic') + ' ' + T('hall') + '</span><button class="btn sm ghost" data-act="store">' + I('flame') + ' ' + T('store') + '</button></div>';
  h += hallTabs();
  if (UI.hall === 'shop') { setScrollHTML('#relicsScroll', h + renderShop()); return; }
  if (UI.hall === 'figs' && allFigs().length) { setScrollHTML('#relicsScroll', h + renderFigs()); return; }
  h += '<div class="box"><div class="h2"><span>' + I('palette') + ' ' + T('themes') + '</span><span class="sub">' + S.unlockedThemes.length + '/' + THEMES.length + '</span></div><div class="grid3" style="grid-template-columns:repeat(4,1fr)">' +
    THEMES.map(t => { const own = S.unlockedThemes.includes(t.id); return '<button class="theme-pick' + (S.activeTheme === t.id ? ' active' : '') + (own ? '' : ' lock') + '" data-act="theme" data-id="' + t.id + '" style="--c:' + t.c + '"><span class="sw" style="background:' + t.c + '"></span>' + esc(t.name) + (own ? '' : '<small>' + I('flame') + t.cost + '</small>') + '</button>'; }).join('') + '</div></div>';
  Object.keys(UNIVERSES).forEach(u => {
    const rs = RELICS.filter(r => r.uni === u), own = rs.filter(r => S.unlockedRelics.includes(r.id)).length;
    h += '<div><div class="uni"><span>' + esc(UNIVERSES[u]) + '</span><span class="pill">' + own + '/' + rs.length + '</span></div><div class="grid3">' + rs.map(relicTile).join('') + '</div></div>';
  });
  const got = ACHIEVEMENTS.filter(a => S.achievements[a.id]).length;
  h += '<div class="box"><div class="h2"><span>' + I('crown') + ' ' + T('ach') + '</span><span class="sub">' + got + '/' + ACHIEVEMENTS.length + '</span></div>' +
    ACHIEVEMENTS.map(a => { const on = !!S.achievements[a.id]; return '<div class="ach' + (on ? ' on' : '') + '">' + I(a.ic) + '<div class="tx"><b>' + esc(a.name) + '</b><span>' + esc(a.desc) + '</span></div><div class="rw">' + (on ? I('check') : '+' + a.fl + ' ' + I('flame')) + '</div></div>'; }).join('') + '</div>';
  setScrollHTML('#relicsScroll', h);
}

/* ---------- вкладка «Штаб» ---------- */
const sw = (k, label) => '<div class="sw-row"><span>' + label + '</span><button class="switch' + (S.settings[k] ? ' on' : '') + '" role="switch" aria-checked="' + !!S.settings[k] + '" aria-label="' + esc(label) + '" data-act="tgl" data-k="' + k + '"></button></div>';
function renderHQ() {
  const m = activeMandala(), st = statsOfMandala(m), sk = streakInfo(), tot = totals(), cs = Tg.cloudStatus(), bk = readBackupInfo();
  const gotA = ACHIEVEMENTS.filter(a => S.achievements[a.id]).length;
  let cloud, dot;
  if (!cs.available) { cloud = 'недоступно вне Telegram'; dot = 'warn'; }
  else if (cs.busy) { cloud = 'синхронизация…'; dot = 'warn'; }
  else if (cs.error) { cloud = 'ошибка: ' + esc(cs.error); dot = 'bad'; }
  else if (S.meta.lastPush) { cloud = 'сохранено ' + timeStr(S.meta.lastPush); dot = 'ok'; }
  else { cloud = 'ещё не сохранялось'; dot = 'warn'; }
  const fxBtn = (v, l) => '<button class="' + (S.settings.fx === v ? 'active' : '') + '" data-act="fx" data-v="' + v + '">' + l + '</button>';
  const lookNote = 'Образ — это вид панелей и кнопок; он не зависит от цвета темы. «Авто»: One Piece, фиолетовая и бирюзовая темы носят стекло, Warhammer, красная и янтарная — грубый металл, Скрудж — золотую классику. Размытие стекла работает в режимах эффектов «Полные» и «Лёгкие» (в лёгком слабее), при «Выкл» стекло становится плоским.';
  let h = '';
  h += '<div class="box"><div class="h2"><span>' + I('chart') + ' ' + T('status') + '</span><span class="sub">' + esc(m.title) + '</span></div>' +
    '<div class="row"><span>Зачищено секторов</span><b>' + st.done + ' / 81</b></div><div class="bar"><i style="width:' + (st.done / 81 * 100).toFixed(1) + '%"></i></div>' +
    '<div class="heat">' + st.blocks.map(n => '<i style="--o:' + (n / 9 * .9).toFixed(2) + '"><span>' + n + '</span></i>').join('') + '</div>' +
    '<div class="grid3"><div class="stat-tile"><b>' + I('flame') + ' ' + sk.cur + '</b><span>серия дней</span></div><div class="stat-tile"><b>' + sk.best + '</b><span>рекорд</span></div><div class="stat-tile"><b>' + sk.days + '</b><span>дней в деле</span></div>' +
    '<div class="stat-tile"><b>' + tot.diary + '</b><span>записей</span></div><div class="stat-tile"><b>' + tot.relics + '/' + RELICS.length + '</b><span>реликвий</span></div><div class="stat-tile"><b>' + gotA + '/' + ACHIEVEMENTS.length + '</b><span>достижений</span></div></div>' +
    (sk.today ? '' : '<div class="note">Сегодня активности ещё не было: выполните задачу или сделайте запись, чтобы продолжить серию.</div>') + '</div>';
  h += Glass.card({ icon: 'cart', title: 'Магазин', sub: ShopUI.hqSub(), html: '<div class="row"><span class="note">' + esc(ShopUI.hqLine()) + '</span><button class="btn sm" data-act="shop-open">' + I('cart') + ' Открыть</button></div>' });
  h += Glass.card({
    icon: 'palette', title: 'Оформление', sub: LOOKS[Look.current()],
    html: Glass.nav({ act: 'look', aria: 'Образ оформления', active: Look.pref(), items: [{ v: 'auto', label: 'Авто' }, { v: 'glass', label: 'Стекло' }, { v: 'metal', label: 'Металл' }, { v: 'classic', label: 'Классика' }] }) + '<div class="note">' + esc(lookNote) + '</div>'
  });
  h += '<div class="box"><div class="h2"><span>' + I('sparkle') + ' ' + T('fx') + '</span></div>' + sw('sound', 'Звук') + sw('haptics', 'Вибрация') + sw('skulls', T('floaters')) + (FAMS[FAM].scenes ? sw('scenes', FAMS[FAM].scenes) + '<button class="btn sm" data-act="scene-demo" style="margin:2px 0 6px">Показать сценку сейчас</button>' : '') +
    '<div class="seg" style="width:100%">' + fxBtn('auto', 'Авто') + fxBtn('full', 'Полные') + fxBtn('lite', 'Лёгкие') + fxBtn('off', 'Выкл') + '</div>' +
    '<div class="note">«Авто» включает лёгкий режим на слабых устройствах и если в системе включено «уменьшение движения». Сценки и живые двигатели черепа работают в режиме «Полные». Сейчас: ' + ({ full: 'полные', lite: 'лёгкие', off: 'выключены' }[FX.level()]) + '.</div></div>';
  h += '<div class="box"><div class="h2"><span>' + I('disk') + ' ' + T('data') + '</span></div>' +
    '<div class="row"><span><i class="status-dot ' + (Store.ok ? 'ok' : 'bad') + '"></i>На устройстве</span><b>' + (Store.ok ? 'сохранено ' + timeStr(S.updatedAt) : 'не сохраняется!') + '</b></div>' +
    '<div class="row"><span><i class="status-dot ' + dot + '"></i>Облако Telegram</span><b>' + cloud + '</b></div>' +
    '<div class="grid2"><button class="btn sm" data-act="cloud-push"' + (cs.available ? '' : ' disabled') + '>' + I('cloudup') + ' В облако</button><button class="btn sm" data-act="cloud-pull"' + (cs.available ? '' : ' disabled') + '>' + I('clouddown') + ' Из облака</button></div>' +
    sw('autoSync', 'Автосинхронизация с облаком') +
    '<div class="grid2"><button class="btn sm ghost" data-act="export-file">' + I('download') + ' Экспорт</button><button class="btn sm ghost" data-act="export-copy">' + I('copy') + ' Копировать</button><button class="btn sm ghost" data-act="import-file">' + I('upload') + ' Импорт файла</button><button class="btn sm ghost" data-act="import-paste">' + I('paste') + ' Вставить копию</button></div>' +
    (bk ? '<div class="row"><span class="note">Резервная копия: ' + esc(fullStr(bk.ts)) + ' · XP ' + bk.xp + '</span><button class="btn sm ghost" data-act="backup-restore">' + I('undo') + ' Вернуть</button></div>' : '') +
    '<button class="btn sm danger block" data-act="reset">' + I('warn') + ' ' + T('reset') + '</button></div>';
  h += '<div class="box"><div class="h2"><span>' + I('info') + ' ' + T('about') + '</span></div><div class="note mono">Mandal-Art v' + CONFIG.version + ' · схема 2<br>ключ данных: ' + CONFIG.storageKey + '<br>' + (S.meta.migratedFrom.length ? 'перенесено из: ' + esc(S.meta.migratedFrom.join(', ')) + '<br>' : '') + 'Telegram: ' + (Tg.isTelegram() ? 'да (WebApp ' + esc(Tg.version()) + ')' : 'нет, браузерный режим') + '</div></div>';
  setScrollHTML('#hqScroll', h);
}

/* ---------- склад огоньков ---------- */
function openStore() {
  const rec = Modal.open('<div id="storeBody"></div>');
  const draw = () => {
    const th = THEMES.filter(t => !S.unlockedThemes.includes(t.id)), rl = RELICS.filter(r => !S.unlockedRelics.includes(r.id) && r.flames);
    let h = '<h3>' + I('flame') + ' ' + T('store') + '</h3><div class="msg">У вас: <b style="color:var(--accent-2)">' + S.flames + '</b> огоньков.\nОгоньки дают: +' + CONFIG.flamesLevel + ' за новый ранг, +' + CONFIG.flamesBlock + ' за зачищенный блок, награды за достижения.</div>';
    if (th.length) h += '<div class="uni"><span>Темы</span></div>' + th.map(t => '<div class="store-item"><span class="sw" style="width:22px;height:22px;border-radius:50%;background:' + t.c + '"></span><div class="tx"><b>' + esc(t.name) + '</b><span>Тема оформления</span></div><button class="btn sm" data-s="theme" data-id="' + t.id + '"' + (S.flames >= t.cost ? '' : ' disabled') + '>' + I('flame') + ' ' + t.cost + '</button></div>').join('');
    if (rl.length) h += '<div class="uni"><span>Реликвии без ожидания</span></div>' + rl.map(r => '<div class="store-item"><div class="art" style="width:40px;height:40px;border-radius:8px;overflow:hidden;background:rgba(0,0,0,.5)">' + relicArt(r) + '</div><div class="tx"><b>' + esc(r.name) + '</b><span>или ' + r.minXp + ' XP (у вас ' + S.xp + ')</span></div><button class="btn sm" data-s="relic" data-id="' + r.id + '"' + (S.flames >= r.flames ? '' : ' disabled') + '>' + I('flame') + ' ' + r.flames + '</button></div>').join('');
    if (!th.length && !rl.length) h += '<div class="empty">Склад пуст — всё уже открыто.</div>';
    h += '<div class="store-shop"><span>Слоты мандал, вселенные и фигурки продаются в магазине за Telegram Stars.</span><button class="btn sm" data-s="shop">' + I('cart') + ' Магазин</button></div>';
    h += '<div class="btns"><button class="btn ghost" data-x="1">Закрыть</button></div>';
    $('#storeBody', rec.el).innerHTML = h;
  };
  draw();
  rec.el.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) { Modal.close(rec); return; }
    const b = e.target.closest('[data-s]'); if (!b) return;
    if (b.dataset.s === 'shop') { Modal.close(rec); ACT['shop-open']({ dataset: {} }); return; }
    if (b.dataset.s === 'theme') {
      const r = buyTheme(b.dataset.id);
      if (r.ok) { Snd.play('unlock'); Hap.notify('success'); toast('{ic:palette} Тема открыта и применена'); } else { Snd.play('error'); toast('Не хватает огоньков', 'err'); }
    } else {
      const r = unlockRelic(b.dataset.id, 'flames');
      if (r.ok) openReveal(r.relic, true); else { Snd.play('error'); toast('Не хватает огоньков', 'err'); }
    }
    draw();
  });
}

/* ---------- просмотр реликвии (3D-наклон пальцем/мышью, анимация открытия) ---------- */
function openReveal(r, fresh) {
  const el = document.createElement('div');
  el.className = 'reveal' + (fresh ? ' fresh' : '');
  el.innerHTML = '<div class="rays"></div><div class="rel-wrap">' + Glass.rewardCard({ kicker: fresh ? T('relicNew') : T('relicOld'), art: relicArt(r), name: r.name, desc: r.desc }) + '</div><button class="btn" data-x="1" style="position:relative;z-index:2">Закрыть</button>';
  const rec = Modal.mount(el, {});
  const wrap = $('.rel-wrap', el), card = $('.rel-card', el);
  const move = e => {
    const b = wrap.getBoundingClientRect();
    const x = (e.clientX - (b.left + b.width / 2)) / b.width, y = (e.clientY - (b.top + b.height / 2)) / b.height;
    card.style.transform = 'rotateY(' + clamp(x * 36, -24, 24).toFixed(1) + 'deg) rotateX(' + clamp(-y * 36, -24, 24).toFixed(1) + 'deg)';
  };
  wrap.addEventListener('pointerdown', e => { try { wrap.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } move(e); });
  wrap.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') move(e); });
  ['pointerup', 'pointercancel'].forEach(ev => wrap.addEventListener(ev, () => { card.style.transform = ''; }));
  el.addEventListener('click', e => { if (e.target.closest('[data-x]')) Modal.close(rec); });
  if (fresh) {
    Snd.play('unlock'); Hap.notify('success');
    setTimeout(() => { if (!el.isConnected) return; const b = card.getBoundingClientRect(); Burst.relic(b.left + b.width / 2, b.top + b.height / 2); }, 700);
  } else Snd.play('click');
}
function openRelicInfo(r) {
  const can = S.flames >= r.flames;
  const rec = Modal.open('<h3>' + I('lock') + ' ' + esc(r.name) + '</h3><div class="msg">' + esc(r.desc) + '\nНужно опыта: ' + r.minXp + ' XP (у вас ' + S.xp + ').' + (r.flames ? '\nИли открыть сейчас за ' + I('flame') + ' ' + r.flames + ' (у вас ' + S.flames + ').' : '') + '</div><div class="btns"><button class="btn ghost" data-r="x">Закрыть</button>' + (r.flames ? '<button class="btn" data-r="buy"' + (can ? '' : ' disabled') + '>' + I('flame') + ' ' + r.flames + '</button>' : '') + '</div>');
  rec.el.addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    Modal.close(rec);
    if (b.dataset.r === 'buy') { const x = unlockRelic(r.id, 'flames'); if (x.ok) openReveal(x.relic, true); else { Snd.play('error'); toast('Не хватает огоньков', 'err'); } }
  });
}

/* ---------- резервные копии: файл / буфер / вставка ---------- */
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* пробуем запасной путь */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove(); return !!ok;
  } catch (e) { return false; }
}
function showCopyModal(text) {
  const rec = Modal.open('<h3>' + I('copy') + ' Резервная копия</h3><div class="msg">Не удалось скопировать автоматически. Выделите весь текст ниже, скопируйте и сохраните в заметках.</div><textarea class="field mono" id="cpTa" rows="7" readonly></textarea><div class="btns"><button class="btn ghost" data-r="x">Закрыть</button><button class="btn" data-r="sel">Выделить всё</button></div>');
  const ta = $('#cpTa', rec.el); ta.value = text;
  rec.el.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; if (b.dataset.r === 'sel') { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); } else Modal.close(rec); });
}
function exportCopy() {
  const text = exportData();
  copyText(text).then(ok => { if (ok) toast('{ic:copy} Копия скопирована. Вставьте её в «Избранное» Telegram или в заметки.', 'long'); else showCopyModal(text); });
}
function exportFile() {
  if (Tg.isTelegram()) { toast('В Telegram загрузка файлов из мини-приложения часто блокируется — копирую текст.', 'long'); exportCopy(); return; }
  const text = exportData();
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'mandal_art_backup_' + dayKey() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('{ic:download} Файл резервной копии создан. Если загрузка не началась — используйте «Копировать».', 'long');
  } catch (e) { showCopyModal(text); }
}
async function importFromText(text) {
  const p = parseImport(text);
  if (!p.ok) { Snd.play('error'); toast(p.reason === 'json' ? '{ic:close} Это не JSON-копия' : '{ic:close} В файле нет данных мандалы', 'err'); return; }
  const ok = await Modal.confirm({ title: 'Заменить данные?', msg: 'В копии: XP ' + p.info.xp + ', выполнено ячеек ' + p.info.done + ', записей ' + p.info.diary + ', целей ' + p.info.mandals + '.\nТекущие данные будут заменены. Предыдущая версия сохранится как резервная копия.', ok: 'Заменить', danger: true });
  if (!ok) return;
  const r = importData(text);
  if (r.ok) { setMode('all'); Snd.play('success'); toast('{ic:check} Архивы успешно импортированы'); } else toast('{ic:close} Ошибка импорта', 'err');
}
function openPasteImport() {
  const rec = Modal.open('<h3>' + I('paste') + ' Вставить копию</h3><div class="msg">Вставьте сюда текст резервной копии (JSON).</div><textarea class="field mono" id="pasteTa" rows="7" placeholder="{ ... }"></textarea><div class="btns"><button class="btn ghost" data-r="x">Отмена</button><button class="btn" data-r="ok">Импорт</button></div>', { top: true });
  rec.el.addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const v = $('#pasteTa', rec.el).value; Modal.close(rec);
    if (b.dataset.r === 'ok') { if (v.trim()) importFromText(v); else toast('Поле пустое', 'err'); }
  });
}

/* ---------- применение внешних данных (облако/копия) ---------- */
function applyExternalState(st, why, ts) {
  backupNow(why || 'external');
  const keep = S.settings; S = st; S.settings = keep;
  if (ts) { S.updatedAt = ts; S.meta.syncedTs = ts; S.meta.lastPull = Date.now(); }
  persistNow(!!ts);
  if (checkAchievements(true).length) save();
  Hooks.theme(S.activeTheme); Hooks.change();
}
async function cloudPullUI() {
  const r = await Tg.cloudFetch();
  if (!r.ok) { toast(r.reason === 'empty' ? '{ic:cloudup} В облаке пока нет данных' : '{ic:close} ' + (r.error || 'Ошибка облака'), 'err'); return; }
  const cs = cellStat(r.state);
  const ok = await Modal.confirm({ title: 'Загрузить из облака?', msg: 'Облако (' + fullStr(r.ts) + '): XP ' + r.state.xp + ', выполнено ' + cs.done + ', записей ' + r.state.diary.length + '.\nТекущие данные будут заменены (копия сохранится).', ok: 'Загрузить' });
  if (ok) { applyExternalState(r.state, 'cloud-pull', r.ts); setMode('all'); toast('{ic:clouddown} Данные загружены из облака'); }
}

/* ---------- действия по data-act ---------- */
const ACT = {
  store() { Snd.play('click'); Hap.impact('medium'); openStore(); },
  'add-mandala'() {
    const lim = Shop.slotLimit();      // число слотов задаёт подключённый магазин; без него действует общий лимит
    if (lim != null && S.mandals.length >= lim) { Snd.play('error'); ShopUI.slotWall(lim); return; }
    const m = addMandala();
    if (!m) { toast('Достигнут лимит целей (' + CONFIG.maxMandals + ')', 'err'); return; }
    Snd.play('success'); Hap.impact('medium'); setMode('all'); if (UI.tab !== 'mandala') switchTab('mandala');
  },
  async 'del-mandala'() {
    if (S.mandals.length <= 1) { toast('{ic:warn} Нельзя удалить последнюю цель!', 'err'); Hap.notify('warning'); return; }
    const m = activeMandala();
    if (await Modal.confirm({ title: 'Удалить цель?', msg: '«' + m.title + '» будет удалена вместе с ячейками. Полученные XP и награды останутся.', ok: 'Удалить', danger: true })) { deleteMandala(m.id); Snd.play('click'); setMode('all'); }
  },
  mandala(el) { Snd.play('click'); Hap.select(); switchMandala(el.dataset.id); if (UI.mode === 'block') applyMode(); },
  'mode-all'() { Snd.play('click'); setMode('all'); },
  'mode-block'() { Snd.play('click'); setMode('block'); },
  'focus-prev'() { Snd.play('click'); Hap.select(); setMode('block', (UI.focus + 8) % 9); },
  'focus-next'() { Snd.play('click'); Hap.select(); setMode('block', (UI.focus + 1) % 9); },
  'note-edit'() { Snd.play('click'); Hap.impact('light'); openBlockNote(UI.focus); },
  'save-diary'() {
    const ta = $('#diaryInput');
    if (!ta.value.trim()) { toast('Введите текст записи', 'err'); return; }
    const r = addDiary(ta.value); ta.value = '';
    Snd.play('success'); Hap.notify('success');
    if (r.xp) Burst.cell(UI.px, UI.py); else toast('Запись сохранена. Лимит XP на сегодня (' + CONFIG.diaryXpPerDay + ' записи) исчерпан.');
  },
  async 'del-diary'(el) { if (await Modal.confirm({ title: 'Удалить запись?', msg: 'Полученный за неё XP останется.', ok: 'Удалить', danger: true })) deleteDiary(Number(el.dataset.id)); },
  relic(el) {
    const r = RELICS.find(x => x.id === el.dataset.id); if (!r) return;
    const st = relicStatus(r);
    if (st === 'owned') openReveal(r, false);
    else if (st === 'ready') { const x = unlockRelic(r.id, 'xp'); if (x.ok) openReveal(x.relic, true); }
    else { Snd.play('click'); Hap.impact('light'); openRelicInfo(r); }
  },
  async theme(el) {
    const id = el.dataset.id, t = themeById(id); if (!t) return;
    if (S.unlockedThemes.includes(id)) { if (setTheme(id)) { Snd.play('click'); Hap.impact('medium'); } return; }
    Snd.play('click');
    if (await Modal.confirm({ title: 'Открыть тему «' + t.name + '»?', msg: 'Стоимость: ' + t.cost + ' огоньков (у вас ' + S.flames + ').', ok: 'Открыть' })) {
      const r = buyTheme(id);
      if (r.ok) { Snd.play('unlock'); Hap.notify('success'); toast('{ic:palette} Тема открыта и применена'); } else { Snd.play('error'); toast('Не хватает огоньков', 'err'); }
    }
  },
  tgl(el) {
    const k = el.dataset.k; S.settings[k] = !S.settings[k]; save();
    if (k === 'skulls') FX.apply();
    if (k === 'scenes') Scene.setScenes(S.settings.scenes);
    if (k === 'autoSync') Tg.scheduleSync();
    Snd.play('click'); Hap.select(); renderHQ();
  },
  'scene-demo'() {   // настоящий запуск сценки (не имитация): падение, техножрецы, ремонт
    const i = Scene.info();
    if (i.scene) { toast('Сценка уже идёт, смотрите вниз экрана'); return; }
    if (!i.canScene) { toast('Сценки работают в режиме эффектов «Полные» при включённых сервочерепах и сценках', 'err'); return; }
    if (Scene.malfunction({ x: innerWidth / 2, y: Math.min(200, innerHeight * .3) })) toast('Смотрите вниз экрана: череп сломался'); else toast('Сейчас сценка недоступна', 'err');
  },
  fx(el) { S.settings.fx = el.dataset.v; save(); FX.apply(); Snd.play('click'); Hap.select(); renderHQ(); },
  look(el) {
    const v = el.dataset.v;
    if (!['auto', 'glass', 'metal', 'classic'].includes(v)) return;
    S.settings.look = v; save(); Look.apply(); Snd.play('click'); Hap.select(); renderHQ();
  },
  async 'cloud-push'() { const r = await Tg.cloudPush(true); renderHQ(); toast(r.ok ? '{ic:cloudup} Данные сохранены в облако Telegram' : '{ic:close} ' + (r.error || 'Ошибка облака'), r.ok ? '' : 'err'); },
  'cloud-pull'() { cloudPullUI(); },
  'export-file'() { exportFile(); },
  'export-copy'() { exportCopy(); },
  'import-file'() { $('#importFile').click(); },
  'import-paste'() { openPasteImport(); },
  async 'backup-restore'() {
    const b = readBackupInfo(); if (!b) return;
    if (await Modal.confirm({ title: 'Вернуть резервную копию?', msg: 'Копия от ' + fullStr(b.ts) + ': XP ' + b.xp + ', выполнено ' + b.cells + ', записей ' + b.diary + '.\nТекущее состояние будет заменено.', ok: 'Вернуть', danger: true })) {
      if (restoreBackup()) { Snd.play('success'); toast('{ic:undo} Копия восстановлена'); setMode('all'); } else toast('{ic:close} Не удалось восстановить', 'err');
    }
  },
  async reset() {
    if (!await Modal.confirm({ title: 'Сбросить протоколы?', msg: 'Будут очищены все цели, дневник, XP, огоньки, реликвии, фигурки и достижения. Настройки останутся. Покупки за Stars хранятся на сервере и не пропадут.', ok: 'Продолжить', danger: true })) return;
    if (!await Modal.confirm({ title: 'Точно сбросить?', msg: 'Перед сбросом сохранится резервная копия — её можно вернуть в «Штабе». Облако Telegram не затрагивается.', ok: 'Сбросить всё', danger: true })) return;
    resetAll(); setMode('all'); switchTab('mandala'); Snd.play('success'); toast('{ic:trash} Данные сброшены. Копию «до» можно вернуть в Штабе.', 'long');
  }
};
function bindActions() {
  document.addEventListener('pointerdown', e => { UI.px = e.clientX; UI.py = e.clientY; Snd.unlock(); Stats.touch(); }, { passive: true });
  document.addEventListener('click', e => {
    const nav = e.target.closest('#nav [data-tab]');
    if (nav) { Snd.play('click'); Hap.select(); switchTab(nav.dataset.tab); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.closest('#modalRoot')) return;
    const fn = ACT[el.dataset.act];
    if (fn) fn(el, e);
  });
  const inp = document.createElement('input');
  inp.type = 'file'; inp.id = 'importFile'; inp.accept = '.json,application/json,text/plain'; inp.hidden = true;
  document.body.appendChild(inp);
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { importFromText(String(rd.result || '')); inp.value = ''; };
    rd.onerror = () => { toast('{ic:close} Не удалось прочитать файл', 'err'); inp.value = ''; };
    rd.readAsText(f);
  });
}

/* ---------- приветствие ---------- */
function showWelcome(how) {
  if (how === 'migrated') {
    toast('{ic:check} Данные из прошлых версий перенесены, прогресс сохранён', 'long');
  } else if (how === 'new') {
    Modal.open('<h3>' + I('gear') + ' ' + T('welcome') + '</h3><div class="msg">Стартовый запас: ' + CONFIG.startXp + ' XP и ' + CONFIG.startFlames + ' ' + I('flame') + '.\nНажмите на центральную ячейку и задайте главную цель — после этого откроются остальные сектора.\nДолгое нажатие на ячейку открывает блок крупно.</div><div class="btns"><button class="btn" data-r="1">К делу</button></div>').el.addEventListener('click', e => { if (e.target.closest('[data-r]')) Modal.close(Modal.stack[Modal.stack.length - 1]); });
  }
  S.meta.welcome = true; save();
}
