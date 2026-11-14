// Telegram-бот для ответственных лиц: ввод взвешиваний фразой, итоги, отправка отчёта, уведомления.
// Работает через long polling (getUpdates) — не нужен публичный адрес и HTTPS. Токен: TELEGRAM_BOT_TOKEN в .env.
const crypto = require('crypto');

function start(deps) {
  // TELEGRAM_BOT_DISABLED=1 — не запускать бота в этом экземпляре (бот может работать только в одном месте: ноутбук ИЛИ Railway)
  const TOKEN = process.env.TELEGRAM_BOT_DISABLED ? '' : process.env.TELEGRAM_BOT_TOKEN;
  const { db, A, AI, savePhoto, getOrCreateReport, reportFull, setStatus, validateEntry, EDITABLE, STATUS_RU, nowIso, buildEntriesXlsx, buildSummaryXlsx } = deps;
  const state = { enabled: !!TOKEN, username: null, error: null, webAppUrl: null };
  if (!TOKEN) return { state, notifyReport() {} };

  const api = async (method, body) => {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(35000),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Telegram API error');
    return j.result;
  };
  const send = (chat_id, text, extra = {}) => api('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra }).catch((e) => console.error('[tg] send:', e.message));
  const h = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fmt = (x, d = 2) => Number(x).toLocaleString('ru-RU', { maximumFractionDigits: d });
  const userByChat = (chatId) => db.prepare(`SELECT u.*, o.short org_short, o.name org_name FROM users u LEFT JOIN organizations o ON o.id=u.org_id
    WHERE u.tg_chat_id=? AND u.active=1`).get(String(chatId));
  const pending = new Map(); // chatId -> распознанные записи, ждущие подтверждения

  const KZ = (u) => u?.lang === 'kz';
  const L = (u, ru, kz) => (KZ(u) ? kz : ru);
  const HELP_KZ = `<b>Өлшеулерді қалай енгізу керек</b>
Не өлшегеніңізді жай ғана жазыңыз, мысалы:
<i>нан 3 кг, картоп 12 кило</i>
Немесе 📷 қалдықтың не таразы таблосының фотосын жіберіңіз.
Өнім мен қалдық түрін ұйымыңыздың анықтамалығы бойынша танып, растауды сұраймын.

/itogi — бүгінгі және айлық қорытынды
/plan — ертең қанша дайындау керек (болжам)
/week — апта қорытындысы
/quarter — тоқсан
/report — айлық Excel-есеп
/send — айлық есепті тексеруге жіберу
/lang — тілді ауыстыру (рус/қаз)
/help — осы көмек`;
  const help = (u) => (KZ(u) ? HELP_KZ : HELP);
  const HELP = `<b>Как вносить взвешивания</b>
Просто напишите, что взвесили, например:
<i>отходы из зала 12 кг, масло 3 литра</i>
<i>хлеб 3 кг, картошка 12 кило</i>
Или пришлите 📷 фото отходов либо табло весов.
Я распознаю продукт и вид отхода по справочнику вашей организации и попрошу подтвердить.

/itogi — итоги за сегодня и за месяц
/plan — сколько готовить завтра (прогноз)
/week — неделя: итоги, топ-3, сравнение с прошлой
/quarter — квартал к прошлому кварталу
/report — Excel-отчёт за месяц прямо в чат
/send — отправить отчёт за месяц на проверку
/lang — сменить язык (рус/қаз)
/help — эта подсказка`;
  const HELP_STAFF = `<b>Сводки по всем подразделениям</b>
/week — неделя: итоги, лидеры, сравнение с прошлой
/quarter — квартал к прошлому кварталу
/report — сводный Excel-отчёт за квартал (принятые данные)
Также буду присылать уведомления об отчётах.`;

  // ---------- привязка аккаунта ----------
  async function onStart(chatId, code, from) {
    if (code) {
      const link = db.prepare('SELECT * FROM tg_links WHERE code=? AND expires_at > ?').get(code, nowIso());
      if (!link) return send(chatId, 'Код устарел. Откройте веб-версию → «Подключить Telegram» и нажмите ссылку снова.');
      db.prepare('UPDATE users SET tg_chat_id=NULL WHERE tg_chat_id=?').run(String(chatId));
      db.prepare('UPDATE users SET tg_chat_id=? WHERE id=?').run(String(chatId), link.user_id);
      db.prepare('DELETE FROM tg_links WHERE user_id=?').run(link.user_id);
      const u = userByChat(chatId);
      return send(chatId, `✅ ${L(u, 'Готово', 'Дайын')}, ${h(u.full_name)}!\n${L(u, 'Аккаунт привязан', 'Аккаунт байланыстырылды')}${u.org_short ? ` — «${h(u.org_short)}»` : ''}.\n\n${u.role === 'resp' ? help(u) : HELP_STAFF}`);
    }
    const u = userByChat(chatId);
    if (u) return send(chatId, `${L(u, 'Вы уже подключены как', 'Сіз қосылғансыз:')} ${h(u.full_name)}.\n\n${help(u)}`);
    return send(chatId, `Здравствуйте${from?.first_name ? ', ' + h(from.first_name) : ''}! Это бот учёта пищевых отходов.\n\nЧтобы подключиться, откройте веб-версию системы → «Подключить Telegram» и нажмите ссылку.`);
  }

  // ---------- ввод фразой ----------
  const orgTypes = (orgId) => db.prepare('SELECT id, name, unit, category, default_method_id FROM waste_types WHERE (org_id=? OR org_id IS NULL) AND active=1').all(orgId);
  const prodLabel = (x, u) => { if (!x.product_id || !KZ(u)) return x.product; const p = db.prepare('SELECT name_kz FROM products WHERE id=?').get(x.product_id); return p?.name_kz || x.product; };
  const itemLine = (x, u) => `• ${x.product ? h(prodLabel(x, u)) + ' → ' : ''}${h(x.name)} — <b>${fmt(x.qty)} ${x.unit}</b>${x.qty_source === 'estimate' ? ` <i>(${L(u, 'оценка', 'шамамен')})</i>` : ''}`;
  function askConfirm(chatId, r, types, head, photo, u) {
    const items = r.items.map((x) => { const t = types.find((y) => y.id === x.waste_type_id); return { ...x, name: t.name, unit: t.unit, method_id: t.default_method_id }; });
    const key = crypto.randomBytes(4).toString('hex');
    pending.set(String(chatId), { key, items, photo, at: Date.now() });
    return send(chatId, `${head}, ${A.today().split('-').reverse().join('.')}:\n${items.map((x) => itemLine(x, u)).join('\n')}${r.unknown?.length ? `\n\n${L(u, 'Не найдено в справочнике', 'Анықтамалықта табылмады')}: ${h(r.unknown.join(', '))}` : ''}${r.note ? `\n\n<i>${h(r.note)}</i>` : ''}${items.some((x) => x.qty_source === 'estimate') ? '\n\n' + L(u, 'Вес оценён по фото — если взвешивали, напишите точный вес фразой.', 'Салмақ фото бойынша бағаланды — өлшеген болсаңыз, нақты салмақты жазыңыз.') : ''}`, {
      reply_markup: { inline_keyboard: [[{ text: `✅ ${L(u, 'Сохранить', 'Сақтау')} (${items.length})`, callback_data: `save:${key}` }, { text: `✖ ${L(u, 'Отмена', 'Болдырмау')}`, callback_data: `cancel:${key}` }]] },
    });
  }
  // фото отходов или табло весов → распознавание (Claude, зрение)
  async function onPhoto(chatId, u, m) {
    const ph = m.photo[m.photo.length - 1];
    const f = await api('getFile', { file_id: ph.file_id });
    const r0 = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`, { signal: AbortSignal.timeout(30000) });
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(await r0.arrayBuffer()).toString('base64');
    send(chatId, L(u, '📷 Смотрю на фото…', '📷 Фотоны қарап жатырмын…'));
    const types = orgTypes(u.org_id);
    const r = await AI.photo(dataUrl, types);
    if (!r.items.length) return send(chatId, `${L(u, 'Не удалось определить отходы на фото.', 'Фотода қалдықтарды анықтау мүмкін болмады.')}${r.note ? '\n' + h(r.note) : ''}\n${L(u, 'Напишите фразой, например', 'Сөйлеммен жазыңыз, мысалы')}: <i>${L(u, 'хлеб 3 кг', 'нан 3 кг')}</i>`);
    return askConfirm(chatId, r, types, L(u, 'Распознано по фото (ИИ)', 'Фото бойынша танылды (ЖИ)'), savePhoto(dataUrl), u);
  }
  async function onText(chatId, u, text) {
    const types = orgTypes(u.org_id);
    const r = await AI.parse(text, types);
    if (!r.items.length) return send(chatId, `${L(u, 'Не нашёл вид отхода и вес. Попробуйте так', 'Қалдық түрі мен салмағы табылмады. Былай жазып көріңіз')}: <i>${L(u, 'очистки овощей 15 кг', 'картоп 15 кг')}</i> ${L(u, 'или пришлите фото', 'немесе фото жіберіңіз')}.\n\n${L(u, 'Виды вашей организации', 'Ұйымыңыздың қалдық түрлері')}:\n${types.map((t) => '• ' + h(t.name)).join('\n')}`);
    return askConfirm(chatId, r, types, `${L(u, 'Распознано', 'Танылды')}${r.source === 'ai' ? L(u, ' (ИИ)', ' (ЖИ)') : ''}`, null, u);
  }
  function saveItems(u, items, photo) {
    const date = A.today(); let ok = 0; const errors = []; let rep;
    for (const x of items) {
      const v = validateEntry(u, { date, qty: x.qty, waste_type_id: x.waste_type_id, method_id: x.method_id });
      if (typeof v === 'string') { errors.push(`${x.name}: ${v}`); continue; }
      rep = getOrCreateReport(u.org_id, date.slice(0, 7));
      if (!EDITABLE.includes(rep.status)) { errors.push(`Отчёт за месяц в статусе «${STATUS_RU[rep.status]}» — запись заблокирована`); break; }
      db.prepare("INSERT INTO entries (report_id, date, waste_type_id, qty, method_id, user_id, created_at, source, product_id, photo) VALUES (?,?,?,?,?,?,?,'telegram',?,?)")
        .run(rep.id, date, v.w.id, v.qty, x.method_id, u.id, nowIso(), x.product_id || null, photo || null);
      ok++;
    }
    return { ok, errors, rep };
  }

  function totalsText(u) {
    const rep = getOrCreateReport(u.org_id, A.today().slice(0, 7));
    const full = reportFull(rep.id);
    const today = full.entries.filter((e) => e.date === A.today());
    const byT = {}; today.forEach((e) => { byT[e.type_name] ??= { q: 0, u: e.unit }; byT[e.type_name].q += e.qty; });
    return `<b>${h(u.org_short)}</b> · отчёт за ${A.monthFull(full.period)} — <i>${h(full.status_ru)}</i>

<b>Сегодня:</b> ${fmt(today.reduce((a, e) => a + e.kg, 0), 1)} кг
${Object.entries(byT).map(([n, v]) => `• ${h(n)} — ${fmt(v.q)} ${v.u}`).join('\n') || '• записей нет'}

<b>За месяц:</b> ${fmt(full.totals.kg, 1)} кг, ${full.entries.length} записей
${full.totals.byType.slice(0, 6).map((t) => `• ${h(t.name)} — ${fmt(t.qty)} ${t.unit}`).join('\n')}`;
  }

  async function onCallback(cb) {
    const chatId = cb.message.chat.id; const u = userByChat(chatId);
    const [act, key] = String(cb.data).split(':');
    const answer = (text) => api('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});
    const done = (text) => api('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text, parse_mode: 'HTML' }).catch(() => {});
    if (!u) return answer('Аккаунт не подключён');
    if (act === 'save' || act === 'cancel') {
      const p = pending.get(String(chatId));
      if (!p || p.key !== key) return answer('Эта запись уже обработана');
      pending.delete(String(chatId));
      if (act === 'cancel') { answer(L(u, 'Отменено', 'Болдырылмады')); return done(`✖ ${L(u, 'Отменено', 'Болдырылмады')}`); }
      const r = saveItems(u, p.items, p.photo);
      answer(r.ok ? `${L(u, 'Сохранено', 'Сақталды')}: ${r.ok}` : L(u, 'Не сохранено', 'Сақталмады'));
      await done(`${r.ok ? `✅ ${L(u, 'Сохранено записей', 'Сақталған жазбалар')}: ${r.ok}` : `⚠️ ${L(u, 'Ничего не сохранено', 'Ештеңе сақталмады')}`}\n${p.items.map((x) => itemLine(x, u)).join('\n')}${r.errors.length ? '\n\n' + r.errors.map(h).join('\n') : ''}`);
      if (r.ok) send(chatId, totalsText(u));
      return;
    }
    if (act === 'submit') {
      const rep = db.prepare('SELECT * FROM reports WHERE id=? AND org_id=?').get(+key, u.org_id);
      if (!rep || !EDITABLE.includes(rep.status)) { answer('Отчёт уже отправлен'); return done('Отчёт уже отправлен или принят.'); }
      setStatus(rep, 'submitted', u, 'Отправлено из Telegram');
      answer('Отправлено'); return done(`📤 Отчёт за ${A.monthFull(rep.period)} отправлен на проверку. Сообщу, когда проверяющий примет решение.`);
    }
    answer('');
  }

  // ---------- сводки периода и отчёт файлом ----------
  const arrow = (c) => (c == null ? '' : c > 0 ? `▲ +${fmt(c, 1)}%` : c < 0 ? `▼ −${fmt(Math.abs(c), 1)}%` : '= 0%');
  function periodText(u, name) {
    const p = A.namedPeriod(name);
    const orgId = u.role === 'resp' ? u.org_id : null;
    const st = A.periodStats({ orgId, ...p, statuses: u.role === 'resp' ? A.ALL_ST : A.ALL_ST });
    const top = st.byType.slice(0, 3).map((t, i) => `${i + 1}. ${h(t.name)} — ${fmt(t.kg, 1)} кг (${st.kg ? Math.round(t.kg / st.kg * 100) : 0}%)`).join('\n');
    let orgs = '';
    if (!orgId) {
      const m = {}; st.rows.forEach((r) => { m[r.org_short] = (m[r.org_short] || 0) + r.kg; });
      orgs = '\n\n<b>По подразделениям:</b>\n' + Object.entries(m).sort((a, b) => b[1] - a[1]).map(([n, kg]) => `• ${h(n)} — ${fmt(kg, 1)} кг`).join('\n');
    }
    return `📊 <b>${orgId ? h(u.org_short) : 'Все подразделения'}</b> · ${h(p.label)}
${p.from.split('-').reverse().join('.')} — ${p.to.split('-').reverse().join('.')}

<b>${fmt(st.kg, 1)} кг</b> отходов · ${st.entries} записей
К прошлому периоду: <b>${arrow(st.changePct)}</b> (было ${fmt(st.prevKg, 1)} кг)
CO₂-экв.: ${fmt(st.co2, 1)} кг · можно снизить на ${fmt(st.co2Potential, 1)} кг
Мимо полигона: ${fmt(st.diverted, 1)}%

<b>Топ-3 вида:</b>
${top || 'нет данных'}${orgs}`;
  }
  async function sendDocument(chatId, buf, filename, caption) {
    const fd = new FormData();
    fd.append('chat_id', String(chatId)); fd.append('caption', caption); fd.append('parse_mode', 'HTML');
    fd.append('document', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
    const j = await r.json(); if (!j.ok) throw new Error(j.description);
  }
  async function onReport(chatId, u) {
    await api('sendChatAction', { chat_id: chatId, action: 'upload_document' }).catch(() => {});
    if (u.role === 'resp') {
      const p = A.namedPeriod('month');
      const st = A.periodStats({ orgId: u.org_id, ...p });
      const buf = await buildEntriesXlsx(st.rows, { title: `Журнал учёта пищевых отходов — ${u.org_name}`, sub: `${p.label}: ${p.from} — ${p.to} · ${st.kg} кг` });
      return sendDocument(chatId, Buffer.from(buf), `${u.org_short}_${p.from.slice(0, 7)}.xlsx`, `📎 Журнал за ${h(p.label)}: ${fmt(st.kg, 1)} кг, ${st.entries} записей. Можно переслать руководству.`);
    }
    const t = A.today(); const val = `${t.slice(0, 4)}-Q${Math.ceil(+t.slice(5, 7) / 3)}`;
    const sm = A.summary('quarter', val);
    const buf = await buildSummaryXlsx(sm);
    return sendDocument(chatId, Buffer.from(buf), `Сводный_отчёт_${val}.xlsx`, `📎 Сводный отчёт: ${h(sm.label)} (принятые данные), ${fmt(sm.totalKg, 1)} кг, CO₂ ${fmt(sm.totalCo2, 1)} кг.`);
  }

  async function onSubmitCmd(chatId, u) {
    const rep = getOrCreateReport(u.org_id, A.today().slice(0, 7));
    const full = reportFull(rep.id);
    if (!full.editable) return send(chatId, `Отчёт за ${A.monthFull(full.period)} уже в статусе «${h(full.status_ru)}».`);
    if (!full.entries.length) return send(chatId, 'В отчёте пока нет записей.');
    return send(chatId, `Отправить отчёт за ${A.monthFull(full.period)} на проверку?\n${full.entries.length} записей, ${fmt(full.totals.kg, 1)} кг.`, {
      reply_markup: { inline_keyboard: [[{ text: '📤 Отправить', callback_data: `submit:${rep.id}` }, { text: 'Не сейчас', callback_data: 'noop:0' }]] },
    });
  }

  async function onMessage(m) {
    const chatId = m.chat.id; const text = (m.text || m.caption || '').trim();
    if (/^\/start/.test(text)) return onStart(chatId, text.split(/\s+/)[1], m.from);
    const u = userByChat(chatId);
    if (!u) return onStart(chatId, null, m.from);
    if (/^\/help/.test(text)) return send(chatId, u.role === 'resp' ? help(u) : HELP_STAFF);
    if (/^\/lang|^\/тіл|^\/язык/i.test(text)) {
      const lang = KZ(u) ? 'ru' : 'kz';
      db.prepare('UPDATE users SET lang=? WHERE id=?').run(lang, u.id);
      return send(chatId, lang === 'kz' ? '🇰🇿 Тіл: қазақша. Қайта ауыстыру — /lang' : '🇷🇺 Язык: русский. Сменить снова — /lang');
    }
    if (/^\/app/.test(text)) {
      if (!state.webAppUrl) return send(chatId, 'Приложение доступно, когда сервер открыт по HTTPS (туннель). Сейчас пользуйтесь командами бота.');
      return send(chatId, '📱 Wasteless внутри Telegram — вход без пароля:', { reply_markup: { inline_keyboard: [[{ text: 'Открыть Wasteless', web_app: { url: state.webAppUrl + '/app?tg=1' } }]] } });
    }
    if (/^\/week|^\/неделя/i.test(text)) return send(chatId, periodText(u, 'week'));
    if (/^\/quarter|^\/квартал/i.test(text)) return send(chatId, periodText(u, 'quarter'));
    if (/^\/report|^\/отч[её]т/i.test(text)) return onReport(chatId, u).catch((e) => send(chatId, 'Не удалось сформировать отчёт: ' + h(e.message)));
    if (u.role !== 'resp') return send(chatId, HELP_STAFF);
    if (/^\/itogi|^\/итоги/i.test(text)) return send(chatId, totalsText(u));
    if (/^\/plan|^\/план|^\/жоспар/i.test(text)) return onPlan(chatId, u);
    if (/^\/send|^\/отправить/i.test(text)) return onSubmitCmd(chatId, u);
    if (m.voice) return send(chatId, '🎙 Голосовые пока не распознаю — нажмите микрофон на клавиатуре телефона (диктовка), и текст придёт мне.');
    if (m.photo?.length) return onPhoto(chatId, u, m).catch((e) => send(chatId, 'Не удалось обработать фото: ' + h(e.message)));
    if (!text) return send(chatId, help(u));
    return onText(chatId, u, text);
  }

  // ---------- уведомления ----------
  function notifyReport(reportId, status, comment) {
    const rep = db.prepare('SELECT r.*, o.short FROM reports r JOIN organizations o ON o.id=r.org_id WHERE r.id=?').get(reportId);
    if (!rep) return;
    const msg = status === 'returned'
      ? `↩️ <b>Отчёт за ${A.monthFull(rep.period)} возвращён на доработку</b>\nКомментарий проверяющего: «${h(comment)}»\n\nИсправьте записи в веб-версии и отправьте снова (/send).`
      : status === 'accepted' ? `✅ <b>Отчёт за ${A.monthFull(rep.period)} принят</b> и включён в единый реестр. Спасибо!` : null;
    if (!msg) return;
    for (const u of db.prepare("SELECT tg_chat_id FROM users WHERE org_id=? AND role='resp' AND tg_chat_id IS NOT NULL AND active=1").all(rep.org_id)) send(u.tg_chat_id, msg);
  }
  // ---------- прогноз «сколько готовить» ----------
  const FC = require('./forecast');
  function planText(u, date) {
    const f = FC.forecast(u.org_id, date);
    if (f.closed || !f.items.length) return null;
    const nm = (x) => h(KZ(u) && x.name_kz ? x.name_kz : x.name);
    const lines = f.items.map((x) => `• ${nm(x)} — <b>${fmt(x.rec_kg, 1)} кг</b>${x.save_kg >= 0.5 ? ` <i>(${L(u, 'обычно', 'әдетте')} ${fmt(x.usual_kg, 1)}, −${fmt(x.save_kg, 1)})</i>` : ''}`).join('\n');
    return `🍳 <b>${L(u, 'Сколько готовить', 'Қанша дайындау керек')}: ${f.weekday} ${date.split('-').reverse().join('.')}</b>\n${lines}\n\n`
      + (f.totals.save_kg >= 1 ? `${L(u, 'Если готовить по плану', 'Жоспар бойынша дайындасаңыз')}: −${fmt(f.totals.save_kg, 1)} ${L(u, 'кг отходов', 'кг қалдық')}, ≈ ${fmt(f.totals.save_kzt, 0)} ₸, −${fmt(f.totals.save_co2, 1)} кг CO₂\n` : '')
      + `<i>${L(u, `Спрос по этому дню недели за ${f.weeks} нед. + запас ${f.safetyPct}%`, `Соңғы ${f.weeks} аптадағы осы күнгі сұраныс + ${f.safetyPct}% қор`)}</i>`;
  }
  function onPlan(chatId, u) {
    let d = FC.addDays(A.today(), 1);
    for (let k = 0; k < 7; k++, d = FC.addDays(d, 1)) { const t = planText(u, d); if (t) return send(chatId, t); }
    return send(chatId, L(u, 'Пока нет истории производства. Вносите в приложении «Итог дня: приготовлено / осталось» — через 2 недели появится прогноз.', 'Өндіріс тарихы әзірге жоқ. Қосымшада «Күн қорытындысы: дайындалды / қалды» енгізіңіз — 2 аптадан кейін болжам пайда болады.'));
  }
  // утром в 7:00 по Алматы — план на сегодня тем, у кого есть история производства
  const planned = new Set();
  setInterval(() => {
    const now = new Date(Date.now() + 5 * 3600e3); const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== 7) return;
    for (const u of db.prepare("SELECT * FROM users WHERE role='resp' AND tg_chat_id IS NOT NULL AND active=1").all()) {
      const k = `${u.id}|${day}`; if (planned.has(k)) continue; planned.add(k);
      const t = planText(u, day); if (t) send(u.tg_chat_id, t);
    }
  }, 10 * 60 * 1000).unref();

  // напоминание в 17:00 по Алматы, если сегодня ещё нет записей (кроме воскресенья)
  const reminded = new Set();
  setInterval(() => {
    const now = new Date(Date.now() + 5 * 3600e3); const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== 17 || now.getUTCDay() === 0) return;
    for (const u of db.prepare("SELECT u.id, u.org_id, u.tg_chat_id FROM users u WHERE u.role='resp' AND u.tg_chat_id IS NOT NULL AND u.active=1").all()) {
      const k = `${u.id}|${day}`; if (reminded.has(k)) continue;
      const has = db.prepare('SELECT COUNT(*) c FROM entries e JOIN reports r ON r.id=e.report_id WHERE r.org_id=? AND e.date=?').get(u.org_id, day).c;
      reminded.add(k);
      if (!has) send(u.tg_chat_id, '⏰ Сегодня ещё нет взвешиваний. Напишите, что взвесили, например: <i>очистки овощей 15 кг</i>');
    }
  }, 10 * 60 * 1000).unref();

  // ---------- цикл получения обновлений ----------
  (async () => {
    try {
      const me = await api('getMe'); state.username = me.username;
      await api('deleteWebhook', {});
      await api('setMyCommands', { commands: [{ command: 'itogi', description: 'Итоги за день и месяц' }, { command: 'plan', description: 'Сколько готовить завтра' }, { command: 'week', description: 'Неделя: итоги и сравнение' },
        { command: 'quarter', description: 'Квартал к прошлому кварталу' }, { command: 'report', description: 'Excel-отчёт в чат' },
        { command: 'send', description: 'Отправить отчёт на проверку' }, { command: 'app', description: 'Открыть приложение Wasteless' }, { command: 'lang', description: 'Язык: рус / қаз' }, { command: 'help', description: 'Подсказка' }] });
      // меню команд на казахском — для пользователей с казахским интерфейсом Telegram
      await api('setMyCommands', { language_code: 'kk', commands: [{ command: 'itogi', description: 'Күн мен ай қорытындысы' }, { command: 'plan', description: 'Ертең қанша дайындау' }, { command: 'week', description: 'Апта қорытындысы' },
        { command: 'quarter', description: 'Тоқсан' }, { command: 'report', description: 'Excel-есеп чатқа' },
        { command: 'send', description: 'Есепті тексеруге жіберу' }, { command: 'app', description: 'Wasteless қосымшасын ашу' }, { command: 'lang', description: 'Тіл: рус / қаз' }, { command: 'help', description: 'Көмек' }] }).catch(() => {});
      console.log(`Telegram-бот запущен: @${me.username}`);
    } catch (e) { state.error = e.message; console.error('[tg] не удалось запустить бота:', e.message); return; }
    let offset = 0;
    for (;;) {
      try {
        const ups = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const up of ups) {
          offset = up.update_id + 1;
          try { if (up.message) await onMessage(up.message); else if (up.callback_query) await onCallback(up.callback_query); }
          catch (e) { console.error('[tg] обработка:', e.message); }
        }
      } catch (e) {
        state.error = e.message;
        // 409 Conflict: тот же бот уже запущен в другом месте (например, на Railway) — не спамим и ждём дольше
        const conflict = /conflict|terminated by other getUpdates/i.test(e.message);
        if (conflict && !state.conflictLogged) { console.error('[tg] этот бот уже запущен в другом экземпляре — здесь он ждёт. Чтобы отключить: TELEGRAM_BOT_DISABLED=1'); state.conflictLogged = true; }
        await new Promise((r) => setTimeout(r, conflict ? 30000 : 3000));
      }
    }
  })();

  // мини-приложение: кнопка меню бота открывает Wasteless внутри Telegram (только HTTPS — через туннель или PUBLIC_URL)
  async function setWebAppUrl(url) {
    if (!/^https:\/\//.test(url || '') || state.webAppUrl === url || !state.username) return;
    state.webAppUrl = url;
    try { await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Wasteless', web_app: { url: url + '/app?tg=1' } } }); console.log(`[tg] мини-приложение: ${url}`); }
    catch (e) { state.webAppUrl = null; console.error('[tg] menu button:', e.message); }
  }
  setTimeout(() => { if (process.env.PUBLIC_URL) setWebAppUrl(process.env.PUBLIC_URL.replace(/\/$/, '')); }, 3000);
  return { state, notifyReport, setWebAppUrl, openAppButton: () => state.webAppUrl };
}

module.exports = { start };
