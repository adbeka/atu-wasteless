/* АТУ · Цифровая система учёта пищевых отходов — клиент (SPA без сборки) */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 1) => (x == null || isNaN(x) ? '—' : Number(x).toLocaleString('ru-RU', { maximumFractionDigits: d }));
const kgT = (kg) => (kg >= 1000 ? `${fmt(kg / 1000, 2)} т` : `${fmt(kg, 1)} кг`);
const dmy = (d) => d ? d.slice(0, 10).split('-').reverse().join('.') : '';
const dt = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const monthName = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
// «сегодня» по Алматы (UTC+5) — так же, как на сервере
const todayIso = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const minDate = () => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCMonth(d.getUTCMonth() - 12); return d.toISOString().slice(0, 7) + '-01'; };
const ROLE_RU = { resp: 'Ответственное лицо', reviewer: 'Проверяющий', admin: 'Администратор', manager: 'Руководство' };
const STATUS_RU = { draft: 'черновик', submitted: 'отправлено', in_review: 'на проверке', accepted: 'принято', returned: 'возвращено', none: 'нет отчёта' };
const ORG_COLORS = ['#1f6f4a', '#d08c00', '#1d5fa8', '#9b3d8f', '#c2410c', '#0f766e', '#6b7280'];
const PIE_COLORS = ['#1f6f4a', '#2e8b5e', '#62b087', '#a3d4b6', '#d08c00', '#f0b648', '#1d5fa8', '#7aa7dd', '#9b3d8f', '#c2410c', '#9ca3af'];

// ---------- i18n (рус / қаз) ----------
const I18N = {
  kz: {
    'Ввод': 'Енгізу', 'Мои отчёты': 'Есептерім', 'Аналитика': 'Талдау', 'Отчёты': 'Есептер', 'Реестр': 'Тізілім', 'Сводный отчёт': 'Жиынтық есеп',
    'Контроль сдачи': 'Тапсыру бақылауы', 'Администрирование': 'Әкімшілік', 'Выйти': 'Шығу', 'Вид отхода': 'Қалдық түрі', 'Вес / объём': 'Салмағы / көлемі',
    'Способ утилизации': 'Кәдеге жарату тәсілі', 'Дата': 'Күні', 'Сохранить запись': 'Жазбаны сақтау', 'Отправить на проверку': 'Тексеруге жіберу',
    'Сегодня': 'Бүгін', 'За месяц': 'Ай бойы', 'Фото': 'Фото', 'Новый вид': 'Жаңа түр', 'Записи': 'Жазбалар', 'Автовыводы': 'Автоқорытындылар',
    'Вход в систему': 'Жүйеге кіру', 'Войти': 'Кіру', 'Пароль': 'Құпиясөз', 'Регистрация': 'Тіркелу',
  },
};
let LANG = localStorage.getItem('lang') || 'ru';
const T = (s) => (LANG === 'kz' && I18N.kz[s]) || s;

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) { const e = new Error(data?.error || `Ошибка ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}
function toast(msg, err) {
  $('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.appendChild(t);
  if (window.anime && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    t.style.animation = 'none';
    anime({ targets: t, translateY: [24, 0], translateX: ['-50%', '-50%'], opacity: [0, 1], scale: [.92, 1], duration: 650, easing: 'spring(1, 90, 12, 0)' });
    setTimeout(() => anime({ targets: t, opacity: 0, translateY: 12, translateX: ['-50%', '-50%'], duration: 260, easing: 'easeInQuad', complete: () => t.remove() }), err ? 5000 : 2600);
  } else setTimeout(() => t.remove(), err ? 5000 : 2600);
}
function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
  document.body.appendChild(bg); onMount?.(bg.firstElementChild, () => bg.remove());
  return bg;
}
const CAT = { organic: { ic: '🥕', label: 'Органические' }, recyclable: { ic: '♻️', label: 'Вторсырьё' }, special: { ic: '🛢️', label: 'Специальные' }, mixed: { ic: '📦', label: 'Смешанные' } };
const catIcon = (c) => `<span class="ic cat-${CAT[c] ? c : 'organic'}">${(CAT[c] || CAT.organic).ic}</span>`;
const SRC_ICON = { voice: ' · 🎙 фразой', scale: ' · ⚖ с весов', telegram: ' · ✈ Telegram' };
// лёгкий отклик вибрацией на телефоне
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch {} };
// карточка подключения Telegram-бота (для ответственного лица — ввод из мессенджера, для всех — уведомления)
async function telegramCard(el) {
  let st; try { st = await api('/telegram/status'); } catch { return; }
  const tg = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M9.8 15.6 9.6 19c.4 0 .6-.2.8-.4l2-1.9 4.1 3c.8.4 1.3.2 1.5-.7l2.7-12.7c.3-1.1-.4-1.6-1.2-1.3L3.6 10.9c-1.1.4-1.1 1-.2 1.3l4.1 1.3 9.6-6c.4-.3.9-.1.5.2"/></svg>';
  el.innerHTML = `<div class="tg-card"><div class="tg-ic">${tg}</div><div class="tg-t"><b>Telegram-бот</b>
      <small>${st.linked ? `Подключено${st.username ? ' · @' + esc(st.username) : ''} — пишите боту «отходы из зала 12 кг»` : st.enabled ? 'Вносите взвешивания сообщением, получайте уведомления о проверке' : 'Бот не настроен на сервере (TELEGRAM_BOT_TOKEN)'}</small></div>
    ${st.linked ? `<a class="btn btn-sm btn-light" href="https://t.me/${esc(st.username || '')}" target="_blank" rel="noopener">Открыть</a><button class="btn-sm icon-btn" id="tgOff" title="Отключить">✕</button>`
      : `<button class="btn-sm" id="tgOn" ${st.username ? '' : 'disabled'}>Подключить</button>`}</div>`;
  $('#tgOn', el)?.addEventListener('click', async () => {
    try { const r = await api('/telegram/link', { method: 'POST' }); window.open(r.url, '_blank'); toast('Откройте Telegram и нажмите «Запустить» — аккаунт привяжется'); setTimeout(() => telegramCard(el), 8000); }
    catch (e) { toast(e.message, true); }
  });
  $('#tgOff', el)?.addEventListener('click', async () => { await api('/telegram/unlink', { method: 'POST' }); telegramCard(el); });
}
// блок «Заключение»: числа считают правила, ИИ формулирует; без ключа — текст по правилам
async function loadConclusion(el, qs) {
  el.innerHTML = '<p class="muted small">Формирую заключение…</p>';
  try {
    const c = await api('/ai/conclusion?' + qs);
    el.innerHTML = `<div style="margin-bottom:6px">${c.source === 'ai' ? '<span class="chip tag-ai">сформулировано ИИ · Claude</span>' : '<span class="chip st-draft">по правилам системы</span>'}
      ${c.reason ? `<span class="small muted"> ${esc(c.reason)}</span>` : ''}</div><div class="text">${esc(c.text)}</div>
      <p class="small muted" style="margin-bottom:0">Все числа в заключении посчитаны системой по данным реестра; ИИ не добавляет новых цифр.</p>`;
  } catch (e) { el.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
}
const chip = (st, label) => `<span class="chip st-${esc(st)}">${esc(label || STATUS_RU[st] || st)}</span>`;

// ---------- state & router ----------
const S = { user: null, charts: [] };
const NAV = {
  resp: [['me', 'Моя сводка', '◉'], ['form', 'Ввод', '✎'], ['my-reports', 'Мои отчёты', '☰'], ['dashboard', 'Аналитика', '▤']],
  reviewer: [['reports', 'Отчёты', '✓'], ['registry', 'Реестр', '☰'], ['summary', 'Сводный отчёт', '⇩'], ['dashboard', 'Аналитика', '▤'], ['control', 'Контроль сдачи', '!']],
  manager: [['dashboard', 'Аналитика', '▤'], ['summary', 'Сводный отчёт', '⇩'], ['registry', 'Реестр', '☰'], ['control', 'Контроль сдачи', '!']],
  admin: [['admin', 'Администрирование', '⚙'], ['reports', 'Отчёты', '✓'], ['registry', 'Реестр', '☰'], ['summary', 'Сводный отчёт', '⇩'], ['dashboard', 'Аналитика', '▤'], ['control', 'Контроль сдачи', '!']],
};
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q] = h.split('?');
  const parts = p.split('/').filter(Boolean);
  return { page: parts[0] || '', id: parts[1], q: Object.fromEntries(new URLSearchParams(q || '')) };
}
const go = (h) => { location.hash = h; };

async function route() {
  S.charts.forEach((c) => c.destroy()); S.charts = [];
  const r = parseHash();
  if (!S.cfg) { try { S.cfg = await api('/config'); } catch { S.cfg = { systemName: 'EcoTrack', company: '', orgLabel: 'Организация', orgsLabel: 'Организации', industryLabel: '' }; } }
  if (!S.user) {
    try { S.user = (await api('/me')).user; } catch { S.user = null; }
  }
  // мини-приложение Telegram: вход по подписанным данным Telegram, без пароля
  const TG = window.Telegram?.WebApp;
  if (!S.user && TG?.initData && !S.tgTried) {
    S.tgTried = true;
    try { await api('/telegram/webapp-login', { method: 'POST', body: { initData: TG.initData } }); S.user = (await api('/me')).user; }
    catch (e) { toast(e.message, true); }
  }
  if (!S.user) {
    if (r.page === 'register') return renderRegister(r);
    return renderLogin(r);
  }
  const nav = NAV[S.user.role];
  if (!r.page || r.page === 'login') return go('/' + nav[0][0]);
  shell(r.page);
  const main = $('main');
  const pages = { me: pageMe, form: pageForm, 'my-reports': pageReports, reports: pageReports, report: pageReport, registry: pageRegistry,
    summary: pageSummary, dashboard: pageDashboard, control: pageControl, admin: pageAdmin };
  const fn = pages[r.page];
  if (!fn) { main.innerHTML = '<div class="card">Страница не найдена</div>'; return; }
  try { await fn(main, r); animateIn(main); } catch (e) { main.innerHTML = `<div class="alert alert-red">${esc(e.message)}</div>`; if (e.status === 401) { S.user = null; route(); } }
}
window.addEventListener('hashchange', route);

const ICONS = {
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  spark: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z"/>',
};
ICONS.arrow = '<path d="M5 12h14M13 6l6 6-6 6"/>';
const icon = (n) => `<svg class="i" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

// ---------- анимации (anime.js v3, локально; отключаются при «уменьшить движение») ----------
const MOTION = !!window.anime && !matchMedia('(prefers-reduced-motion: reduce)').matches;
// страховка: если вкладка в фоне и анимация не отыграла, контент всё равно становится видимым
const failsafe = (els) => setTimeout(() => [...els].forEach((e) => { if (+getComputedStyle(e).opacity < 1) { e.style.opacity = ''; e.style.transform = ''; } }), 2600);
function animateIn(root) {
  if (!MOTION || !root) return;
  const els = [...root.querySelectorAll('.hero, .card, .kpi, .hero-kpi, .ins, .type-btn, .tot-box')].slice(0, 46);
  failsafe(els);
  anime({ targets: els, opacity: [0, 1], translateY: [16, 0], delay: anime.stagger(28, { start: 30 }), duration: 560, easing: 'easeOutCubic' });
  countUp(root);
}
// числа в KPI «набегают» от нуля, сохраняя формат (12,2 т · −8,48 т · 3,7%)
function countUp(root) {
  if (!MOTION) return;
  root.querySelectorAll('.hero-kpi .value, .kpi .value, .tot-box .big').forEach((el) => {
    const src = el.innerHTML; if (el.querySelector('span')) return; // стрелки ▲▼ не трогаем
    const m = /(-?\d[\d\s ]*)(?:,(\d+))?/.exec(el.textContent); if (!m) return;
    const dec = m[2] ? m[2].length : 0; const val = Number((m[1] + (m[2] ? '.' + m[2] : '')).replace(/[\s ]/g, ''));
    const [pre, post] = [el.textContent.slice(0, m.index), el.textContent.slice(m.index + m[0].length)];
    const o = { v: 0 };
    anime({ targets: o, v: val, duration: 1100, easing: 'easeOutExpo', update: () => { el.textContent = pre + o.v.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + post; },
      complete: () => { el.innerHTML = src; } });
  });
}
function animateLogin() {
  if (!MOTION) return;
  failsafe($$('.login-art .brand, .login-art .eyebrow, .login-art h1, .login-art .lead, .feat, .login-panel, .role, .chip-org, .demo-note'));
  const tl = anime.timeline({ easing: 'easeOutCubic' });
  tl.add({ targets: '.login-art .brand, .login-art .eyebrow, .login-art h1, .login-art .lead', opacity: [0, 1], translateY: [22, 0], delay: anime.stagger(90), duration: 700 })
    .add({ targets: '.feat', opacity: [0, 1], translateX: [-24, 0], delay: anime.stagger(90), duration: 600 }, '-=450')
    .add({ targets: '.login-panel', opacity: [0, 1], translateY: [24, 0], scale: [.98, 1], duration: 650 }, 150)
    .add({ targets: '.role, .chip-org, .demo-note', opacity: [0, 1], translateY: [12, 0], delay: anime.stagger(55), duration: 480 }, 380);
  anime({ targets: '.orb', translateX: () => anime.random(-40, 40), translateY: () => anime.random(-30, 30), scale: () => [1, anime.random(90, 120) / 100],
    duration: () => anime.random(5000, 8000), direction: 'alternate', loop: true, easing: 'easeInOutSine' });
  anime({ targets: '.rings', rotate: 360, duration: 60000, loop: true, easing: 'linear' });
  anime({ targets: '.rings circle', strokeDashoffset: [anime.setDashoffset, 0], duration: 2200, delay: anime.stagger(250), easing: 'easeInOutSine' });
  // «магнитные» карточки ролей
  $$('.role').forEach((b) => {
    b.onmouseenter = () => anime({ targets: b.querySelector('.role-go'), translateX: [0, 5], duration: 300, easing: 'easeOutBack' });
    b.onmouseleave = () => anime({ targets: b.querySelector('.role-go'), translateX: 0, duration: 250, easing: 'easeOutQuad' });
  });
}
const LOGO = `<div class="logo"><svg viewBox="0 0 24 24">${ICONS.leaf}</svg></div>`;
const NAV_ICON = { me: 'leaf', form: 'edit', 'my-reports': 'list', dashboard: 'chart', reports: 'check', registry: 'db', summary: 'file', control: 'alert', admin: 'gear' };
const initials = (n) => String(n).split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function shell(page) {
  const nav = NAV[S.user.role];
  const links = nav.map(([k, label]) => ({ k, label: T(label), active: page === k || (page === 'report' && (k === 'reports' || k === 'my-reports')) }));
  const navHtml = links.map((l) => `<a href="#/${l.k}" class="${l.active ? 'active' : ''}">${icon(NAV_ICON[l.k])}<span>${esc(l.label)}</span></a>`).join('');
  const lang = (short) => `<div class="lang"><button data-lang="ru" class="${LANG === 'ru' ? 'on' : ''}">${short ? 'РУ' : 'РУС'}</button><button data-lang="kz" class="${LANG === 'kz' ? 'on' : ''}">ҚАЗ</button></div>`;
  $('#app').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">${LOGO}<div><b>${esc(S.cfg.systemName)}</b><small>${esc(S.cfg.company)}</small></div></div>
      <div class="nav-group">${S.user.role === 'resp' ? esc(S.user.org_short || '') : esc(S.cfg.industryLabel)}</div>
      <nav class="side-nav">${navHtml}</nav>
      <div class="side-foot">
        <div class="me"><div class="avatar">${esc(initials(S.user.full_name))}</div><div><b>${esc(S.user.full_name)}</b><small>${esc(ROLE_RU[S.user.role])}</small></div></div>
        <div class="side-actions">${lang(false)}<button class="btn-ghost-light" data-logout>${icon('out')}${T('Выйти')}</button></div>
      </div>
    </aside>
    <div style="min-width:0">
      <header class="topbar"><div class="brand">${LOGO}<div><b>${esc(S.user.org_short || S.cfg.systemName)}</b></div></div>
        ${lang(true)}<button class="btn-ghost-light" data-logout title="${T('Выйти')}">${icon('out')}</button></header>
      <main></main>
    </div>
  </div>
  <nav class="bottom-nav">${links.slice(0, 5).map((l) => `<a href="#/${l.k}" class="${l.active ? 'active' : ''}">${icon(NAV_ICON[l.k])}${esc(l.label.split(' ')[0])}</a>`).join('')}</nav>`;
  $$('[data-logout]').forEach((b) => b.onclick = async () => { await api('/logout', { method: 'POST' }); S.user = null; go('/login'); route(); });
  $$('[data-lang]').forEach((b) => b.onclick = () => { LANG = b.dataset.lang; localStorage.setItem('lang', LANG); route(); });
}

// ---------- login / register ----------
const role = (email, ic, title, sub, tone) => `<button type="button" class="role tone-${tone}" data-demo="${email}">
  <span class="role-ic">${icon(ic)}</span><span class="role-t"><b>${title}</b><small>${sub}</small></span><span class="role-go">${icon('arrow')}</span></button>`;

async function renderLogin(r) {
  let orgName = '';
  if (r.q.org) { try { orgName = (await api('/orgs')).find((o) => o.id === +r.q.org)?.name || ''; } catch {} }
  const feat = (ic, b, t) => `<div class="feat"><div class="logo"><svg viewBox="0 0 24 24">${ICONS[ic]}</svg></div><div><b>${b}</b><span>${t}</span></div></div>`;
  $('#app').innerHTML = `
  <div class="login">
    <section class="login-art">
      <div class="orbs" aria-hidden="true"><span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span>
        <svg class="rings" viewBox="0 0 400 400"><circle cx="200" cy="200" r="120"/><circle cx="200" cy="200" r="160"/><circle cx="200" cy="200" r="198"/></svg></div>
      <div class="brand">${LOGO}<div><b>${esc(S.cfg.systemName)}</b><small>${esc(S.cfg.company)}</small></div></div>
      <div><div class="eyebrow" style="color:var(--lime)">Цифровой учёт пищевых отходов · ЦУР 12.3</div>
        <h1>От бумажного журнала к отчёту и выводам — за минуту</h1>
        <p class="lead">Взвешивание со смартфона, проверка отчёта, единый реестр, CO₂ по DEFRA и автоматические рекомендации, как сократить потери.</p></div>
      <div class="feats">
        ${feat('edit', 'Ввод за 3 касания', 'плитки видов отходов, фраза или голос, электронные весы по API')}
        ${feat('check', 'Проверка и статусы', 'черновик → отправлено → на проверке → принято / возвращено')}
        ${feat('spark', 'Автовыводы и заключение ИИ', 'отклонения, потенциал переработки, потери в ₸, путь к ЦУР 12.3')}
        ${feat('db', 'Под любую отрасль', 'университет, пищевое производство, общепит, ритейл — справочник из Excel')}
      </div>
    </section>
    <section class="login-form"><div class="login-card">
      ${orgName ? `<div class="alert alert-green">Форма учёта: <b>${esc(orgName)}</b>. Войдите, чтобы внести взвешивание.</div>` : ''}
      <div class="card login-panel">
        <h2 style="margin-bottom:4px">${T('Вход в систему')}</h2>
        <p class="small muted" style="margin:0 0 14px">Выберите роль — система откроется сразу с нужным экраном</p>
        <div class="seg" role="tablist"><span class="seg-pill"></span>
          <button type="button" class="on" data-seg="quick">Быстрый вход</button><button type="button" data-seg="mail">По e-mail</button></div>
        <div data-pane="quick">
          <div class="roles">
            ${role('iskander@atu.kz', 'edit', 'Ответственное лицо', 'Столовая «Искандер» · ввод со смартфона', 'lime')}
            ${role('reviewer@atu.kz', 'check', 'Проверяющий', 'эколог · принимает и возвращает отчёты', 'blue')}
            ${role('director@atu.kz', 'chart', 'Руководство', 'аналитика, CO₂, заключение', 'violet')}
            ${role('admin@atu.kz', 'gear', 'Администратор', 'подразделения, справочники, отрасль', 'amber')}
          </div>
          <div class="orgs-title">Другие ответственные лица</div>
          <div class="org-chips">
            ${[['inn@atu.kz', 'ATU INN'], ['canella@atu.kz', 'Кофейня Canella'], ['tpp@atu.kz', 'Кафедра ТПП'], ['thipp@atu.kz', 'Кафедра ТХиПП']]
              .map(([e, n]) => `<button type="button" class="chip-org" data-demo="${e}"><span>${esc(initials(n.replace(/[«»]/g, '')))}</span>${esc(n)}</button>`).join('')}
          </div>
          <p class="demo-note">🔑 Демо-пароль для всех ролей — <code>demo123</code> · <a href="/">О системе</a></p>
        </div>
        <form id="lf" data-pane="mail" class="hidden">
          <div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="username" required></div>
          <div class="field"><label>${T('Пароль')}</label><input name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn-lg">${T('Войти')}</button>
          <p class="small" style="text-align:center;margin:12px 0 0">Нет учётной записи? <a href="#/register${r.q.org ? '?org=' + esc(r.q.org) : ''}">${T('Регистрация')}</a></p>
        </form>
      </div>
    </div></section>
  </div>`;
  const seg = (k) => {
    $$('[data-seg]').forEach((b) => b.classList.toggle('on', b.dataset.seg === k));
    $$('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== k));
    const on = $(`[data-seg="${k}"]`); const pill = $('.seg-pill');
    if (window.anime && MOTION) anime({ targets: pill, translateX: on.offsetLeft - 4, width: on.offsetWidth, duration: 380, easing: 'easeOutElastic(1, .8)' });
    else { pill.style.transform = `translateX(${on.offsetLeft - 4}px)`; pill.style.width = on.offsetWidth + 'px'; }
    if (MOTION) anime({ targets: $(`[data-pane="${k}"]`).children, opacity: [0, 1], translateY: [10, 0], delay: anime.stagger(45), duration: 420, easing: 'easeOutCubic' });
    if (k === 'mail') $('#lf input').focus();
  };
  $$('[data-seg]').forEach((b) => b.onclick = () => seg(b.dataset.seg));
  requestAnimationFrame(() => { const on = $('[data-seg="quick"]'); const pill = $('.seg-pill'); pill.style.width = on.offsetWidth + 'px'; });
  animateLogin();
  const login = async (email, password) => {
    try { await api('/login', { method: 'POST', body: { email, password } }); S.user = (await api('/me')).user;
      go(r.q.org && S.user.role === 'resp' ? '/form' : '/' + NAV[S.user.role][0][0]); route(); }
    catch (e) { toast(e.message, true); }
  };
  $('#lf').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); login(f.get('email'), f.get('password')); };
  $$('[data-demo]').forEach((b) => b.onclick = () => login(b.dataset.demo, 'demo123'));
  // с лендинга: «войти как …» — только демо-учётки (их пароль и так опубликован на странице)
  if (/^[a-z]+@atu\.kz$/.test(r.q.demo || '')) login(r.q.demo, 'demo123');
}
async function renderRegister(r) {
  const orgs = await api('/orgs');
  $('#app').innerHTML = `<div class="login-form" style="min-height:100vh"><div class="login-card"><div class="brand" style="color:var(--forest);padding:0 0 14px">${LOGO}<div><b>${esc(S.cfg.systemName)}</b></div></div><div class="card">
    <h2>Регистрация ответственного лица</h2>
    <form id="rf">
      <div class="field"><label>Имя пользователя</label><input name="full_name" required placeholder="напр. iskander"></div>
      <div class="field"><label>Служебный e-mail</label><input name="email" type="email" required></div>
      <div class="field"><label>Пароль (мин. 6 символов)</label><input name="password" type="password" minlength="6" required></div>
      <div class="field"><label>${esc(S.cfg.orgLabel)}</label><select name="org_id" required>${orgs.map((o) => `<option value="${o.id}" ${+r.q.org === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>
      <p class="small muted">Обрабатываются только служебные данные (имя пользователя, e-mail) — Закон РК «О персональных данных и их защите». Роль и привязку может изменить администратор.</p>
      <button class="btn-lg">Зарегистрироваться</button>
    </form>
    <p class="small" style="text-align:center"><a href="#/login">Уже есть учётная запись</a></p></div></div></div>`;
  $('#rf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/register', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); S.user = (await api('/me')).user; go('/form'); route(); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- ФОРМА ВВОДА (ответственное лицо) ----------
async function pageForm(main) {
  const [types, methods] = await Promise.all([api('/waste-types'), api('/methods')]);
  const activeMethods = methods.filter((m) => m.active);
  const DKEY = `draft-entry-${S.user.id}`;
  let draft = {}; try { draft = JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch {}
  const st = { date: draft.date && draft.date <= todayIso() ? draft.date : todayIso(), typeId: draft.typeId || null, qty: draft.qty || '', methodId: draft.methodId || null, photo: null, editId: null };
  let report = await api('/my-report?period=' + st.date.slice(0, 7));

  main.innerHTML = `<div class="form-wrap">
    <div class="page-head"><div><h1>${esc(S.user.org_name)}</h1><div class="muted small">Ответственное лицо: ${esc(S.user.full_name)}</div></div></div>
    <div id="status"></div>
    <div class="card quick" id="quickCard">
      <h3 style="margin-bottom:6px">⚡ Быстрый ввод фразой</h3>
      <div class="small muted" style="margin-bottom:8px">Скажите или напишите, например: «отходы из зала 12 кило, масло 3 литра»</div>
      <div class="qty-row"><input id="phrase" placeholder="что взвесили…" autocomplete="off" style="font-size:16px;font-weight:400;text-align:left">
        <button type="button" class="btn-light" id="mic" title="Голосовой ввод" style="min-width:52px">🎙</button><button type="button" id="parse">→</button></div>
      <div id="preview" class="preview"></div>
    </div>
    <div class="card" id="entryCard">
      <div class="row" style="margin-bottom:12px">
        <div class="field"><label>${T('Дата')}</label><input type="date" id="date" min="${minDate()}" max="${todayIso()}" value="${st.date}"></div>
      </div>
      <label>${T('Вид отхода')}</label>
      <div class="types" id="types"></div>
      <div class="field"><label>${T('Вес / объём')}</label>
        <div class="qty-row"><input id="qty" inputmode="decimal" autocomplete="off" placeholder="0,0" value="${esc(st.qty)}"><div class="unit" id="unit">кг</div></div></div>
      <div id="recHint"></div>
      <div class="field"><label>${T('Способ утилизации')}</label><select id="method">${activeMethods.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field photo-btn"><label class="btn btn-light btn-sm" style="margin:0;color:var(--ink)">📷 ${T('Фото')}<input type="file" id="photo" accept="image/*" capture="environment" hidden></label><span id="photoPrev" class="small muted">необязательно</span></div>
      <div style="display:flex;gap:8px"><button class="btn-lg" id="save" style="flex:1">${T('Сохранить запись')}</button>
        <button class="btn-lg btn-sec" id="scale" type="button" style="width:auto" title="Получить вес с электронных весов">⚖ Весы</button></div>
      <button class="btn-lg btn-light hidden" id="cancelEdit" style="margin-top:8px">Отменить редактирование</button>
      <div class="saved-hint" id="hint"></div>
    </div>
    <div class="card"><div class="totals" id="totals"></div></div>
    <div class="card" id="tgCard"></div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${T('Записи')} за ${monthName(report.period)}</h3><span class="small muted" id="cnt"></span></div><div id="list"></div></div>
    <div class="card" id="histCard"></div>
  </div>`;

  const saveDraft = () => { localStorage.setItem(DKEY, JSON.stringify({ date: st.date, typeId: st.typeId, qty: st.qty, methodId: st.methodId })); $('#hint').textContent = st.qty || st.typeId ? 'Черновик сохранён автоматически' : ''; };
  const typeById = (id) => types.find((t) => t.id === +id);

  function renderTypes() {
    $('#types').innerHTML = types.map((t) => `<button type="button" class="type-btn ${st.typeId === t.id ? 'sel' : ''}" data-t="${t.id}">${catIcon(t.category)}<span class="nm">${esc(t.name)}</span><small>${t.unit}</small></button>`).join('')
      + `<button type="button" class="type-btn add" id="addType">＋ ${T('Новый вид')}</button>`;
    $$('[data-t]').forEach((b) => b.onclick = () => selectType(+b.dataset.t));
    $('#addType').onclick = addTypeDialog;
  }
  function selectType(id, keepMethod) {
    st.typeId = id; const t = typeById(id);
    $('#unit').textContent = t?.unit || 'кг';
    if (t && !keepMethod) { st.methodId = t.default_method_id; $('#method').value = t.default_method_id; }
    renderTypes(); renderRecHint(); saveDraft(); $('#qty').focus();
  }
  // экоподсказка: рекомендуемый способ из справочника и сколько CO₂ он экономит
  function renderRecHint() {
    const t = typeById(st.typeId);
    const cur = methods.find((m) => m.id === +$('#method').value);
    if (!t || !t.recommended_method_id || !cur || +$('#method').value === t.recommended_method_id || cur.rank <= (t.rec_rank ?? 5)) { $('#recHint').innerHTML = ''; return; }
    const save = t.co2_factor - (t.rec_co2 ?? 0);
    $('#recHint').innerHTML = `<div class="rec-hint">🌱 <span>Рекомендуется: <b>${esc(t.rec_name)}</b>${!cur.is_recycling && save > 0 ? ` — минус ${fmt(save, 2)} кг CO₂ на каждый кг` : ''}</span><button type="button" id="useRec">Выбрать</button></div>`;
    $('#useRec').onclick = () => { $('#method').value = t.recommended_method_id; st.methodId = t.recommended_method_id; saveDraft(); renderRecHint(); };
  }
  function addTypeDialog() {
    modal(`<h2>Новый вид отхода</h2>
      <p class="small muted">Сохранится в справочник вашей организации и будет доступен в форме.</p>
      <div class="field"><label>Наименование</label><input id="ntName" placeholder="напр. Хлебные остатки"></div>
      <div class="row"><div class="field"><label>Единица</label><select id="ntUnit"><option>кг</option><option>л</option></select></div>
      <div class="field"><label>Способ по умолчанию</label><select id="ntMethod">${activeMethods.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div></div>
      <label style="display:flex;gap:8px;align-items:center;margin:12px 0;color:var(--ink)"><input type="checkbox" id="ntRec" style="width:auto"> Пригоден к переработке (компост, вторсырьё)</label>
      <div class="row"><button id="ntSave">Добавить</button><button class="btn-light" data-close>Отмена</button></div>`, (m, close) => {
      $('#ntName', m).focus();
      $('#ntSave', m).onclick = async () => {
        try {
          const { id } = await api('/waste-types', { method: 'POST', body: { name: $('#ntName', m).value, unit: $('#ntUnit', m).value, default_method_id: $('#ntMethod', m).value, recyclable: $('#ntRec', m).checked } });
          types.push(...(await api('/waste-types')).filter((t) => t.id === id));
          close(); toast('Вид отхода добавлен в справочник'); selectType(id);
        } catch (e) { toast(e.message, true); }
      };
    });
  }

  function renderReport() {
    const ed = report.editable;
    const dl = new Date(+report.period.slice(0, 4), +report.period.slice(5, 7), 5);
    const daysLeft = Math.ceil((dl - new Date()) / 864e5);
    let s = `<div class="card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
      <div>Отчёт за <b>${monthName(report.period)}</b> ${chip(report.status, report.status_ru)}
      <div class="small muted">Срок сдачи: до 5 ${MONTHS_GEN[dl.getMonth()]} ${daysLeft >= 0 ? `(осталось ${daysLeft} дн.)` : ''}</div></div>
      ${ed ? `<button id="submit" class="btn-sec" ${report.entries.length ? '' : 'disabled'}>${T('Отправить на проверку')}</button>` : ''}</div>`;
    if (report.status === 'returned') s = `<div class="alert alert-red"><b>Отчёт возвращён на доработку.</b> Комментарий проверяющего: «${esc(report.last_comment)}». Исправьте записи и отправьте повторно.</div>` + s;
    if (['submitted', 'in_review'].includes(report.status)) s = `<div class="alert alert-blue">Отчёт ${report.status === 'submitted' ? 'отправлен' : 'на проверке'} — редактирование заблокировано до решения проверяющего.</div>` + s;
    if (report.status === 'accepted') s = `<div class="alert alert-green">Отчёт принят ${dt(report.decided_at)} и включён в единый реестр. Редактирование заблокировано.</div>` + s;
    if (ed && daysLeft >= 0 && daysLeft <= 3) s = `<div class="alert alert-amber">Напоминание: до сдачи отчёта осталось ${daysLeft} дн.</div>` + s;
    $('#status').innerHTML = s;
    $('#entryCard').style.opacity = ed ? 1 : .55; $('#save').disabled = !ed; $('#scale').disabled = !ed;
    $('#quickCard')?.classList.toggle('hidden', !ed);
    if ($('#submit')) $('#submit').onclick = async () => {
      if (!confirm(`Отправить отчёт за ${monthName(report.period)} (${report.entries.length} записей, ${fmt(report.totals.kg)} кг) на проверку?`)) return;
      try { report = await api(`/reports/${report.id}/submit`, { method: 'POST' }); toast('Отчёт отправлен на проверку'); renderAll(); } catch (e) { toast(e.message, true); }
    };

    // итоги за день и месяц (вычисляются из записей)
    const day = report.entries.filter((e) => e.date === st.date);
    const sumBy = (rows) => { const m = {}; rows.forEach((e) => { m[e.type_name] ??= { q: 0, u: e.unit }; m[e.type_name].q += e.qty; }); return Object.entries(m).sort((a, b) => b[1].q - a[1].q); };
    const dayKg = day.reduce((a, e) => a + e.kg, 0);
    $('#totals').innerHTML = `
      <div class="tot-box"><div class="small muted">${st.date === todayIso() ? T('Сегодня') : dmy(st.date)}</div><div class="big">${fmt(dayKg)} кг</div>
        <ul>${sumBy(day).map(([n, v]) => `<li><span>${esc(n)}</span><b class="nowrap">${fmt(v.q, 2)} ${v.u}</b></li>`).join('') || '<li class="muted">нет записей</li>'}</ul></div>
      <div class="tot-box"><div class="small muted">${T('За месяц')} · ${MONTHS[+report.period.slice(5, 7) - 1]}</div><div class="big">${fmt(report.totals.kg)} кг</div>
        <ul>${report.totals.byType.map((t) => `<li><span>${esc(t.name)}</span><b class="nowrap">${fmt(t.qty, 2)} ${t.unit}</b></li>`).join('') || '<li class="muted">нет записей</li>'}</ul></div>`;
    $('#cnt').textContent = `${report.entries.length} записей`;
    const byDate = {}; report.entries.forEach((e) => (byDate[e.date] ??= []).push(e));
    $('#list').innerHTML = Object.entries(byDate).slice(0, 12).map(([d, es]) => `<div class="small muted" style="margin-top:10px"><b>${dmy(d)}</b> · ${fmt(es.reduce((a, e) => a + e.kg, 0))} кг</div>` +
      es.map((e) => `<div class="entry"><div class="t">${esc(e.type_name)}<small>${esc(e.method_name)}${e.photo ? ' · 📷' : ''}${SRC_ICON[e.source] || ''}</small></div><div class="q">${fmt(e.qty, 2)} ${e.unit}</div>
        ${ed ? `<button class="icon-btn" data-edit="${e.id}" title="Изменить">✎</button><button class="icon-btn" data-del="${e.id}" title="Удалить">✕</button>` : ''}</div>`).join('')).join('')
      + (Object.keys(byDate).length > 12 ? `<p class="small muted">… и ещё ${Object.keys(byDate).length - 12} дн. — <a href="#/report/${report.id}">открыть отчёт полностью</a></p>` : '')
      || '<p class="muted">Пока нет записей за этот месяц.</p>';
    $$('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Удалить запись?')) return;
      try { report = (await api('/entries/' + b.dataset.del, { method: 'DELETE' })).report; renderAll(); } catch (e) { toast(e.message, true); }
    });
    $$('[data-edit]').forEach((b) => b.onclick = () => {
      const e = report.entries.find((x) => x.id === +b.dataset.edit);
      st.editId = e.id; st.date = e.date; $('#date').value = e.date; selectType(e.type_id, true); st.qty = String(e.qty); $('#qty').value = e.qty;
      st.methodId = e.method_id; $('#method').value = e.method_id; $('#save').textContent = 'Сохранить изменения'; $('#cancelEdit').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#histCard').innerHTML = `<h3>История отчёта</h3>${historyHtml(report.history)}`;
  }
  const renderAll = () => { renderTypes(); renderReport(); };

  const resetEdit = () => { st.editId = null; $('#save').textContent = T('Сохранить запись'); $('#cancelEdit').classList.add('hidden'); };
  $('#cancelEdit').onclick = () => { resetEdit(); st.qty = ''; $('#qty').value = ''; };
  $('#date').onchange = async (e) => {
    if (e.target.value > todayIso()) { e.target.value = todayIso(); toast('Дата не может быть в будущем', true); }
    if (e.target.value < minDate()) { e.target.value = minDate(); toast('Можно вносить записи не старше 12 месяцев', true); }
    st.date = e.target.value; saveDraft();
    if (st.date.slice(0, 7) !== report.period) report = await api('/my-report?period=' + st.date.slice(0, 7));
    renderReport();
  };
  $('#qty').oninput = (e) => { st.qty = e.target.value.replace(/[^\d.,]/g, ''); e.target.value = st.qty; saveDraft(); };
  $('#method').onchange = (e) => { st.methodId = +e.target.value; saveDraft(); renderRecHint(); };
  $('#photo').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    st.photo = await compressImage(f);
    if (!st.photo) return;
    $('#photoPrev').innerHTML = `<img src="${st.photo}" alt=""> фото прикреплено`;
  };
  $('#save').onclick = async () => {
    const qty = parseFloat(String(st.qty).replace(',', '.'));
    if (!st.typeId) return toast('Выберите вид отхода', true);
    if (!(qty > 0)) { $('#qty').focus(); return toast('Введите вес/объём больше 0', true); }
    const body = { date: st.date, waste_type_id: st.typeId, qty, method_id: +$('#method').value, photo: st.photo };
    const send = async (force) => {
      try {
        const r = st.editId ? await api('/entries/' + st.editId, { method: 'PUT', body }) : await api('/entries', { method: 'POST', body: { ...body, force } });
        report = r.report; buzz(); toast(st.editId ? 'Запись изменена' : `Сохранено: ${typeById(st.typeId)?.name} — ${fmt(qty, 2)} ${typeById(st.typeId)?.unit}`);
        resetEdit(); st.qty = ''; st.photo = null; $('#qty').value = ''; $('#photo').value = ''; $('#photoPrev').textContent = 'необязательно';
        localStorage.removeItem(DKEY); $('#hint').textContent = ''; renderAll();
      } catch (e) {
        if (e.status === 409 && e.data?.duplicate) { if (confirm(e.message)) return send(true); return; }
        toast(e.message, true);
      }
    };
    send(false);
  };
  // ---- быстрый ввод фразой / голосом (ИИ разбирает фразу в записи, человек подтверждает)
  let parsed = [];
  const renderPreview = (src, unknown = []) => {
    $('#preview').innerHTML = parsed.length ? `<div class="small muted" style="margin:10px 0 4px">Распознано ${src === 'ai' ? '<span class="chip st-accepted">ИИ · Claude</span>' : '<span class="chip st-draft">по ключевым словам</span>'} — проверьте и сохраните:</div>
      ${parsed.map((p, i) => `<div class="entry"><div class="t">${esc(p.name)}<small>${esc(p.fragment || '')}</small></div>
        <input data-pq="${i}" value="${p.qty}" inputmode="decimal" style="width:80px;text-align:right"><span class="small">${p.unit}</span><button class="icon-btn" data-px="${i}">✕</button></div>`).join('')}
      ${unknown.length ? `<div class="small" style="color:var(--amber)">Не найдено в справочнике: ${unknown.map(esc).join(', ')} — добавьте через «＋ Новый вид»</div>` : ''}
      <button class="btn-lg" id="saveAll" style="margin-top:10px">Сохранить ${parsed.length} ${parsed.length === 1 ? 'запись' : 'записи'}</button>`
      : `<div class="small" style="color:var(--amber);margin-top:8px">Не удалось распознать вид и вес — попробуйте «очистки овощей 15 кг».</div>`;
    $$('[data-pq]').forEach((x) => x.oninput = () => { parsed[+x.dataset.pq].qty = parseFloat(x.value.replace(',', '.')); });
    $$('[data-px]').forEach((x) => x.onclick = () => { parsed.splice(+x.dataset.px, 1); renderPreview(src, unknown); });
    if ($('#saveAll')) $('#saveAll').onclick = async () => {
      let ok = 0;
      for (const p of parsed) {
        try { const r = await api('/entries', { method: 'POST', body: { date: st.date, waste_type_id: p.waste_type_id, qty: p.qty, method_id: p.method_id, source: 'voice', force: true } }); report = r.report; ok++; }
        catch (e) { toast(`${p.name}: ${e.message}`, true); }
      }
      if (ok) { toast(`Сохранено записей: ${ok}`); parsed = []; $('#phrase').value = ''; $('#preview').innerHTML = ''; renderAll(); }
    };
  };
  const doParse = async () => {
    const text = $('#phrase').value.trim(); if (!text) return $('#phrase').focus();
    $('#parse').disabled = true; $('#parse').textContent = '…';
    try { const r = await api('/ai/parse', { method: 'POST', body: { text } }); parsed = r.items; renderPreview(r.source, r.unknown); }
    catch (e) { toast(e.message, true); }
    finally { $('#parse').disabled = false; $('#parse').textContent = '→'; }
  };
  $('#parse').onclick = doParse;
  $('#phrase').onkeydown = (e) => { if (e.key === 'Enter') doParse(); };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('#mic').onclick = () => {
    if (!SR) return toast('Голосовой ввод браузера недоступен (нужен HTTPS) — используйте микрофон на клавиатуре телефона', true);
    const rec = new SR(); rec.lang = LANG === 'kz' ? 'kk-KZ' : 'ru-RU'; rec.interimResults = false;
    $('#mic').textContent = '⏺'; rec.onend = () => { $('#mic').textContent = '🎙'; };
    rec.onerror = (e) => toast('Микрофон: ' + e.error, true);
    rec.onresult = (e) => { $('#phrase').value = e.results[0][0].transcript; doParse(); };
    rec.start();
  };
  // ---- электронные весы (эмулятор устройства; реальные весы шлют POST /api/scale/entries)
  $('#scale').onclick = async () => {
    if (!st.typeId) return toast('Выберите вид отхода и положите его на весы', true);
    try { const r = await api('/scale/emulate', { method: 'POST', body: { waste_type_id: st.typeId } }); report = r.report; toast(`⚖ С весов: ${r.waste_type} — ${fmt(r.qty, 2)} ${r.unit}`); renderAll(); }
    catch (e) { toast(e.message, true); }
  };
  $('#quickCard').classList.toggle('hidden', !report.editable);

  telegramCard($('#tgCard'));
  if (st.typeId && typeById(st.typeId)) { selectType(st.typeId, true); if (st.methodId) $('#method').value = st.methodId; renderRecHint(); if (st.qty) $('#hint').textContent = 'Восстановлен несохранённый черновик'; }
  renderAll();
}

function compressImage(file) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Не удалось прочитать фото — сохраните запись без него', true); res(null); };
    img.src = url;
  });
}

function historyHtml(h) {
  if (!h.length) return '<p class="muted small">Отчёт ещё не отправлялся.</p>';
  return `<ul class="timeline">${h.map((x) => `<li class="${x.to_status === 'returned' ? 'ret' : ''}"><b>${esc(x.from_ru)} → ${esc(x.to_ru)}</b>
    <div class="small muted">${dt(x.at)} · ${esc(x.user_name)} (${esc(ROLE_RU[x.user_role])})</div>${x.comment ? `<div class="c">💬 ${esc(x.comment)}</div>` : ''}</li>`).join('')}</ul>`;
}

// ---------- СПИСОК ОТЧЁТОВ ----------
async function pageReports(main, r) {
  const isResp = S.user.role === 'resp';
  const orgs = isResp ? [] : await api('/orgs');
  const q = { status: r.q.status ?? (isResp ? '' : ''), org: r.q.org || '', period: r.q.period || '' };
  const list = await api('/reports?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))));
  const pending = list.filter((x) => ['submitted', 'in_review'].includes(x.status)).length;
  main.innerHTML = `
    <div class="page-head"><div><h1>${isResp ? T('Мои отчёты') : 'Отчёты организаций'}</h1>
      <div class="muted small">${isResp ? esc(S.user.org_name) : `Ожидают проверки: <b>${pending}</b>`}</div></div></div>
    ${isResp ? '' : `<div class="card no-print"><div class="row">
      <div class="field"><label>Статус</label><select id="fs"><option value="">все</option>${Object.entries(STATUS_RU).filter(([k]) => k !== 'none').map(([k, v]) => `<option value="${k}" ${q.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>${esc(S.cfg.orgLabel)}</label><select id="fo"><option value="">все</option>${orgs.map((o) => `<option value="${o.id}" ${+q.org === o.id ? 'selected' : ''}>${esc(o.short)}</option>`).join('')}</select></div>
      <div class="field"><label>Период</label><input type="month" id="fp" value="${esc(q.period)}"></div></div></div>`}
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Период</th>${isResp ? '' : `<th>${esc(S.cfg.orgLabel)}</th>`}<th>Статус</th><th class="num">Записей</th><th class="num">Масса, кг</th><th>Отправлен</th><th>Комментарий</th></tr></thead>
      <tbody>${list.map((x) => `<tr class="click" data-id="${x.id}"><td class="nowrap"><b>${monthName(x.period)}</b></td>${isResp ? '' : `<td>${esc(x.org_short)}</td>`}
        <td>${chip(x.status, x.status_ru)}</td><td class="num">${x.n}</td><td class="num">${fmt(x.kg)}</td><td class="small nowrap">${dt(x.submitted_at)}</td><td class="small">${esc(x.status === 'returned' ? x.last_comment : '')}</td></tr>`).join('')
        || '<tr><td colspan="7" class="muted">Нет отчётов</td></tr>'}</tbody></table></div></div>`;
  $$('tr[data-id]').forEach((tr) => tr.onclick = () => go('/report/' + tr.dataset.id));
  if (!isResp) {
    const upd = () => go('/reports?' + new URLSearchParams(Object.fromEntries(Object.entries({ status: $('#fs').value, org: $('#fo').value, period: $('#fp').value }).filter(([, v]) => v))));
    ['#fs', '#fo', '#fp'].forEach((s) => $(s).onchange = upd);
  }
}

// ---------- КАРТОЧКА ОТЧЁТА ----------
async function pageReport(main, r) {
  const rep = await api('/reports/' + r.id);
  const staff = S.user.role !== 'resp';
  const canDecide = ['reviewer', 'admin'].includes(S.user.role) && ['submitted', 'in_review'].includes(rep.status);
  const days = rep.totals.byDay.slice().sort((a, b) => a.date.localeCompare(b.date));
  const typeNames = rep.totals.byType.map((t) => t.name);
  main.innerHTML = `
    <div class="page-head"><div><a href="#/${staff ? 'reports' : 'my-reports'}" class="small no-print">← к списку</a>
      <h1>${esc(rep.org_name)}</h1><div>Отчёт за <b>${monthName(rep.period)}</b> ${chip(rep.status, rep.status_ru)}
      ${rep.reviewer_name ? `<span class="small muted"> · проверяющий: ${esc(rep.reviewer_name)}</span>` : ''}</div></div>
      <div class="row no-print">${!staff && rep.editable ? `<a class="btn" href="#/form">Редактировать в форме</a>` : ''}<button class="btn-light" onclick="print()">Печать / PDF</button></div></div>
    ${rep.status === 'returned' ? `<div class="alert alert-red"><b>Возвращено на доработку:</b> ${esc(rep.last_comment)}</div>` : ''}
    ${canDecide ? `<div class="card no-print" style="border:2px solid var(--green)"><h3>Решение по отчёту</h3>
      <div class="field"><label>Комментарий (обязателен при возврате)</label><textarea id="cmt" rows="2" placeholder="Что нужно исправить…"></textarea></div>
      <div class="row"><button id="acc">✓ Принять отчёт</button><button id="ret" class="btn-red">↩ Вернуть на доработку</button></div></div>` : ''}
    <div class="grid g2">
      ${rep.checks ? `<div class="card"><h3>Автопроверка системы</h3><ul class="checks">${rep.checks.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join('')}</ul></div>` : ''}
      <div class="card"><h3>Итоги за месяц по видам отходов</h3><div class="table-wrap"><table><thead><tr><th>Наименование</th><th class="num">Кол-во</th><th class="num">кг</th></tr></thead>
        <tbody>${rep.totals.byType.map((t) => `<tr><td>${esc(t.name)}${t.recyclable === 2 ? ' ♻' : ''}</td><td class="num">${fmt(t.qty, 2)} ${t.unit}</td><td class="num">${fmt(t.kg)}</td></tr>`).join('')}
        <tr class="total"><td>ИТОГО</td><td></td><td class="num">${fmt(rep.totals.kg)}</td></tr></tbody></table></div></div>
      ${rep.checks ? '' : `<div class="card"><h3>История изменений</h3>${historyHtml(rep.history)}</div>`}
    </div>
    <div class="card"><h3>Итоги за день (журнал по образцу таблицы учёта)</h3><div class="table-wrap" style="max-height:420px"><table>
      <thead><tr><th>Дата</th>${typeNames.map((n) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">Итого, кг</th></tr></thead>
      <tbody>${days.map((d) => `<tr><td class="nowrap">${dmy(d.date)}</td>${typeNames.map((n) => `<td class="num">${d.items[n] ? fmt(d.items[n], 2) : ''}</td>`).join('')}<td class="num"><b>${fmt(d.kg)}</b></td></tr>`).join('')}
      <tr class="sub"><td>За месяц</td>${rep.totals.byType.map((t) => `<td class="num">${fmt(t.qty, 2)} ${t.unit}</td>`).join('')}<td class="num">${fmt(rep.totals.kg)}</td></tr></tbody></table></div></div>
    <div class="card"><h3>Записи (${rep.entries.length})</h3><div class="table-wrap" style="max-height:380px"><table>
      <thead><tr><th>Дата</th><th>Наименование отходов</th><th class="num">Вес / объём</th><th>Способ утилизации</th><th>Ответственный</th><th>Фото</th></tr></thead>
      <tbody>${rep.entries.map((e) => `<tr><td class="nowrap">${dmy(e.date)}</td><td>${esc(e.type_name)}${SRC_ICON[e.source] || ''}</td><td class="num">${fmt(e.qty, 2)} ${e.unit}</td><td>${esc(e.method_name)}</td><td class="small">${esc(e.user_name)}</td>
        <td>${e.photo ? `<a href="/api/photo/${esc(e.photo)}" target="_blank">📷</a>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    ${rep.checks ? `<div class="card"><h3>История изменений</h3>${historyHtml(rep.history)}</div>` : ''}`;
  if (canDecide) {
    $('#acc').onclick = async () => { try { await api(`/reports/${rep.id}/accept`, { method: 'POST', body: { comment: $('#cmt').value } }); toast('Отчёт принят — данные в едином реестре'); route(); } catch (e) { toast(e.message, true); } };
    $('#ret').onclick = async () => {
      if (!$('#cmt').value.trim()) { $('#cmt').focus(); return toast('Укажите комментарий — что исправить', true); }
      try { await api(`/reports/${rep.id}/return`, { method: 'POST', body: { comment: $('#cmt').value } }); toast('Отчёт возвращён на доработку'); route(); } catch (e) { toast(e.message, true); }
    };
  }
}

// ---------- РЕЕСТР ----------
// быстрые периоды: срез в один тап вместо двух дат
const PERIOD_CHIPS = [['week', 'Неделя'], ['month', 'Этот месяц'], ['prev_month', 'Прошлый месяц'], ['quarter', 'Этот квартал'], ['prev_quarter', 'Прошлый квартал'], ['year', 'Год']];
function chipRange(k) {
  const t = todayIso(); const y = +t.slice(0, 4), m = +t.slice(5, 7), q = Math.ceil(m / 3);
  const ms = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const me = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${new Date(yy, mm, 0).getDate()}`;
  const back = (d) => { const x = new Date(t + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };
  if (k === 'week') return { from: back(6), to: t };
  if (k === 'month') return { from: ms(y, m), to: t };
  if (k === 'prev_month') { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { from: ms(py, pm), to: me(py, pm) }; }
  if (k === 'quarter') return { from: ms(y, q * 3 - 2), to: t };
  if (k === 'prev_quarter') { const pq = q === 1 ? 4 : q - 1, py = q === 1 ? y - 1 : y; return { from: ms(py, pq * 3 - 2), to: me(py, pq * 3) }; }
  return { from: `${y}-01-01`, to: t };
}

// ---------- МОЯ СВОДКА (ответственное лицо: данные под рукой с телефона) ----------
async function pageMe(main) {
  const s = await api('/my-summary');
  const arrow = (c) => c == null ? '<span class="muted">—</span>' : `<span class="${c > 0 ? 'up' : 'down'}">${c > 0 ? '▲' : '▼'} ${fmt(Math.abs(c))}%</span>`;
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const rep = s.report;
  main.innerHTML = `
    <section class="hero">
      <div class="eyebrow">${esc(S.user.org_short)} · ${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>Моя сводка</h1>
      <div class="muted small">Все ваши данные под рукой: сегодня, неделя, месяц. Отчёт — одной кнопкой.</div>
      <div class="hero-kpis">
        <div class="hero-kpi lime"><div class="label">Сегодня</div><div class="value">${fmt(s.today.kg)} кг</div><div class="sub">${s.today.entries} взвеш.</div></div>
        <div class="hero-kpi"><div class="label">7 полных дней</div><div class="value">${fmt(s.week.kg)} кг</div><div class="sub">к прошлой неделе: ${arrow(s.week.changePct)}</div></div>
        <div class="hero-kpi"><div class="label">Этот месяц</div><div class="value">${fmt(s.month.kg)} кг</div><div class="sub">${s.month.entries} записей</div></div>
        <div class="hero-kpi"><div class="label">CO₂ за месяц</div><div class="value">${fmt(s.month.co2)} кг</div><div class="sub">можно −${fmt(s.month.co2Potential)} кг</div></div>
        <div class="hero-kpi"><div class="label">Отчёт за месяц</div><div class="value" style="font-size:17px;margin-top:6px">${chip(rep.status, rep.status_ru)}</div><div class="sub">срок — до 5 числа</div></div>
      </div>
    </section>
    ${rep.status === 'returned' ? `<div class="alert alert-red"><b>Отчёт возвращён:</b> ${esc(rep.last_comment)} — <a href="#/form">исправить</a></div>` : ''}
    <div class="quick-actions">
      <a class="qa" href="#/form">${icon('edit')}<b>Внести</b><small>форма, фраза, весы</small></a>
      <a class="qa" href="/api/my-report.xlsx?p=month">${icon('file')}<b>Отчёт за месяц</b><small>Excel, можно переслать</small></a>
      <a class="qa" href="/api/my-report.xlsx?p=week">${icon('db')}<b>Отчёт за неделю</b><small>Excel</small></a>
      <a class="qa" href="#/report/${rep.id}">${icon('check')}<b>Статус отчёта</b><small>история и комментарии</small></a>
    </div>
    <div class="grid g2">
      <div class="card"><h3>По дням — 7 полных дней</h3><div class="chart-box" style="height:220px"><canvas id="cw"></canvas></div></div>
      <div class="card"><h3>Что больше всего за неделю</h3>
        ${s.week.byType.slice(0, 5).map((t) => `<div class="bar-row"><span>${esc(t.name)}</span><b>${fmt(t.kg)} кг</b><i style="width:${s.week.kg ? Math.max(4, t.kg / s.week.byType[0].kg * 100) : 0}%"></i></div>`).join('') || '<p class="muted">Нет данных за неделю</p>'}
        <p class="small muted" style="margin:10px 0 0">Мимо полигона за месяц: <b>${fmt(s.month.diverted)}%</b>. Подсказки «🌱 Рекомендуется» в форме помогают поднять эту долю.</p></div>
    </div>
    <div class="card" id="tgCard"></div>`;
  telegramCard($('#tgCard'));
  S.charts.push(new Chart($('#cw'), { type: 'bar', data: { labels: s.week.byDay.map((d) => `${wd[new Date(d.date + 'T00:00:00').getDay()]} ${d.date.slice(8)}`),
    datasets: [{ data: s.week.byDay.map((d) => d.kg), backgroundColor: '#23935d', borderRadius: 8, maxBarThickness: 34 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#eef1ee' } } } } }));
}

async function pageRegistry(main, r) {
  const [orgs, types, methods] = await Promise.all([api('/orgs'), api('/waste-types?all=1'), api('/methods')]);
  const t = todayIso();
  const d0 = new Date(t.slice(0, 7) + '-01'); d0.setMonth(d0.getMonth() - 3);
  const q = { from: r.q.from || d0.toISOString().slice(0, 10), to: r.q.to || t, org: r.q.org || '', type: r.q.type || '', method: r.q.method || '' };
  // фильтр по наименованию: одинаковые виды разных организаций (напр. «Картонная тара») объединяются
  const typeNames = [...new Set(types.filter((x) => !q.org || x.org_id === +q.org || !x.org_id).map((x) => x.name))].sort((a, b) => a.localeCompare(b, 'ru'));
  main.innerHTML = `
    <div class="page-head"><div><h1>${T('Реестр')} принятых данных</h1><div class="muted small">Единый реестр = записи отчётов со статусом «принято»</div></div>
      <div class="row no-print"><a class="btn" id="dlx">${icon('file')} Excel по фильтру</a><a class="btn btn-light" id="dlc">CSV для BI</a></div></div>
    <div class="card no-print">
      <div class="period-chips">${PERIOD_CHIPS.map(([k, l]) => `<button type="button" class="pchip ${chipRange(k).from === q.from && chipRange(k).to === q.to ? 'on' : ''}" data-pc="${k}">${l}</button>`).join('')}</div>
      <div class="row">
      <div class="field"><label>С</label><input type="date" id="from" value="${esc(q.from)}"></div>
      <div class="field"><label>По</label><input type="date" id="to" value="${esc(q.to)}"></div>
      <div class="field"><label>${esc(S.cfg.orgLabel)}</label><select id="org"><option value="">все</option>${orgs.map((o) => `<option value="${o.id}" ${+q.org === o.id ? 'selected' : ''}>${esc(o.short)}</option>`).join('')}</select></div>
      <div class="field"><label>Вид отхода</label><select id="type"><option value="">все</option>${typeNames.map((n) => `<option value="${esc(n)}" ${q.type === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div class="field"><label>Способ утилизации</label><select id="method"><option value="">все</option>${methods.map((m) => `<option value="${m.id}" ${+q.method === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    </div></div>
    <div id="res"><div class="card muted">Загрузка…</div></div>`;
  const upd = () => go('/registry?' + new URLSearchParams(Object.fromEntries(['from', 'to', 'org', 'type', 'method'].map((k) => [k, $('#' + k).value]).filter(([, v]) => v))));
  ['from', 'to', 'org', 'type', 'method'].forEach((k) => $('#' + k).onchange = upd);
  $$('[data-pc]').forEach((b) => b.onclick = () => { const rg = chipRange(b.dataset.pc); $('#from').value = rg.from; $('#to').value = rg.to; upd(); });
  const qsx = new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)));
  $('#dlx').href = '/api/registry.xlsx?' + qsx; $('#dlc').href = '/api/registry.csv?' + qsx;
  const data = await api('/registry?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))));
  $('#res').innerHTML = `
    <div class="grid g3"><div class="kpi"><div class="label">Записей</div><div class="value">${fmt(data.total, 0)}</div></div>
      <div class="kpi"><div class="label">Масса</div><div class="value">${kgT(data.kg)}</div></div>
      <div class="kpi"><div class="label">CO₂-экв.</div><div class="value">${kgT(data.co2)}</div></div></div>
    <div class="card" style="margin-top:14px"><div class="table-wrap" style="max-height:600px"><table>
      <thead><tr><th>Дата</th><th>${esc(S.cfg.orgLabel)}</th><th>Наименование отходов</th><th class="num">Вес / объём</th><th>Способ утилизации</th><th>Ответственный</th><th>Отчёт</th></tr></thead>
      <tbody>${data.rows.map((x) => `<tr><td class="nowrap">${dmy(x.date)}</td><td>${esc(x.org_short)}</td><td>${esc(x.type_name)}</td><td class="num">${fmt(x.qty, 2)} ${x.unit}</td><td>${esc(x.method_name)}</td><td class="small">${esc(x.user_name)}</td><td class="small nowrap">${monthName(x.period)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Нет данных по фильтру</td></tr>'}</tbody>
    </table></div>${data.total > data.rows.length ? `<p class="small muted">Показаны первые ${data.rows.length} из ${data.total}. Уточните фильтр или выгрузите сводный отчёт.</p>` : ''}</div>`;
}

// ---------- СВОДНЫЙ ОТЧЁТ ----------
function periodOptions(kind) {
  const t = todayIso(); const y = +t.slice(0, 4); const out = [];
  if (kind === 'month') for (let i = 0; i < 12; i++) { const d = new Date(y, +t.slice(5, 7) - 1 - i, 1); const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; out.push([v, monthName(v)]); }
  if (kind === 'quarter') for (let yy = y; yy >= y - 1; yy--) for (let q = 4; q >= 1; q--) { if (yy === y && q > Math.ceil(+t.slice(5, 7) / 3)) continue; out.push([`${yy}-Q${q}`, `${q} квартал ${yy}`]); }
  if (kind === 'year') for (let yy = y; yy >= y - 2; yy--) out.push([String(yy), `${yy} год`]);
  return out;
}
async function pageSummary(main, r) {
  const kind = r.q.kind || 'quarter';
  const opts = periodOptions(kind);
  let value = r.q.value || (kind === 'quarter' ? opts.find(([v]) => true)?.[0] : opts[0][0]);
  if (kind === 'quarter' && !r.q.value) { const t = todayIso(); const cq = Math.ceil(+t.slice(5, 7) / 3); value = cq === 1 ? `${+t.slice(0, 4) - 1}-Q4` : `${t.slice(0, 4)}-Q${cq - 1}`; }
  const s = await api(`/summary?kind=${kind}&value=${value}`);
  main.innerHTML = `
    <div class="page-head"><div><h1>${T('Сводный отчёт')}</h1><div class="muted small">По организациям и видам отходов · только принятые данные</div></div>
      <div class="row no-print"><a class="btn" href="/api/summary.xlsx?kind=${kind}&value=${encodeURIComponent(value)}">⇩ Скачать Excel</a><button class="btn-light" onclick="print()">Печать / PDF</button></div></div>
    <div class="card no-print"><div class="tabs">${[['month', 'Месяц'], ['quarter', 'Квартал'], ['year', 'Год']].map(([k, l]) => `<button data-k="${k}" class="${k === kind ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="field" style="max-width:280px;margin:0"><select id="val">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="card"><h2>Сводный отчёт по пищевым отходам университетского комплекса АО «АТУ» — ${esc(s.label)}</h2>
      <div class="muted small">Период ${dmy(s.from)} — ${dmy(s.to)}</div>
      <div class="grid g4" style="margin:14px 0">
        <div class="kpi"><div class="label">Общая масса</div><div class="value">${kgT(s.totalKg)}</div></div>
        <div class="kpi"><div class="label">CO₂-экв.</div><div class="value">${kgT(s.totalCo2)}</div></div>
        <div class="kpi"><div class="label">Пригодно к переработке</div><div class="value">${fmt(s.recyclableShare)}%</div></div>
        <div class="kpi"><div class="label">Фактически переработано</div><div class="value">${fmt(s.recycledShare)}%</div></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Организация / наименование отходов</th><th>Ед.</th>${s.months.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Итого</th><th class="num">кг</th><th class="num">CO₂, кг</th></tr></thead>
        <tbody>${s.orgs.map((o) => `<tr class="sub"><td colspan="${3 + s.months.length}">${esc(o.name)} <span class="small" style="font-weight:400">— отчёты: ${o.statuses.map((x, i) => chip(x === 'нет' ? 'none' : x, `${s.months[i]}: ${STATUS_RU[x] || 'нет'}`)).join(' ')}</span></td><td class="num">${fmt(o.kg)}</td><td class="num">${fmt(o.co2)}</td></tr>` +
          (o.types.map((t) => `<tr><td style="padding-left:22px">${esc(t.name)}${t.recyclable === 2 ? ' ♻' : ''}</td><td>${t.unit}</td>${t.byMonth.map((v) => `<td class="num">${v ? fmt(v) : ''}</td>`).join('')}<td class="num">${fmt(t.qty)}</td><td class="num">${fmt(t.kg)}</td><td class="num">${fmt(t.co2)}</td></tr>`).join('')
          || `<tr><td colspan="${6 + s.months.length}" class="muted" style="padding-left:22px">нет принятых данных за период</td></tr>`)).join('')}
        <tr class="total"><td colspan="${3 + s.months.length}">ВСЕГО</td><td class="num">${fmt(s.totalKg)}</td><td class="num">${fmt(s.totalCo2)}</td></tr></tbody></table></div></div>
    <div class="card conclusion"><h2>${icon('spark')} Заключение к отчёту</h2><div id="concl"></div></div>
    <div class="card"><h2>${T('Автовыводы')} по отчёту</h2>${insightsHtml(s.insights)}</div>`;
  loadConclusion($('#concl'), `kind=${kind}&value=${encodeURIComponent(value)}`);
  $$('[data-k]').forEach((b) => b.onclick = () => go(`/summary?kind=${b.dataset.k}`));
  $('#val').onchange = (e) => go(`/summary?kind=${kind}&value=${e.target.value}`);
}

function insightsHtml(list) {
  const tag = { warn: 'внимание', good: 'хорошо', tip: 'рекомендация', info: 'факт' };
  return `<div class="insights">${list.map((i) => `<div class="ins ins-${i.level}"><span class="tag">${tag[i.level]}</span><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div>`).join('')}</div>`;
}

// ---------- DASHBOARD ----------
async function pageDashboard(main, r) {
  const staff = S.user.role !== 'resp';
  const orgs = staff ? await api('/orgs') : [];
  const range = r.q.range || '6';
  const t = todayIso();
  const from = (() => { const d = new Date(t.slice(0, 7) + '-01T00:00:00'); d.setMonth(d.getMonth() - (+range - 1)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; })();
  const qs = new URLSearchParams({ from, to: t, ...(r.q.org ? { org: r.q.org } : {}) });
  const d = await api('/dashboard?' + qs);
  const k = d.kpi; const mom = d.compare.mom; const qoq = d.compare.qoq;
  const arrow = (c) => c == null ? '' : `<span class="${c > 0 ? 'up' : 'down'}">${c > 0 ? '▲' : '▼'} ${fmt(Math.abs(c))}%</span>`;
  main.innerHTML = `
    <section class="hero">
    <div class="page-head" style="margin:0"><div><div class="eyebrow">${esc(S.cfg.company || S.cfg.systemName)}</div><h1>${T('Аналитика')}${staff ? '' : ' · ' + esc(S.user.org_short)}</h1><div class="muted small">По принятым отчётам · ${dmy(d.from)} — ${dmy(d.to)}</div></div>
      <div class="row no-print">
        ${staff ? `<div class="field"><select id="org"><option value="">${esc(S.cfg.orgsLabel)}: все</option>${orgs.map((o) => `<option value="${o.id}" ${+r.q.org === o.id ? 'selected' : ''}>${esc(o.short)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><select id="range">${[['3', '3 месяца'], ['6', '6 месяцев'], ['12', '12 месяцев']].map(([v, l]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div></div>
    <div class="hero-kpis">
      <div class="hero-kpi"><div class="label">Масса отходов</div><div class="value">${kgT(k.totalKg)}</div><div class="sub">${fmt(k.entries, 0)} взвешиваний</div></div>
      <div class="hero-kpi"><div class="label">CO₂-эквивалент</div><div class="value">${kgT(k.co2)}</div><div class="sub">DEFRA 2024</div></div>
      <div class="hero-kpi lime"><div class="label">Можно снизить CO₂</div><div class="value">−${kgT(k.co2Potential)}</div><div class="sub">${k.co2 ? Math.round(k.co2Potential / k.co2 * 100) : 0}% — рекомендуемые способы</div></div>
      <div class="hero-kpi"><div class="label">Мимо полигона</div><div class="value">${fmt(k.recycledShare)}%</div><div class="sub">пригодно: ${fmt(k.recyclableShare)}%</div></div>
      <div class="hero-kpi"><div class="label">Месяц к месяцу</div><div class="value">${mom ? arrow(mom.changePct) : '—'}</div><div class="sub">${mom ? `${mom.cur} к ${mom.prev}, кг/день` : 'мало данных'}${qoq ? ` · кв.: ${qoq.changePct > 0 ? '+' : ''}${fmt(qoq.changePct)}%` : ''}</div></div>
    </div></section>
    <div class="card conclusion"><h2>${icon('spark')} Заключение для руководства</h2><div id="concl"></div></div>
    <div class="card"><h2>${T('Автовыводы')} и рекомендации</h2><p class="small muted" style="margin-top:-6px">Система анализирует принятые данные и формулирует выводы автоматически: динамика, отклонения (&gt;30% к среднему), потенциал переработки, потери, цель ЦУР 12.3.</p>${insightsHtml(d.insights)}</div>
    <div class="grid g2">
      <div class="card"><h3>Динамика массы по месяцам, кг</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3>Структура по видам отходов</h3><div class="chart-box"><canvas id="c2"></canvas></div></div>
      ${staff && !r.q.org ? `<div class="card"><h3>Сравнение организаций, кг</h3><div class="chart-box"><canvas id="c3"></canvas></div></div>` : `<div class="card"><h3>Способы утилизации, кг</h3><div class="chart-box"><canvas id="c3"></canvas></div></div>`}
      <div class="card"><h3>Доля переработки по месяцам, %</h3><div class="chart-box"><canvas id="c4"></canvas></div></div>
    </div>
    <div class="card"><h3>Выявленные отклонения</h3>${d.anomalies.length ? `<div class="table-wrap"><table><thead><tr><th>Месяц</th><th>${esc(S.cfg.orgLabel)}</th><th>Вид отхода</th><th class="num">Факт, кг/день</th><th class="num">Среднее 3 мес.</th><th class="num">Рост</th><th class="num">Сверх нормы</th></tr></thead>
      <tbody>${d.anomalies.map((a) => `<tr><td>${a.monthLabel}</td><td>${esc(a.org)}</td><td>${esc(a.type)}</td><td class="num">${fmt(a.curPerDay)}</td><td class="num">${fmt(a.avgPerDay)}</td><td class="num up">+${a.changePct}%</td><td class="num">${fmt(a.extraKg, 0)} кг</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Отклонений не выявлено.</p>'}</div>`;
  loadConclusion($('#concl'), new URLSearchParams({ from: d.from, to: d.to, ...(r.q.org ? { org: r.q.org } : {}) }));
  $('#range').onchange = (e) => go('/dashboard?' + new URLSearchParams({ range: e.target.value, ...(r.q.org ? { org: r.q.org } : {}) }));
  if ($('#org')) $('#org').onchange = (e) => go('/dashboard?' + new URLSearchParams({ range, ...(e.target.value ? { org: e.target.value } : {}) }));

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.color = '#66756b';
  const labels = d.monthly.map((m) => m.label);
  S.charts.push(new Chart($('#c1'), { type: 'bar', data: { labels, datasets: d.orgs.map((o, i) => ({ label: o, data: d.monthly.map((m) => m.byOrg[o]), backgroundColor: ORG_COLORS[i % 7], borderRadius: 3 })) },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } } }));
  const top = d.byType.slice(0, 9); const rest = d.byType.slice(9).reduce((a, x) => a + x.kg, 0);
  const pie = rest ? [...top, { name: 'Прочее', kg: rest }] : top;
  S.charts.push(new Chart($('#c2'), { type: 'doughnut', data: { labels: pie.map((x) => x.name), datasets: [{ data: pie.map((x) => x.kg), backgroundColor: PIE_COLORS, borderWidth: 1 }] },
    options: { maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: innerWidth < 720 ? 'bottom' : 'right', labels: { boxWidth: 12, font: { size: 11 } } } } } }));
  const c3 = staff && !r.q.org ? d.byOrg : d.byMethod;
  S.charts.push(new Chart($('#c3'), { type: 'bar', data: { labels: c3.map((x) => x.name), datasets: [{ label: 'кг', data: c3.map((x) => x.kg), backgroundColor: c3.map((_, i) => ORG_COLORS[i % 7]), borderRadius: 4 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#eef1ee' } }, y: { grid: { display: false } } } } }));
  S.charts.push(new Chart($('#c4'), { type: 'line', data: { labels, datasets: [
    { label: 'Пригодно к переработке', data: d.monthly.map((m) => m.kg ? m.recyclableShare : null), borderColor: '#2e8b5e', backgroundColor: 'rgba(46,139,94,.12)', fill: true, tension: .3 },
    { label: 'Фактически переработано', data: d.monthly.map((m) => m.kg ? m.recycledShare : null), borderColor: '#d08c00', tension: .3 }] },
    options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } } }));
}

// ---------- КОНТРОЛЬ СДАЧИ ----------
async function pageControl(main, r) {
  const t = todayIso(); const cur = t.slice(0, 7);
  const period = r.q.period || cur;
  const [miss, orgs, reports] = await Promise.all([api('/missing?period=' + period), api('/orgs'), api('/reports')]);
  const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(+cur.slice(0, 4), +cur.slice(5, 7) - 1 - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const st = (o, m) => reports.find((x) => x.org_id === o && x.period === m);
  main.innerHTML = `
    <div class="page-head"><div><h1>${T('Контроль сдачи')}</h1><div class="muted small">Организации без принятого отчёта за период</div></div>
      <div class="field no-print"><input type="month" id="per" value="${esc(period)}"></div></div>
    <div class="card"><h2>${esc(miss.label)}: не сдали — ${miss.orgs.length} из ${orgs.filter((o) => o.active).length}</h2>
      ${miss.orgs.length ? `<div class="table-wrap"><table><thead><tr><th>${esc(S.cfg.orgLabel)}</th><th>Состояние отчёта</th><th>Ответственные</th></tr></thead>
      <tbody>${miss.orgs.map((o) => `<tr><td>${esc(o.name)}</td><td>${chip(o.status === 'нет отчёта' ? 'none' : o.status, o.status_ru)}</td><td class="small">${esc(orgs.find((x) => x.id === o.id)?.responsibles || '')}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="alert alert-green">Все организации сдали отчёт за период.</div>'}</div>
    <div class="card"><h3>Статусы отчётов за 6 месяцев</h3><div class="table-wrap"><table class="matrix"><thead><tr><th>${esc(S.cfg.orgLabel)}</th>${months.map((m) => `<th>${monthName(m)}</th>`).join('')}</tr></thead>
      <tbody>${orgs.filter((o) => o.active).map((o) => `<tr><td>${esc(o.short)}</td>${months.map((m) => { const x = st(o.id, m); return `<td>${x ? `<a href="#/report/${x.id}">${chip(x.status)}</a>` : chip('none')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  $('#per').onchange = (e) => go('/control?period=' + e.target.value);
}

// ---------- АДМИНИСТРИРОВАНИЕ ----------
async function pageAdmin(main, r) {
  const tab = r.q.tab || 'settings';
  main.innerHTML = `<div class="page-head"><h1>${T('Администрирование')}</h1></div>
    <div class="tabs">${[['settings', 'Настройки и справочники'], ['orgs', S.cfg.orgsLabel], ['users', 'Пользователи'], ['types', 'Виды отходов'], ['methods', 'Способы утилизации'], ['scales', 'Весы (API)']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tab"></div>`;
  $$('[data-tab]').forEach((b) => b.onclick = () => go('/admin?tab=' + b.dataset.tab));
  const el = $('#tab');
  const orgs = await api('/orgs');
  const methods = await api('/methods');
  const ORG_TYPES = { university: ['кафедра', 'столовая', 'кофейня', 'гостиница', 'лаборатория', 'буфет'], food: ['цех', 'склад сырья', 'лаборатория', 'столовая'],
    horeca: ['ресторан', 'кафе', 'столовая', 'кейтеринг', 'кофейня'], retail: ['магазин', 'распределительный центр', 'склад'] }[S.cfg.industry] || ['подразделение'];

  if (tab === 'orgs') {
    el.innerHTML = `<div class="card"><h3>Подключить: ${esc(S.cfg.orgLabel.toLowerCase())}</h3><form id="f" class="row">
        <div class="field"><label>Полное название</label><input name="name" required></div><div class="field"><label>Краткое</label><input name="short" required></div>
        <div class="field"><label>Тип</label><select name="type">${ORG_TYPES.map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="field"><label>Корпус / адрес</label><input name="building"></div><button>Добавить</button></form>
        <p class="small muted">Новое подразделение сразу получает форму и QR-код; виды отходов добавляются ответственным лицом прямо в форме, шаблоном отрасли или из Excel.</p></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>${esc(S.cfg.orgLabel)}</th><th>Тип</th><th>Корпус</th><th>Ответственные</th><th>Активна</th><th></th></tr></thead>
      <tbody>${orgs.map((o) => `<tr><td><b>${esc(o.short)}</b><div class="small muted">${esc(o.name)}</div></td><td>${esc(o.type)}</td><td>${esc(o.building)}</td><td class="small">${esc(o.responsibles || '—')}</td>
        <td><input type="checkbox" data-act="${o.id}" ${o.active ? 'checked' : ''} style="width:auto"></td><td><button class="btn-sm btn-sec" data-qr="${o.id}">QR-код формы</button></td></tr>`).join('')}</tbody></table></div></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); try { await api('/orgs', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Организация добавлена'); route(); } catch (err) { toast(err.message, true); } };
    $$('[data-act]').forEach((c) => c.onchange = async () => { await api('/orgs/' + c.dataset.act, { method: 'PUT', body: { active: c.checked } }); toast('Сохранено'); });
    $$('[data-qr]').forEach((b) => b.onclick = async () => {
      const q = await api(`/orgs/${b.dataset.qr}/qr`); const o = orgs.find((x) => x.id === +b.dataset.qr);
      modal(`<div style="text-align:center"><h2>${esc(o.short)}</h2><p class="small muted">Наклейте на месте взвешивания — QR открывает форму организации на смартфоне</p>
        <img src="${q.dataUrl}" style="width:100%;max-width:300px"><p class="small"><a href="${esc(q.url)}" target="_blank">${esc(q.url)}</a></p>
        <div class="row" style="justify-content:center"><button onclick="print()">Печать</button><button class="btn-light" data-close>Закрыть</button></div></div>`);
    });
  }
  if (tab === 'users') {
    const users = await api('/users');
    el.innerHTML = `<div class="card"><h3>Новый пользователь</h3><form id="f" class="row">
        <div class="field"><label>Имя пользователя</label><input name="full_name" required placeholder="напр. iskander"></div><div class="field"><label>E-mail</label><input name="email" type="email" required></div>
        <div class="field"><label>Пароль</label><input name="password" required minlength="6"></div>
        <div class="field"><label>Роль</label><select name="role">${Object.entries(ROLE_RU).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(S.cfg.orgLabel)} (для ответственного)</label><select name="org_id"><option value="">—</option>${orgs.map((o) => `<option value="${o.id}">${esc(o.short)}</option>`).join('')}</select></div>
        <button>Создать</button></form></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Имя пользователя</th><th>E-mail</th><th>Роль</th><th>${esc(S.cfg.orgLabel)}</th><th>Активен</th></tr></thead>
      <tbody>${users.map((u) => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td>
        <td><select data-role="${u.id}">${Object.entries(ROLE_RU).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><select data-org="${u.id}"><option value="">—</option>${orgs.map((o) => `<option value="${o.id}" ${u.org_id === o.id ? 'selected' : ''}>${esc(o.short)}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-uact="${u.id}" ${u.active ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Пароли хранятся только в виде хэша scrypt с солью.</p></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); try { await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Пользователь создан'); route(); } catch (err) { toast(err.message, true); } };
    const save = async (id) => { try { await api('/users/' + id, { method: 'PUT', body: { role: $(`[data-role="${id}"]`).value, org_id: $(`[data-org="${id}"]`).value, active: $(`[data-uact="${id}"]`).checked } }); toast('Сохранено'); } catch (e) { toast(e.message, true); } };
    $$('[data-role],[data-org],[data-uact]').forEach((x) => x.onchange = () => save(x.dataset.role || x.dataset.org || x.dataset.uact));
  }
  if (tab === 'types') {
    const types = await api('/waste-types?all=1');
    const REC = ['нет', 'частично', 'да'];
    const mOpts = (sel, empty) => (empty ? `<option value="">—</option>` : '') + methods.map((m) => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    el.innerHTML = `<div class="card"><h3>Добавить вид отхода</h3><form id="f" class="row">
        <div class="field"><label>Наименование</label><input name="name" required></div>
        <div class="field"><label>${esc(S.cfg.orgLabel)}</label><select name="org_id"><option value="">общий для всех</option>${orgs.map((o) => `<option value="${o.id}">${esc(o.short)}</option>`).join('')}</select></div>
        <div class="field"><label>Категория</label><select name="category">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
        <div class="field"><label>Ед.</label><select name="unit"><option>кг</option><option>л</option></select></div>
        <div class="field"><label>Пригоден к переработке</label><select name="recyclable"><option value="2">да</option><option value="1">частично</option><option value="0">нет</option></select></div>
        <div class="field"><label>Рекомендуемый способ</label><select name="recommended_method_id">${mOpts(null, true)}</select></div><button>Добавить</button></form></div>
      <div class="card"><div class="table-wrap" style="max-height:620px"><table><thead><tr><th>Наименование</th><th>${esc(S.cfg.orgLabel)}</th><th>Ед.</th><th>Сейчас (по умолч.)</th><th>Рекомендуемый</th><th class="num">CO₂ ТБО, кг/т</th><th>Переработка</th><th class="num">Предел</th><th>Акт.</th><th class="num">Записей</th></tr></thead>
      <tbody>${types.map((t) => `<tr data-w="${t.id}"><td>${catIcon(t.category)} ${esc(t.name)}${t.note ? `<div class="small muted">${esc(t.note)}</div>` : ''}</td><td class="small">${esc(t.org_short || 'общий')}</td><td>${t.unit}</td>
        <td><select data-f="default_method_id">${mOpts(t.default_method_id)}</select></td><td><select data-f="recommended_method_id">${mOpts(t.recommended_method_id, true)}</select></td>
        <td><input data-f="co2_factor" data-k="1000" value="${Math.round(t.co2_factor * 100000) / 100}" style="width:90px"></td>
        <td><select data-f="recyclable">${REC.map((v, i) => `<option value="${i}" ${t.recyclable === i ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><input data-f="max_per_entry" value="${t.max_per_entry}" style="width:70px"></td>
        <td><input type="checkbox" data-f="active" ${t.active ? 'checked' : ''} style="width:auto"></td><td class="num">${t.used}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Виды отходов с записями не удаляются — только деактивируются. Коэффициенты: DEFRA / BEIS 2024, раздел Waste disposal (справочник организаторов). Справочник можно загрузить целиком из Excel во вкладке «Настройки и справочники».</p></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); try { await api('/waste-types', { method: 'POST', body: b }); toast('Добавлено'); route(); } catch (err) { toast(err.message, true); } };
    $$('tr[data-w]').forEach((tr) => $$('[data-f]', tr).forEach((x) => x.onchange = async () => {
      const body = {}; $$('[data-f]', tr).forEach((y) => { body[y.dataset.f] = y.type === 'checkbox' ? y.checked : y.dataset.k ? Number(String(y.value).replace(',', '.')) / 1000 : y.value; });
      try { await api('/waste-types/' + tr.dataset.w, { method: 'PUT', body }); toast('Сохранено'); } catch (e) { toast(e.message, true); }
    }));
  }
  if (tab === 'settings') {
    const cfg = await api('/config');
    el.innerHTML = `<div class="grid g2">
      <div class="card"><h3>Система</h3><form id="cf">
        <div class="field"><label>Название системы</label><input name="systemName" value="${esc(cfg.systemName)}"></div>
        <div class="field"><label>Организация-владелец</label><input name="company" value="${esc(cfg.company)}"></div>
        <div class="row"><div class="field"><label>Как называть подразделение</label><input name="orgLabel" value="${esc(cfg.orgLabel)}"></div>
          <div class="field"><label>Во множественном числе</label><input name="orgsLabel" value="${esc(cfg.orgsLabel)}"></div></div>
        <button style="margin-top:12px">Сохранить</button></form></div>
      <div class="card"><h3>Справочник из Excel</h3>
        <p class="small">Формат — как «Справочники для Трека 1»: листы «Виды отходов» и «Способы утилизации». Виды привязываются к подразделениям по столбцу «Организации». Существующие записи обновляются, ничего не удаляется.</p>
        <div class="field"><label>Привязать все виды к</label><select id="refOrg"><option value="">по столбцу «Организации»</option>${orgs.map((o) => `<option value="${o.id}">${esc(o.short)}</option>`).join('')}</select></div>
        <label class="btn btn-sec" style="color:var(--green);display:inline-flex">${icon('file')} Загрузить .xlsx<input type="file" id="refFile" accept=".xlsx" hidden></label>
        <div id="refRes" class="small" style="margin-top:10px"></div></div>
    </div>
    <div class="card"><h3>Отраслевой шаблон</h3>
      <p class="small muted">Система не привязана к университету: выберите отрасль — поменяются термины, а шаблон добавит типовые виды отходов с рекомендуемыми способами и коэффициентами CO₂.</p>
      <div class="ind-grid">${cfg.industries.map((i) => `<button type="button" class="ind ${i.key === cfg.industry ? 'on' : ''}" data-ind="${i.key}"><b>${esc(i.label)}</b><span>${esc(i.example)} · «${esc(i.orgLabel)}»</span></button>`).join('')}</div>
      <div class="row" style="margin-top:12px"><div class="field"><label>Добавить виды отходов шаблона в</label><select id="indOrg"><option value="">общий справочник (для всех)</option>${orgs.map((o) => `<option value="${o.id}">${esc(o.short)}</option>`).join('')}</select></div>
        <button id="indApply" class="btn-lime">Применить шаблон</button></div></div>`;
    let ind = cfg.industry;
    $('#cf').onsubmit = async (e) => { e.preventDefault(); try { S.cfg = await api('/config', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Сохранено'); route(); } catch (err) { toast(err.message, true); } };
    $$('[data-ind]').forEach((b) => b.onclick = () => { ind = b.dataset.ind; $$('[data-ind]').forEach((x) => x.classList.toggle('on', x === b)); });
    $('#indApply').onclick = async () => {
      try {
        S.cfg = await api('/config', { method: 'PUT', body: { industry: ind, resetLabels: true } });
        let msg = `Отрасль: ${S.cfg.industryLabel}.`;
        if (ind !== 'university') { const r = await api('/reference/industry', { method: 'POST', body: { industry: ind, org_id: $('#indOrg').value } }); msg += ` Добавлено видов отходов: ${r.typesAdded}, обновлено: ${r.typesUpdated}.`; }
        toast(msg); route();
      } catch (e) { toast(e.message, true); }
    };
    $('#refFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const file = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); });
      $('#refRes').textContent = 'Загружаю…';
      try { const r = await api('/reference/import', { method: 'POST', body: { file, org_id: $('#refOrg').value } });
        $('#refRes').innerHTML = `<div class="alert alert-green" style="margin:0">В файле: видов ${r.typesInFile}, способов ${r.methodsInFile}. Добавлено видов ${r.typesAdded}, обновлено ${r.typesUpdated}; способов добавлено ${r.methodsAdded}, обновлено ${r.methodsUpdated}.</div>`; }
      catch (err) { $('#refRes').innerHTML = `<div class="alert alert-red" style="margin:0">${esc(err.message)}</div>`; }
    };
  }
  if (tab === 'scales') {
    const devs = await api('/scale/devices');
    el.innerHTML = `<div class="card"><h3>Электронные весы — подключение по API</h3>
      <p class="small">Весы (или шлюз трека 2) отправляют взвешивание сразу в черновик отчёта подразделения. Токен устройства хранится в системе только в виде хэша.</p>
      <pre class="code">curl -X POST ${esc(location.origin)}/api/scale/entries \\
  -H "Content-Type: application/json" -H "X-Device-Token: demo-scale-5" \\
  -d '{"waste_type":"Очистки овощей","weight_kg":12.4}'</pre>
      <form id="f" class="row"><div class="field"><label>${esc(S.cfg.orgLabel)}</label><select name="org_id">${orgs.map((o) => `<option value="${o.id}">${esc(o.short)}</option>`).join('')}</select></div>
        <div class="field"><label>Название</label><input name="name" placeholder="Весы платформенные, кухня"></div><button>Выдать токен</button></form></div>
      <div class="card"><table><thead><tr><th>Устройство</th><th>${esc(S.cfg.orgLabel)}</th><th>Токен</th></tr></thead><tbody>${devs.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.org_short)}</td><td><code>${esc(d.token_hint)}</code></td></tr>`).join('')}</tbody></table></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/scale/devices', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); modal(`<h2>Токен устройства</h2><p class="small">Сохраните — повторно он не показывается.</p><pre class="code" style="white-space:pre-wrap;word-break:break-all">${esc(r.token)}</pre><button data-close>Готово</button>`, () => {}); } catch (err) { toast(err.message, true); } };
  }
  if (tab === 'methods') {
    el.innerHTML = `<div class="card"><h3>Добавить способ утилизации</h3><form id="f" class="row">
      <div class="field"><label>Код</label><input name="code" placeholder="COMPOST"></div><div class="field" style="flex:2 1 240px"><label>Название</label><input name="name" required></div>
      <div class="field"><label>CO₂, кг/т</label><input name="co2" inputmode="decimal" placeholder="8,88"></div>
      <div class="field"><label>Иерархия (1 — лучше)</label><select name="rank">${[1, 2, 3, 4, 5].map((i) => `<option ${i === 4 ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
      <div class="field"><label>Полигон?</label><select name="landfill"><option value="">нет — отход не идёт на полигон</option><option value="1">да — захоронение (ТБО)</option></select></div><button>Добавить</button></form></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Иерархия</th><th>Код</th><th>Способ</th><th class="num">CO₂, кг/т</th><th>Куда</th><th>Акт.</th></tr></thead><tbody>${methods.map((m) => `<tr><td><span class="chip ${m.rank <= 2 ? 'st-accepted' : m.rank >= 5 ? 'st-returned' : 'st-in_review'}">${m.rank}</span></td><td><code>${esc(m.code || '')}</code></td>
      <td>${esc(m.name)}${m.note ? `<div class="small muted">${esc(m.note)}</div>` : ''}</td><td class="num">${m.co2_factor == null ? (m.is_recycling ? 'нет коэф.' : 'по виду') : fmt(m.co2_factor * 1000, 2)}</td><td>${m.is_recycling ? 'мимо полигона' : 'полигон'}</td>
      <td><input type="checkbox" data-m="${m.id}" ${m.active ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Иерархия обращения с отходами: предотвращение и передача → корм → переработка → компост/биогаз → захоронение. Экономия CO₂ = масса (т) × (коэф. ТБО − коэф. способа).</p></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
      const body = { code: b.code, name: b.name, rank: b.rank, is_recycling: !b.landfill, co2_factor: b.co2 ? Number(b.co2.replace(',', '.')) / 1000 : '' };
      try { await api('/methods', { method: 'POST', body }); toast('Добавлено'); route(); } catch (err) { toast(err.message, true); } };
    $$('[data-m]').forEach((c) => c.onchange = async () => { await api('/methods/' + c.dataset.m, { method: 'PUT', body: { active: c.checked } }); toast('Сохранено'); });
  }
}

route();
