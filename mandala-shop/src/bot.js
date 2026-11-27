// Диспетчер обновлений Telegram (вебхук): платежи, возвраты и команды бота.
import { all } from './db.js';
import { getSetting } from './ctx.js';
import { markReachable, remindStatusText, stopReminders } from './reminders.js';
import { markUpdate, handlePreCheckout, handleSuccessfulPayment, handleRefundedPayment, safeSend } from './payments.js';
import { DEFAULT_PAYSUPPORT, DEFAULT_TERMS, helpText, startText, supportText } from './texts.js';
import { currentTermsVersion } from './users.js';
import { escHtml, jsonParse } from './util.js';

export async function handleUpdate(ctx, update) {
  if (!update || !Number.isSafeInteger(update.update_id)) return { ignored: true };
  if (update.pre_checkout_query) return handlePreCheckout(ctx, update.pre_checkout_query, update.update_id);
  const m = update.message;
  if (!m) return { ignored: true };
  if (m.successful_payment) return handleSuccessfulPayment(ctx, m, update.update_id);
  if (m.refunded_payment) return handleRefundedPayment(ctx, m, update.update_id);
  if (typeof m.text === 'string' && m.chat && m.chat.type === 'private' && m.from && Number.isSafeInteger(m.from.id)) return handleText(ctx, m, update.update_id);
  return { ignored: true };
}

const STATUS_RU = { created: 'создан', pending: 'ожидает оплаты', paid: 'оплачен', cancelled: 'отменён', expired: 'истёк', failed: 'ошибка', refunded: 'возвращён' };

async function handleText(ctx, m, updateId) {
  if (!markUpdate(ctx, updateId, 'message')) return { duplicate: true };
  const chat = m.chat.id;
  const first = m.text.trim().split(/\s+/)[0] || '';
  const cmd = first.startsWith('/') ? first.slice(1).split('@')[0].toLowerCase() : '';
  const url = ctx.cfg.publicUrl + '/';
  markReachable(ctx, m.from.id);   // раз пользователь пишет боту, бот может писать ему
  switch (cmd) {
    case 'start':
      await safeSend(ctx, chat, escHtml(startText()), { reply_markup: { inline_keyboard: [[{ text: 'Открыть Mandal-Art', web_app: { url } }]] } });
      break;
    case 'terms':
      await safeSend(ctx, chat, escHtml(getSetting(ctx, 'terms_text', DEFAULT_TERMS)) + `\n\n<i>Версия условий: ${escHtml(currentTermsVersion(ctx))}</i>`);
      break;
    case 'paysupport': {
      const rows = all(ctx.db, 'SELECT id, amount, status, product_snapshot, created_at FROM orders WHERE tg_id = ? ORDER BY created_at DESC LIMIT 5', m.from.id);
      let text = escHtml(getSetting(ctx, 'paysupport_text', DEFAULT_PAYSUPPORT));
      const contact = getSetting(ctx, 'support_contact', ctx.cfg.supportContact);
      text += '\n\n' + (contact ? 'Контакт: ' + escHtml(contact) : 'Контакт поддержки пока не указан владельцем бота.');
      if (rows.length) {
        text += '\n\nВаши последние заказы:\n' + rows.map(r => `• <code>${escHtml(r.id)}</code> — «${escHtml(jsonParse(r.product_snapshot, {}).title || '')}», ${r.amount} Stars, ${STATUS_RU[r.status] || r.status}`).join('\n');
      }
      await safeSend(ctx, chat, text);
      break;
    }
    case 'remind':
      await safeSend(ctx, chat, remindStatusText(ctx, m.from.id), url.startsWith('https://') ? { reply_markup: { inline_keyboard: [[{ text: 'Настроить в приложении', web_app: { url } }]] } } : undefined);
      break;
    case 'stop':
      await safeSend(ctx, chat, stopReminders(ctx, m.from.id));
      break;
    case 'support':
      await safeSend(ctx, chat, escHtml(supportText(getSetting(ctx, 'support_contact', ctx.cfg.supportContact))));
      break;
    default:
      await safeSend(ctx, chat, escHtml(helpText()));
  }
  return { handled: cmd || 'text' };
}
