// Отправка писем через Resend (https://resend.com, HTTP API, без зависимостей).
// Переменные: RESEND_API_KEY, MAIL_FROM (например «Wasteless <noreply@ваш-домен.kz>»).
// Без ключа письма не уходят, а пишутся в лог сервера — удобно для разработки и тестов.
const enabled = () => !!process.env.RESEND_API_KEY;
const FROM = () => process.env.MAIL_FROM || 'Wasteless <onboarding@resend.dev>';
const last = []; // последние письма в режиме без ключа (для тестов)

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function layout(title, body, button) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#16213d">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <div style="font-weight:800;font-size:20px;color:#15275a;margin-bottom:16px">🌿 Wasteless</div>
    <div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #e1e6f0">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
      ${body}
      ${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#15275a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:700;display:inline-block">${esc(button.text)}</a></p>
      <p style="font-size:12px;color:#66728c;word-break:break-all">Если кнопка не открывается, скопируйте ссылку: ${esc(button.url)}</p>` : ''}
    </div>
    <p style="font-size:12px;color:#66728c;margin-top:14px">Wasteless — учёт пищевых отходов. Вы получили это письмо, потому что ваш адрес указан в аккаунте.</p>
  </div></body></html>`;
}

async function send({ to, subject, html, text }) {
  if (!enabled()) {
    console.log(`[mail] (без RESEND_API_KEY письмо не отправлено) → ${to}: ${subject}\n${text || ''}`);
    last.push({ to, subject, text }); if (last.length > 50) last.shift();
    return { sent: false };
  }
  const r = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM(), to: [to], subject, html, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Resend ${r.status}: ${t.slice(0, 200)}`); }
  return { sent: true };
}

const templates = {
  reset: ({ name, url }) => ({
    subject: 'Wasteless: восстановление пароля',
    text: `${name}, чтобы задать новый пароль, откройте ссылку (действует 1 час): ${url}\nЕсли вы не запрашивали сброс — просто проигнорируйте письмо.`,
    html: layout('Восстановление пароля', `<p>${esc(name)}, кто-то (надеемся, вы) запросил сброс пароля. Ссылка действует 1 час.</p><p style="color:#66728c">Если это были не вы — просто проигнорируйте письмо, пароль не изменится.</p>`, { url, text: 'Задать новый пароль' }),
  }),
  verify: ({ name, url }) => ({
    subject: 'Wasteless: подтвердите e-mail',
    text: `${name}, подтвердите адрес e-mail для Wasteless: ${url}`,
    html: layout('Подтвердите e-mail', `<p>${esc(name)}, добро пожаловать в Wasteless! Подтвердите адрес, чтобы мы могли восстановить доступ, если вы забудете пароль.</p>`, { url, text: 'Подтвердить e-mail' }),
  }),
  invite: ({ company, role, inviter, url }) => ({
    subject: `Приглашение в Wasteless: ${company}`,
    text: `${inviter} приглашает вас в «${company}» (${role}). Присоединиться: ${url}`,
    html: layout(`Вас приглашают в «${company}»`, `<p>${esc(inviter)} приглашает вас в Wasteless — учёт пищевых отходов компании.</p><p>Роль: <b>${esc(role)}</b>. Ссылка действует 7 дней.</p>`, { url, text: 'Присоединиться' }),
  }),
};
async function sendTemplate(kind, to, data) { const t = templates[kind](data); return send({ to, ...t }); }

module.exports = { enabled, send, sendTemplate, last };
