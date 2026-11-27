/* ============================================================
   08-main: запуск приложения
   ============================================================ */
(function boot() {
  try {
    const r = loadState();
    S = r.state;
    if (r.how !== 'v14') persistNow();                 // миграцию/новый профиль фиксируем сразу
    Stats.visit(); Stats.open(S.activeId);             // журнал аналитики: заход (новая сессия — пауза больше 30 минут) и открытая мандала
    Tg.init();
    FX.init();
    wireHooks();
    Hooks.saved = (function (orig) { return function (ok) { orig(ok); if (ok) Tg.scheduleSync(); }; })(Hooks.saved);
    buildGrid(); bindGrid(); bindActions();
    applyTheme(S.activeTheme);
    FX.apply();
    if (checkAchievements(true).length) save();
    applyMode();
    switchTab('mandala');
    if (r.how === 'backup') toast('{ic:undo} Основные данные были повреждены — восстановлена резервная копия', 'long');
    else if (!S.meta.welcome) showWelcome(r.how);
    setTimeout(() => Tg.startupSync(), 700);
    setTimeout(() => Shop.init(), 400);
    // один раз после обновления показываем, где появились фигурки (новому профилю — не мешаем приветствием)
    if (!S.meta.figIntro) { if (r.how === 'new') { S.meta.figIntro = true; save(); } else setTimeout(() => { if (!Modal.stack.length && !S.meta.figIntro) { S.meta.figIntro = true; save(); showFigIntro(); } }, 1800); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) Tg.flush(); else { Stats.visit(); scheduleRender(); } });
    window.addEventListener('resize', () => { if (UI.tab === 'mandala') scheduleRender(); });
  } catch (err) {
    console.error('Mandal-Art boot error', err);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;color:#fca5a5;padding:24px;font:14px/1.5 sans-serif';
    d.textContent = 'Ошибка запуска: ' + (err && err.message ? err.message : err) + '. Данные не тронуты — они лежат в localStorage (ключи mandal_art_*).';
    document.body.appendChild(d);
  }
})();
