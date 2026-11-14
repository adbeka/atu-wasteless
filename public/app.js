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
const ORG_COLORS = ['#3459a0', '#e0b100', '#1d5fa8', '#9b3d8f', '#c2410c', '#0f766e', '#6b7280'];
const PIE_COLORS = ['#3459a0', '#3459a0', '#7fa0e0', '#b9cbee', '#e0b100', '#f2d64b', '#1d5fa8', '#7aa7dd', '#9b3d8f', '#c2410c', '#9ca3af'];

// ---------- i18n (рус / қаз) ----------
const I18N = {
  kz: {
    'Сколько готовить': 'Қанша дайындау керек',
    'Прогноз спроса по блюдам: тот же день недели за': 'Тағамдар бойынша сұраныс болжамы: соңғы',
    'нед.': 'апта',
    'запас': 'қор',
    'В этот день недели обычно не готовят': 'Аптаның бұл күні әдетте дайындамайды',
    'Пока недостаточно истории': 'Тарих әлі жеткіліксіз',
    'Вносите внизу «Итог дня»: сколько приготовили и сколько осталось. Через 2 недели система начнёт подсказывать, сколько готовить, чтобы не выбрасывать.': 'Төменде «Күн қорытындысын» енгізіңіз: қанша дайындалды, қанша қалды. 2 аптадан кейін жүйе тастамау үшін қанша дайындау керектігін ұсынады.',
    'План на': 'Жоспар:',
    'Можно готовить на': 'Мына мөлшерге аз дайындауға болады:',
    'кг меньше — и никто не останется голодным': 'кг — және ешкім аш қалмайды',
    'Объёмы уже близки к спросу 👍': 'Көлем сұранысқа жақын 👍',
    'Рекомендуем приготовить': 'Дайындауға ұсынамыз',
    'обычно': 'әдетте',
    'Меньше отходов': 'Қалдық азаяды',
    'за день': 'күніне',
    'Экономия': 'Үнемдеу',
    'по ценам справочника': 'анықтамалық бағасымен',
    'не уйдёт на полигон': 'полигонға бармайды',
    'Блюдо': 'Тағам',
    'Обычно готовят': 'Әдетте дайындайды',
    'Остаётся': 'Қалады',
    'Рекомендуем': 'Ұсынамыз',
    'Точность': 'Дәлдік',
    'Спрос = приготовлено − осталось. Свежие недели весят больше. Если блюдо закончилось раньше времени — укажите остаток 0, прогноз это учтёт.': 'Сұраныс = дайындалды − қалды. Соңғы апталардың салмағы көбірек. Тағам ерте бітсе — қалдықты 0 деп көрсетіңіз.',
    'За 30 дней': '30 күнде',
    'приготовлено': 'дайындалды',
    'осталось': 'қалды',
    'дн. с данными': 'деректері бар күн',
    'Итог дня: приготовлено / осталось': 'Күн қорытындысы: дайындалды / қалды',
    'Вносите в конце смены — по этим цифрам система считает спрос и советует, сколько готовить. Остаток — то, что не продали.': 'Ауысым соңында енгізіңіз — осы сандар бойынша жүйе сұранысты есептеп, қанша дайындауды ұсынады. Қалдық — сатылмаған өнім.',
    'Добавьте блюда, которые готовите': 'Дайындайтын тағамдарды қосыңыз',
    'Добавить блюдо': 'Тағам қосу',
    'Сохранить итог дня': 'Күн қорытындысын сақтау',
    'Сохранено блюд': 'Сақталған тағамдар',
    'Эко-калькулятор': 'Эко-калькулятор',
    'Своя кружка: сколько вы сэкономите': 'Өз кружкаңыз: қанша үнемдейсіз',
    'Приходите в кофейню со своей кружкой или термосом — получаете скидку, а одноразовый стакан не попадает на полигон.': 'Кофеханаға өз кружкаңызбен не термоспен келіңіз — жеңілдік аласыз, ал бір реттік стақан полигонға түспейді.',
    'Сколько кофе/чая в день': 'Күніне неше кофе/шай',
    'Дней в неделю': 'Аптасына неше күн',
    'дн.': 'күн',
    'Скидка за свою кружку, ₸': 'Өз кружкаңыз үшін жеңілдік, ₸',
    'Сколько человек (вы, группа, факультет)': 'Неше адам (сіз, топ, факультет)',
    'Допущения': 'Болжамдар',
    'стакан с крышкой': 'қақпағы бар стақан',
    'углеродный след': 'көміртек ізі',
    'на стакан по нижней оценке': 'бір стақанға ең төменгі баға бойынша',
    'по другим исследованиям — до': 'басқа зерттеулер бойынша —',
    'Учебный год ≈ 36 недель. Многоразовая кружка окупает свой собственный след примерно за 20–40 использований.': 'Оқу жылы ≈ 36 апта. Көп реттік кружка өз ізін шамамен 20–40 қолданыста ақтайды.',
    'Неделя': 'Апта',
    'Месяц': 'Ай',
    'Учебный год': 'Оқу жылы',
    'чашки в день': 'кесе күніне',
    'чел.': 'адам',
    'Стаканов': 'Стақан',
    'Мусора': 'Қоқыс',
    'Скидка': 'Жеңілдік',
    'За учебный год': 'Оқу жылында',
    'стаканов не окажутся на полигоне': 'стақан полигонға түспейді',
    'а вы сэкономите': 'ал сіз үнемдейсіз',
    'Даже если в свою кружку брать только одну чашку из': 'Өз кружкаңызға тек бір кесені алсаңыз да, барлығы',
    'стаканов и': 'стақан және',
    'за год': 'жылына',
    'Это как': 'Бұл автокөлікпен',
    'км на автомобиле': 'км жүрумен бірдей',
    'План': 'Жоспар',
    'Своя кружка': 'Өз кружкам',
    'Ввод': 'Енгізу',
    'Мои отчёты': 'Есептерім',
    'Аналитика': 'Талдау',
    'Отчёты': 'Есептер',
    'Реестр': 'Тізілім',
    'Сводный отчёт': 'Жиынтық есеп',
    'Контроль сдачи': 'Тапсыру бақылауы',
    'Администрирование': 'Әкімшілік',
    'Выйти': 'Шығу',
    'Моя сводка': 'Менің жиынтығым',
    'Рейтинг': 'Рейтинг',
    'Ответственное лицо': 'Жауапты тұлға',
    'черновик': 'жоба', 'отправлено': 'жіберілді', 'на проверке': 'тексерілуде', 'принято': 'қабылданды', 'возвращено': 'қайтарылды', 'нет отчёта': 'есеп жоқ',
    'Проверяющий': 'Тексеруші',
    'Администратор': 'Әкімші',
    'Руководство': 'Басшылық',
    'Вход в систему': 'Жүйеге кіру',
    'Войти': 'Кіру',
    'Пароль': 'Құпиясөз',
    'Регистрация': 'Тіркелу',
    'Сохранить': 'Сақтау',
    'Отмена': 'Болдырмау',
    'Закрыть': 'Жабу',
    'Удалить': 'Жою',
    'необязательно': 'міндетті емес',
    'Вид отхода': 'Қалдық түрі',
    'Вес / объём': 'Салмағы / көлемі',
    'Способ утилизации': 'Кәдеге жарату тәсілі',
    'Дата': 'Күні',
    'Сохранить запись': 'Жазбаны сақтау',
    'Отправить на проверку': 'Тексеруге жіберу',
    'Сегодня': 'Бүгін',
    'За месяц': 'Ай бойы',
    'Фото': 'Фото',
    'Новый вид': 'Жаңа түр',
    'Записи': 'Жазбалар',
    'Автовыводы': 'Автоқорытындылар',
    'Продукт': 'Өнім',
    'напр. хлеб, плов, картофель': 'мыс. нан, палау, картоп',
    'вид отхода выбран автоматически': 'қалдық түрі автоматты таңдалды',
    'выберите вид отхода': 'қалдық түрін таңдаңыз',
    'Нет в справочнике — выберите вид отхода вручную': 'Анықтамалықта жоқ — қалдық түрін қолмен таңдаңыз',
    'Быстрый ввод фразой': 'Сөйлеммен жылдам енгізу',
    'что взвесили…': 'не өлшедіңіз…',
    'Скажите или напишите, например: «отходы из зала 12 кило, масло 3 литра»': 'Айтыңыз немесе жазыңыз, мысалы: «нан 3 кг, картоп 12 кило»',
    'Распознать по фото: отходы или табло весов': 'Фото бойынша тану: қалдықтар немесе таразы таблосы',
    'сфотографируйте отходы или табло весов, ИИ определит продукт и вес': 'қалдықты немесе таразы таблосын суретке түсіріңіз, ЖИ өнім мен салмақты анықтайды',
    'Распознано': 'Танылды',
    'проверьте и сохраните': 'тексеріп, сақтаңыз',
    'по справочнику': 'анықтамалық бойынша',
    'по фото': 'фото бойынша',
    'вес оценён на глаз — уточните': 'салмақ шамамен бағаланды — нақтылаңыз',
    'с табло весов': 'таразы таблосынан',
    'Смотрю на фото…': 'Фотоны қарап жатырмын…',
    'Не удалось определить отходы на фото': 'Фотода қалдықтарды анықтау мүмкін болмады',
    'Сохранено записей': 'Сақталған жазбалар',
    'Весы': 'Таразы',
    'Отменить редактирование': 'Өңдеуді болдырмау',
    'Сохранить изменения': 'Өзгерістерді сақтау',
    'Срок сдачи: до 5': 'Тапсыру мерзімі: 5-ке дейін',
    'Отчёт за': 'Есеп:',
    'Нет сети': 'Желі жоқ',
    'в очереди': 'кезекте',
    'ввод работает': 'енгізу жұмыс істейді',
    'Отправка': 'Жіберілуде',
    'с ошибкой': 'қатемен',
    'Очередь отправки': 'Жіберу кезегі',
    'Очередь пуста': 'Кезек бос',
    'Отправить сейчас': 'Қазір жіберу',
    'Удалить запись из очереди?': 'Жазбаны кезектен жою керек пе?',
    'Записи, внесённые без сети. Уйдут на сервер автоматически, когда появится интернет.': 'Желісіз енгізілген жазбалар. Интернет пайда болғанда серверге автоматты жіберіледі.',
    'Отправлено из очереди': 'Кезектен жіберілді',
    'Ждут отправки': 'Жіберуді күтуде',
    'отправится, когда появится сеть': 'желі пайда болғанда жіберіледі',
    'Нет сети — в очереди': 'Желі жоқ — кезекте',
    'Нет сети — запись сохранена на телефоне и отправится сама': 'Желі жоқ — жазба телефонда сақталды, өзі жіберіледі',
    'Нет сети. Можно вносить записи — они сохранятся на телефоне и отправятся автоматически.': 'Желі жоқ. Жазбаларды енгізе беріңіз — олар телефонда сақталып, автоматты жіберіледі.',
    'Без сети разбор фразы недоступен — внесите через форму ниже, запись встанет в очередь': 'Желісіз сөйлемді талдау қолжетімсіз — төмендегі формамен енгізіңіз, жазба кезекке қойылады',
    'Распознавание по фото работает только с интернетом. Фото можно прикрепить к записи ниже': 'Фото бойынша тану тек интернетпен жұмыс істейді. Фотоны төмендегі жазбаға тіркеуге болады',
    'Память телефона заполнена — удалите фото из очереди': 'Телефон жады толы — кезектен фотоларды жойыңыз',
    'В очереди есть неотправленные записи. Они останутся на телефоне и уйдут после следующего входа. Выйти?': 'Кезекте жіберілмеген жазбалар бар. Олар телефонда қалады және келесі кіруден кейін жіберіледі. Шығу керек пе?',
    'Рейтинг подразделений': 'Бөлімшелер рейтингі',
    'Этот месяц': 'Осы ай',
    'Прошлый месяц': 'Өткен ай',
    'баллов': 'ұпай',
    'Цель': 'Мақсат',
    'цель': 'мақсат',
    'Цель месяца': 'Айдың мақсаты',
    'Цель месяца выполнена': 'Айдың мақсаты орындалды',
    'Цель и рейтинг': 'Мақсат және рейтинг',
    'Цель сохранена': 'Мақсат сақталды',
    'Отходов меньше на': 'Қалдық аз:',
    'Отходов больше на': 'Қалдық көп:',
    'до цели': 'мақсатқа дейін',
    'к базе': 'базаға қарағанда',
    'база': 'база',
    'кг/день': 'кг/күн',
    'место из': 'орын, барлығы',
    'мимо полигона': 'полигонға емес',
    'Сэкономлено к базе': 'Базаға қарағанда үнемделді',
    'Мало данных для сравнения с базой': 'Базамен салыстыру үшін дерек аз',
    'сравнение каждой организации со своей базой': 'әр ұйым өз базасымен салыстырылады',
    'Как считаются баллы (из 100)': 'Ұпай қалай есептеледі (100-ден)',
    'снижение кг на активный день к своей базе (3 предыдущих месяца); цель выполнена = 40': 'белсенді күнге шаққандағы кг-ның өз базасына қарағанда азаюы (алдыңғы 3 ай); мақсат орындалса = 40',
    'доля отходов мимо полигона (компост, корм, переработка, передача) к цели': 'полигонға бармаған қалдық үлесі (компост, жем, қайта өңдеу, беру) мақсатқа қарағанда',
    'регулярность учёта: дни с записями к ожидаемым': 'есептің жүйелілігі: жазба бар күндер күтілгенге қарағанда',
    'отчёт за прошлый месяц сдан до 5 числа': 'өткен айдың есебі 5-ке дейін тапсырылды',
    'Так столовая и кафедра сравниваются честно — по динамике, а не по килограммам.': 'Осылайша асхана мен кафедра әділ салыстырылады — килограммен емес, динамикамен.',
    'Снизить отходы (кг/день) к базе на, %': 'Қалдықты (кг/күн) базаға қарағанда азайту, %',
    'Доля мимо полигона, %': 'Полигонға емес үлес, %',
    'Все ваши данные под рукой: сегодня, неделя, месяц. Отчёт — одной кнопкой.': 'Барлық деректеріңіз қолыңызда: бүгін, апта, ай. Есеп — бір батырмамен.',
    '7 полных дней': '7 толық күн',
    'Этот месяц ': 'Осы ай ',
    'CO₂ за месяц': 'Айдағы CO₂',
    'Отчёт за месяц': 'Айлық есеп',
    'срок — до 5 числа': 'мерзімі — 5-ке дейін',
    'взвеш.': 'өлшеу',
    'записей': 'жазба',
    'к прошлой неделе': 'өткен аптаға',
    'можно': 'мүмкін',
    'Внести': 'Енгізу',
    'форма, фраза, весы': 'форма, сөйлем, таразы',
    'Excel, можно переслать': 'Excel, жіберуге болады',
    'Отчёт за неделю': 'Апталық есеп',
    'Статус отчёта': 'Есеп мәртебесі',
    'история и комментарии': 'тарих және пікірлер',
    'По дням — 7 полных дней': 'Күндер бойынша — 7 толық күн',
    'Что больше всего за неделю': 'Аптада ең көбі',
    'Нет данных за неделю': 'Аптада дерек жоқ',
    'Мимо полигона за месяц': 'Айда полигонға емес',
  },
};
let LANG = localStorage.getItem('lang') || 'ru';
const T = (s) => (LANG === 'kz' && I18N.kz[s]) || s;

// ---------- API ----------
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts,
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  } catch { const e = new Error(T('Нет сети')); e.offline = true; throw e; }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) { const e = new Error(data?.error || `Ошибка ${res.status}`); e.status = res.status; e.data = data; e.offline = !!data?.offline; throw e; }
  return data;
}

// ---------- работа без сети: очередь записей на телефоне ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const Q = {
  key: () => `wl-queue-${S.user?.id || 0}`,
  all() { try { return JSON.parse(localStorage.getItem(Q.key()) || '[]'); } catch { return []; } },
  save(list) { try { localStorage.setItem(Q.key(), JSON.stringify(list)); } catch { toast(T('Память телефона заполнена — удалите фото из очереди'), true); } netbar(); },
  add(body, label) { const list = Q.all(); list.push({ ...body, client_id: body.client_id || uid(), label, queued_at: new Date().toISOString() }); Q.save(list); },
  remove(cid) { Q.save(Q.all().filter((x) => x.client_id !== cid)); },
  busy: false,
  async flush(silent) {
    if (Q.busy || !S.user || S.user.role !== 'resp' || !navigator.onLine) return;
    const list = Q.all().filter((x) => !x.error); if (!list.length) return;
    Q.busy = true; netbar(); let ok = 0;
    for (const item of list) {
      const { label, queued_at, error, ...body } = item;
      try { await api('/entries', { method: 'POST', body: { ...body, force: true } }); Q.remove(item.client_id); ok++; }
      catch (e) {
        if (e.offline) break;
        Q.save(Q.all().map((x) => (x.client_id === item.client_id ? { ...x, error: e.message } : x)));
      }
    }
    Q.busy = false; netbar();
    if (ok) { toast(`${T('Отправлено из очереди')}: ${ok}`); if (!silent && ['form', 'me'].includes(parseHash().page)) route(); }
  },
};
function netbar() {
  let el = $('#netbar');
  const list = S.user ? Q.all() : []; const n = list.length; const bad = list.filter((x) => x.error).length;
  const off = !navigator.onLine;
  if (!off && !n) { el?.remove(); return; }
  if (!el) { el = document.createElement('button'); el.id = 'netbar'; document.body.appendChild(el); el.onclick = queueDialog; }
  el.className = 'netbar' + (off ? ' off' : '') + (bad ? ' bad' : '');
  el.textContent = off ? `● ${T('Нет сети')}${n ? ` · ${n} ${T('в очереди')}` : ` · ${T('ввод работает')}`}` : Q.busy ? `↻ ${T('Отправка')}…` : `⏳ ${n} ${T('в очереди')}${bad ? ` · ${bad} ${T('с ошибкой')}` : ''}`;
}
function queueDialog() {
  const list = Q.all();
  modal(`<h2>${T('Очередь отправки')}</h2>
    <p class="small muted">${T('Записи, внесённые без сети. Уйдут на сервер автоматически, когда появится интернет.')}</p>
    ${list.map((x) => `<div class="entry"><div class="t">${esc(x.label || '')}<small>${dmy(x.date)}${x.error ? ` · <span style="color:var(--red)">${esc(x.error)}</span>` : ''}</small></div>
      <button class="icon-btn" data-qx="${esc(x.client_id)}" title="${T('Удалить')}">✕</button></div>`).join('') || `<p class="muted">${T('Очередь пуста')}</p>`}
    <div class="row" style="margin-top:12px"><button id="qSend" ${navigator.onLine && list.length ? '' : 'disabled'}>${T('Отправить сейчас')}</button><button class="btn-light" data-close>${T('Закрыть')}</button></div>`, (m, close) => {
    $$('[data-qx]', m).forEach((b) => b.onclick = () => { if (confirm(T('Удалить запись из очереди?'))) { Q.remove(b.dataset.qx); close(); queueDialog(); } });
    $('#qSend', m).onclick = async () => { Q.save(Q.all().map(({ error, ...x }) => x)); close(); await Q.flush(); };
  });
}
addEventListener('online', () => { netbar(); Q.flush(); });
addEventListener('offline', netbar);
setInterval(() => Q.flush(true), 45000);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
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
const chip = (st, label) => `<span class="chip st-${esc(st)}">${esc(T(label || STATUS_RU[st] || st))}</span>`;

// ---------- state & router ----------
const S = { user: null, charts: [] };
const NAV = {
  resp: [['me', 'Моя сводка', '◉'], ['form', 'Ввод', '✎'], ['plan', 'План', '🍳'], ['rating', 'Рейтинг', '★'], ['my-reports', 'Мои отчёты', '☰'], ['dashboard', 'Аналитика', '▤'], ['eco', 'Своя кружка', '☕']],
  reviewer: [['reports', 'Отчёты', '✓'], ['registry', 'Реестр', '☰'], ['rating', 'Рейтинг', '★'], ['plan', 'План', '🍳'], ['summary', 'Сводный отчёт', '⇩'], ['dashboard', 'Аналитика', '▤'], ['control', 'Контроль сдачи', '!'], ['eco', 'Своя кружка', '☕']],
  manager: [['dashboard', 'Аналитика', '▤'], ['rating', 'Рейтинг', '★'], ['plan', 'План', '🍳'], ['summary', 'Сводный отчёт', '⇩'], ['registry', 'Реестр', '☰'], ['control', 'Контроль сдачи', '!'], ['eco', 'Своя кружка', '☕']],
  admin: [['admin', 'Администрирование', '⚙'], ['reports', 'Отчёты', '✓'], ['rating', 'Рейтинг', '★'], ['plan', 'План', '🍳'], ['registry', 'Реестр', '☰'], ['summary', 'Сводный отчёт', '⇩'], ['dashboard', 'Аналитика', '▤'], ['control', 'Контроль сдачи', '!'], ['eco', 'Своя кружка', '☕']],
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
  if (!S.cfg) { try { S.cfg = await api('/config'); } catch { S.cfg = { systemName: 'Wasteless', company: '', orgLabel: 'Организация', orgsLabel: 'Организации', industryLabel: '' }; } }
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
    if (r.page === 'eco') { // эко-калькулятор открыт всем (QR на кассе кофейни), без входа
      $('#app').innerHTML = `<div class="public-eco"><header class="topbar" style="display:flex"><div class="brand">${LOGO}<div><b>${esc(S.cfg.systemName)}</b></div></div>
        <a class="btn-ghost-light" href="#/login" style="margin-left:auto;padding:8px 12px;border-radius:10px">${T('Войти')}</a></header><main></main></div>`;
      pageEco($('main')); return;
    }
    return renderLogin(r);
  }
  netbar(); Q.flush(true);
  const nav = NAV[S.user.role];
  if (!r.page || r.page === 'login') return go('/' + nav[0][0]);
  shell(r.page);
  const main = $('main');
  const pages = { me: pageMe, form: pageForm, 'my-reports': pageReports, reports: pageReports, report: pageReport, registry: pageRegistry,
    summary: pageSummary, dashboard: pageDashboard, control: pageControl, admin: pageAdmin, rating: pageRating, plan: pagePlan, eco: pageEco };
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
ICONS.trophy = '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>';
ICONS.chef = '<path d="M6 13.9A4 4 0 1 1 8.4 6a4.5 4.5 0 0 1 7.2 0A4 4 0 1 1 18 13.9V20H6Z"/><path d="M6 17h12"/>';
ICONS.cup = '<path d="M17 8h1a3 3 0 0 1 0 6h-1"/><path d="M3 8h14v7a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z"/><path d="M7 2v3M11 2v3M15 2v3"/>';
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
const NAV_ICON = { plan: 'chef', eco: 'cup', rating: 'trophy', me: 'leaf', form: 'edit', 'my-reports': 'list', dashboard: 'chart', reports: 'check', registry: 'db', summary: 'file', control: 'alert', admin: 'gear' };
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
        <div class="me"><div class="avatar">${esc(initials(S.user.full_name))}</div><div><b>${esc(S.user.full_name)}</b><small>${esc(T(ROLE_RU[S.user.role]))}</small></div></div>
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
  $$('[data-logout]').forEach((b) => b.onclick = async () => {
    if (Q.all().length && !confirm(T('В очереди есть неотправленные записи. Они останутся на телефоне и уйдут после следующего входа. Выйти?'))) return;
    try { await api('/logout', { method: 'POST' }); } catch {}
    try { (await caches.keys()).forEach((k) => caches.delete(k)); } catch {}
    S.user = null; netbar(); go('/login'); route();
  });
  $$('[data-lang]').forEach((b) => b.onclick = () => { LANG = b.dataset.lang; localStorage.setItem('lang', LANG); api('/me/lang', { method: 'PUT', body: { lang: LANG } }).catch(() => {}); route(); });
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
  const [types, methods, prodRes] = await Promise.all([api('/waste-types'), api('/methods'), api('/products').catch(() => ({ products: [] }))]);
  const products = prodRes.products;
  const prodName = (p) => (LANG === 'kz' && p.name_kz) || p.name;
  const activeMethods = methods.filter((m) => m.active);
  const DKEY = `draft-entry-${S.user.id}`;
  let draft = {}; try { draft = JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch {}
  const st = { date: draft.date && draft.date <= todayIso() ? draft.date : todayIso(), typeId: draft.typeId || null, qty: draft.qty || '', methodId: draft.methodId || null, photo: null, editId: null, productId: draft.productId || null };
  let report;
  try { report = await api('/my-report?period=' + st.date.slice(0, 7)); }
  catch (e) { if (!e.offline) throw e; report = { id: 0, period: st.date.slice(0, 7), status: 'draft', status_ru: 'черновик', editable: true, entries: [], totals: { kg: 0, byType: [] }, history: [], offline: true }; }

  main.innerHTML = `<div class="form-wrap">
    <div class="page-head"><div><h1>${esc(S.user.org_name)}</h1><div class="muted small">${T('Ответственное лицо')}: ${esc(S.user.full_name)}</div></div></div>
    <div id="status"></div>
    <div class="card quick" id="quickCard">
      <h3 style="margin-bottom:6px">⚡ ${T('Быстрый ввод фразой')}</h3>
      <div class="small muted" style="margin-bottom:8px">${T('Скажите или напишите, например: «отходы из зала 12 кило, масло 3 литра»')}</div>
      <div class="qty-row"><input id="phrase" placeholder="${T('что взвесили…')}" autocomplete="off" style="font-size:16px;font-weight:400;text-align:left">
        <button type="button" class="btn-light" id="mic" title="Голосовой ввод" style="min-width:52px">🎙</button>
        <label class="btn btn-light" id="snapBtn" title="${T('Распознать по фото: отходы или табло весов')}" style="min-width:52px;margin:0;display:inline-flex;align-items:center;justify-content:center;color:var(--ink)">📷<input type="file" id="snap" accept="image/*" capture="environment" hidden></label>
        <button type="button" id="parse">→</button></div>
      <div class="small muted" style="margin-top:6px">📷 — ${T('сфотографируйте отходы или табло весов, ИИ определит продукт и вес')}</div>
      <div id="preview" class="preview"></div>
    </div>
    <div class="card" id="entryCard">
      <div class="row" style="margin-bottom:12px">
        <div class="field"><label>${T('Дата')}</label><input type="date" id="date" min="${minDate()}" max="${todayIso()}" value="${st.date}"></div>
      </div>
      <div class="field"><label>${T('Продукт')} <span class="muted small">(${T('необязательно')})</span></label>
        <input id="product" list="prodList" autocomplete="off" placeholder="${T('напр. хлеб, плов, картофель')}">
        <datalist id="prodList">${products.map((p) => `<option value="${esc(prodName(p))}">`).join('')}</datalist>
        <div class="small muted" id="prodHint"></div></div>
      <label>${T('Вид отхода')}</label>
      <div class="types" id="types"></div>
      <div class="field"><label>${T('Вес / объём')}</label>
        <div class="qty-row"><input id="qty" inputmode="decimal" autocomplete="off" placeholder="0,0" value="${esc(st.qty)}"><div class="unit" id="unit">кг</div></div></div>
      <div id="recHint"></div>
      <div class="field"><label>${T('Способ утилизации')}</label><select id="method">${activeMethods.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field photo-btn"><label class="btn btn-light btn-sm" style="margin:0;color:var(--ink)">📷 ${T('Фото')}<input type="file" id="photo" accept="image/*" capture="environment" hidden></label><span id="photoPrev" class="small muted">${T('необязательно')}</span></div>
      <div style="display:flex;gap:8px"><button class="btn-lg" id="save" style="flex:1">${T('Сохранить запись')}</button>
        <button class="btn-lg btn-sec" id="scale" type="button" style="width:auto" title="Получить вес с электронных весов">⚖ ${T('Весы')}</button></div>
      <button class="btn-lg btn-light hidden" id="cancelEdit" style="margin-top:8px">${T('Отменить редактирование')}</button>
      <div class="saved-hint" id="hint"></div>
    </div>
    <div class="card"><div class="totals" id="totals"></div></div>
    <div class="card" id="tgCard"></div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${T('Записи')} за ${monthName(report.period)}</h3><span class="small muted" id="cnt"></span></div><div id="list"></div></div>
    <div class="card" id="histCard"></div>
  </div>`;

  const saveDraft = () => { localStorage.setItem(DKEY, JSON.stringify({ date: st.date, typeId: st.typeId, qty: st.qty, methodId: st.methodId, productId: st.productId })); $('#hint').textContent = st.qty || st.typeId ? 'Черновик сохранён автоматически' : ''; };
  const typeById = (id) => types.find((t) => t.id === +id);
  const prodById = (id) => products.find((p) => p.id === +id);
  function setProduct(p) {
    st.productId = p ? p.id : null;
    $('#product').value = p ? prodName(p) : '';
    $('#prodHint').innerHTML = p ? `${p.price_kzt_kg ? `≈ ${fmt(p.price_kzt_kg, 0)} ₸/кг · ` : ''}${p.type_id ? T('вид отхода выбран автоматически') : T('выберите вид отхода')}` : '';
    if (p?.type_id && typeById(p.type_id)) selectType(p.type_id); else saveDraft();
  }

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
      <div>${T('Отчёт за')} <b>${LANG === 'kz' ? report.period.split('-').reverse().join('.') : monthName(report.period)}</b> ${chip(report.status, report.status_ru)}
      <div class="small muted">${LANG === 'kz' ? `Тапсыру мерзімі: 05.${String(dl.getMonth() + 1).padStart(2, "0")}.${dl.getFullYear()} дейін ${daysLeft >= 0 ? `(${daysLeft} күн қалды)` : ''}` : `Срок сдачи: до 5 ${MONTHS_GEN[dl.getMonth()]} ${daysLeft >= 0 ? `(осталось ${daysLeft} дн.)` : ''}`}</div></div>
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
    const queued = Q.all().filter((x) => x.date?.slice(0, 7) === report.period);
    const byDate = {}; report.entries.forEach((e) => (byDate[e.date] ??= []).push(e));
    $('#list').innerHTML = Object.entries(byDate).slice(0, 12).map(([d, es]) => `<div class="small muted" style="margin-top:10px"><b>${dmy(d)}</b> · ${fmt(es.reduce((a, e) => a + e.kg, 0))} кг</div>` +
      es.map((e) => `<div class="entry"><div class="t">${e.product_name ? `<b>${esc(e.product_name)}</b> → ` : ''}${esc(e.type_name)}<small>${esc(e.method_name)}${e.photo ? ' · 📷' : ''}${SRC_ICON[e.source] || ''}</small></div><div class="q">${fmt(e.qty, 2)} ${e.unit}</div>
        ${ed ? `<button class="icon-btn" data-edit="${e.id}" title="Изменить">✎</button><button class="icon-btn" data-del="${e.id}" title="Удалить">✕</button>` : ''}</div>`).join('')).join('')
      + (Object.keys(byDate).length > 12 ? `<p class="small muted">… и ещё ${Object.keys(byDate).length - 12} дн. — <a href="#/report/${report.id}">открыть отчёт полностью</a></p>` : '')
      || (queued.length ? '' : '<p class="muted">Пока нет записей за этот месяц.</p>');
    if (queued.length) $('#list').insertAdjacentHTML('afterbegin', `<div class="small muted" style="margin-top:6px"><b>⏳ ${T('Ждут отправки')}</b> · ${queued.length}</div>` +
      queued.map((x) => `<div class="entry queued"><div class="t">${esc(x.label)}<small>${dmy(x.date)}${x.error ? ` · <span style="color:var(--red)">${esc(x.error)}</span>` : ` · ${T('отправится, когда появится сеть')}`}</small></div></div>`).join(''));
    if (report.offline) $('#status').innerHTML = `<div class="alert alert-amber">${T('Нет сети. Можно вносить записи — они сохранятся на телефоне и отправятся автоматически.')}</div>`;
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
    if (st.date.slice(0, 7) !== report.period) {
      try { report = await api('/my-report?period=' + st.date.slice(0, 7)); }
      catch (err) { if (!err.offline) return toast(err.message, true); report = { ...report, id: 0, period: st.date.slice(0, 7), entries: [], totals: { kg: 0, byType: [] }, history: [], offline: true }; }
    }
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
    const body = { date: st.date, waste_type_id: st.typeId, product_id: st.productId, qty, method_id: +$('#method').value, photo: st.photo };
    const afterSave = () => {
      resetEdit(); st.qty = ''; st.photo = null; $('#qty').value = ''; $('#photo').value = ''; $('#photoPrev').textContent = T('необязательно');
      setProduct(null); localStorage.removeItem(DKEY); $('#hint').textContent = ''; renderAll();
    };
    const send = async (force) => {
      try {
        const r = st.editId ? await api('/entries/' + st.editId, { method: 'PUT', body }) : await api('/entries', { method: 'POST', body: { ...body, force } });
        report = r.report; buzz(); toast(st.editId ? 'Запись изменена' : `Сохранено: ${typeById(st.typeId)?.name} — ${fmt(qty, 2)} ${typeById(st.typeId)?.unit}`);
        afterSave();
      } catch (e) {
        if (e.offline && !st.editId) {
          const t = typeById(st.typeId); const p = prodById(st.productId);
          Q.add({ ...body, source: 'offline' }, `${p ? prodName(p) + ' → ' : ''}${t?.name} — ${fmt(qty, 2)} ${t?.unit}`);
          buzz(); toast(T('Нет сети — запись сохранена на телефоне и отправится сама')); afterSave(); return;
        }
        if (e.status === 409 && e.data?.duplicate) { if (confirm(e.message)) return send(true); return; }
        toast(e.message, true);
      }
    };
    send(false);
  };
  // ---- быстрый ввод фразой / голосом (ИИ разбирает фразу в записи, человек подтверждает)
  let parsed = []; let parsedPhoto = null;
  const renderPreview = (src, unknown = [], note = '') => {
    const badge = src === 'photo' ? `<span class="chip st-accepted">📷 ${T('по фото')} · Claude</span>` : src === 'ai' ? '<span class="chip st-accepted">ИИ · Claude</span>' : `<span class="chip st-draft">${T('по справочнику')}</span>`;
    $('#preview').innerHTML = parsed.length ? `<div class="small muted" style="margin:10px 0 4px">${T('Распознано')} ${badge} — ${T('проверьте и сохраните')}:</div>
      ${parsed.map((p, i) => `<div class="entry"><div class="t">${p.product ? `<b>${esc(p.product)}</b> → ` : ''}${esc(p.name)}<small>${esc(p.fragment || '')}${p.qty_source === 'estimate' ? ` · <span style="color:var(--amber)">${T('вес оценён на глаз — уточните')}</span>` : p.qty_source === 'scale' ? ` · ⚖ ${T('с табло весов')}` : ''}</small></div>
        <input data-pq="${i}" value="${p.qty}" inputmode="decimal" style="width:80px;text-align:right"><span class="small">${p.unit}</span><button class="icon-btn" data-px="${i}">✕</button></div>`).join('')}
      ${unknown.length ? `<div class="small" style="color:var(--amber)">Не найдено в справочнике: ${unknown.map(esc).join(', ')} — добавьте через «＋ Новый вид»</div>` : ''}
      ${note ? `<div class="small muted" style="margin-top:6px">💬 ${esc(note)}</div>` : ''}
      <button class="btn-lg" id="saveAll" style="margin-top:10px">Сохранить ${parsed.length} ${parsed.length === 1 ? 'запись' : 'записи'}</button>`
      : `<div class="small" style="color:var(--amber);margin-top:8px">Не удалось распознать вид и вес — попробуйте «очистки овощей 15 кг».</div>`;
    $$('[data-pq]').forEach((x) => x.oninput = () => { parsed[+x.dataset.pq].qty = parseFloat(x.value.replace(',', '.')); });
    $$('[data-px]').forEach((x) => x.onclick = () => { parsed.splice(+x.dataset.px, 1); renderPreview(src, unknown, note); });
    if ($('#saveAll')) $('#saveAll').onclick = async () => {
      let ok = 0, queued = 0;
      for (const p of parsed) {
        const body = { date: st.date, waste_type_id: p.waste_type_id, product_id: p.product_id || null, qty: p.qty, method_id: p.method_id, source: src === 'photo' ? 'photo' : 'voice', photo_ref: parsedPhoto, client_id: uid() };
        try { const r = await api('/entries', { method: 'POST', body: { ...body, force: true } }); report = r.report; ok++; }
        catch (e) { if (e.offline) { Q.add(body, `${p.product ? p.product + ' → ' : ''}${p.name} — ${fmt(p.qty, 2)} ${p.unit}`); queued++; } else toast(`${p.name}: ${e.message}`, true); }
      }
      if (queued) toast(`${T('Нет сети — в очереди')}: ${queued}`);
      if (ok || queued) { if (ok) toast(`${T('Сохранено записей')}: ${ok}`); parsed = []; parsedPhoto = null; $('#phrase').value = ''; $('#preview').innerHTML = ''; renderAll(); }
    };
  };
  const doParse = async () => {
    const text = $('#phrase').value.trim(); if (!text) return $('#phrase').focus();
    $('#parse').disabled = true; $('#parse').textContent = '…';
    if (!navigator.onLine) { $('#parse').disabled = false; $('#parse').textContent = '→'; return toast(T('Без сети разбор фразы недоступен — внесите через форму ниже, запись встанет в очередь'), true); }
    try { const r = await api('/ai/parse', { method: 'POST', body: { text } }); parsed = r.items; parsedPhoto = null; renderPreview(r.source, r.unknown); }
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
  $('#product').onchange = () => {
    const v = $('#product').value.trim().toLowerCase();
    const p = products.find((x) => [x.name, x.name_kz].filter(Boolean).some((n) => n.toLowerCase() === v))
      || (v.length >= 3 && products.find((x) => [x.name, x.name_kz, ...String(x.synonyms).split(',')].filter(Boolean).some((n) => n.toLowerCase().startsWith(v))));
    if (v && !p) { st.productId = null; $('#prodHint').textContent = T('Нет в справочнике — выберите вид отхода вручную'); saveDraft(); return; }
    setProduct(p || null);
  };
  // ---- распознавание по фото (Claude смотрит на отходы или на табло весов)
  $('#snap').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!navigator.onLine) { e.target.value = ''; return toast(T('Распознавание по фото работает только с интернетом. Фото можно прикрепить к записи ниже'), true); }
    const img = await compressImage(f, 1400); e.target.value = ''; if (!img) return;
    $('#preview').innerHTML = `<div class="snap-wait"><img src="${img}" alt=""><span>${T('Смотрю на фото…')}</span></div>`;
    $('#snapBtn').classList.add('disabled');
    try {
      const r = await api('/ai/photo', { method: 'POST', body: { photo: img } });
      parsed = r.items; parsedPhoto = r.photo_ref;
      if (!parsed.length) { $('#preview').innerHTML = `<div class="small" style="color:var(--amber);margin-top:8px">${esc(r.note || T('Не удалось определить отходы на фото'))}</div>`; return; }
      renderPreview('photo', [], r.note);
    } catch (err) { $('#preview').innerHTML = ''; toast(err.message, true); }
    finally { $('#snapBtn').classList.remove('disabled'); }
  };
  // ---- электронные весы (эмулятор устройства; реальные весы шлют POST /api/scale/entries)
  $('#scale').onclick = async () => {
    if (!st.typeId) return toast('Выберите вид отхода и положите его на весы', true);
    try { const r = await api('/scale/emulate', { method: 'POST', body: { waste_type_id: st.typeId } }); report = r.report; toast(`⚖ С весов: ${r.waste_type} — ${fmt(r.qty, 2)} ${r.unit}`); renderAll(); }
    catch (e) { toast(e.message, true); }
  };
  $('#quickCard').classList.toggle('hidden', !report.editable);

  telegramCard($('#tgCard'));
  if (st.productId && prodById(st.productId)) { $('#product').value = prodName(prodById(st.productId)); }
  if (st.typeId && typeById(st.typeId)) { selectType(st.typeId, true); if (st.methodId) $('#method').value = st.methodId; renderRecHint(); if (st.qty) $('#hint').textContent = 'Восстановлен несохранённый черновик'; }
  renderAll();
}

function compressImage(file, max = 1024) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
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
// ---------- прогноз «сколько готовить» и итог дня ----------
const WD_FULL = { ru: { вс: 'воскресенье', пн: 'понедельник', вт: 'вторник', ср: 'среда', чт: 'четверг', пт: 'пятница', сб: 'суббота' },
  kz: { вс: 'жексенбі', пн: 'дүйсенбі', вт: 'сейсенбі', ср: 'сәрсенбі', чт: 'бейсенбі', пт: 'жұма', сб: 'сенбі' } };
const CONF = { high: ['надёжно', 'сенімді'], medium: ['средне', 'орташа'], low: ['мало данных', 'дерек аз'] };
async function pagePlan(main, r) {
  const staff = S.user.role !== 'resp';
  const orgs = staff ? await api('/orgs') : [];
  const orgId = staff ? (+r.q.org || orgs.find((o) => /столов/i.test(o.type))?.id || orgs[0]?.id) : S.user.org_id;
  const q = new URLSearchParams({ ...(staff ? { org: orgId } : {}), ...(r.q.date ? { date: r.q.date } : {}) });
  const f = await api('/forecast?' + q);
  const kz = LANG === 'kz';
  const nm = (x) => (kz && x.name_kz) || x.name;
  const wdName = WD_FULL[kz ? 'kz' : 'ru'][f.weekday];
  const t = f.totals;
  main.innerHTML = `
    <div class="page-head"><div><h1>${T('Сколько готовить')}: ${esc(wdName)}, ${dmy(f.date)}</h1>
      <div class="muted small">${T('Прогноз спроса по блюдам: тот же день недели за')} ${f.weeks} ${T('нед.')} + ${T('запас')} ${f.safetyPct}%</div></div>
      <div class="row" style="gap:8px;align-items:flex-end">
        ${staff ? `<div class="field" style="margin:0"><label>${esc(S.cfg.orgLabel)}</label><select id="pOrg">${orgs.map((o) => `<option value="${o.id}" ${o.id === orgId ? 'selected' : ''}>${esc(o.short)}</option>`).join('')}</select></div>` : ''}
        <div class="field" style="margin:0"><label>${T('Дата')}</label><input type="date" id="pDate" value="${f.date}"></div></div></div>
    ${!f.items.length ? `<div class="card"><h3>${f.closed ? T('В этот день недели обычно не готовят') : T('Пока недостаточно истории')}</h3>
      <p class="muted">${T('Вносите внизу «Итог дня»: сколько приготовили и сколько осталось. Через 2 недели система начнёт подсказывать, сколько готовить, чтобы не выбрасывать.')}</p></div>` : `
    <section class="hero">
      <div class="eyebrow">${T('План на')} ${esc(wdName)}</div>
      <h1 style="margin-bottom:8px">${t.save_kg >= 1 ? `${T('Можно готовить на')} ${fmt(t.save_kg)} ${T('кг меньше — и никто не останется голодным')}` : T('Объёмы уже близки к спросу 👍')}</h1>
      <div class="hero-kpis">
        <div class="hero-kpi lime"><div class="label">${T('Рекомендуем приготовить')}</div><div class="value">${fmt(t.rec_kg)} кг</div><div class="sub">${T('обычно')} ${fmt(t.usual_kg)} кг</div></div>
        <div class="hero-kpi"><div class="label">${T('Меньше отходов')}</div><div class="value">${fmt(t.save_kg)} кг</div><div class="sub">${T('за день')}</div></div>
        <div class="hero-kpi"><div class="label">${T('Экономия')}</div><div class="value">${fmt(t.save_kzt, 0)} ₸</div><div class="sub">${T('по ценам справочника')}</div></div>
        <div class="hero-kpi"><div class="label">CO₂</div><div class="value">−${fmt(t.save_co2)} кг</div><div class="sub">${T('не уйдёт на полигон')}</div></div>
      </div>
    </section>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>${T('Блюдо')}</th><th class="num">${T('Обычно готовят')}</th><th class="num">${T('Остаётся')}</th><th class="num">${T('Рекомендуем')}</th><th class="num">${T('Экономия')}</th><th>${T('Точность')}</th></tr></thead>
      <tbody>${f.items.map((x) => `<tr><td><b>${esc(nm(x))}</b></td><td class="num">${fmt(x.usual_kg)} кг</td>
        <td class="num ${x.leftover_pct >= 15 ? 'up' : ''}">${fmt(x.leftover_kg)} кг · ${x.leftover_pct}%</td>
        <td class="num"><b>${fmt(x.rec_kg)} кг</b></td><td class="num">${x.save_kg >= 0.1 ? `−${fmt(x.save_kg)} кг · ${fmt(x.save_kzt, 0)} ₸` : '—'}</td>
        <td><span class="badge ${x.confidence === 'high' ? 'good' : x.confidence === 'low' ? 'warn' : ''}">${CONF[x.confidence][kz ? 1 : 0]} · ${x.n} ${T('нед.')}</span></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin:10px 0 0">${T('Спрос = приготовлено − осталось. Свежие недели весят больше. Если блюдо закончилось раньше времени — укажите остаток 0, прогноз это учтёт.')}</p></div>`}
    ${f.track?.days ? `<div class="card small"><b>${T('За 30 дней')}:</b> ${T('приготовлено')} ${fmt(f.track.cooked_kg)} кг, ${T('осталось')} ${fmt(f.track.leftover_kg)} кг (<b>${fmt(f.track.leftover_pct)}%</b>) · ${f.track.days} ${T('дн. с данными')}</div>` : ''}
    ${staff ? '' : '<div class="card" id="dayCard"></div>'}`;
  const reload = () => go('/plan?' + new URLSearchParams({ ...(staff ? { org: $('#pOrg').value } : {}), date: $('#pDate').value }));
  $('#pDate').onchange = reload; if ($('#pOrg')) $('#pOrg').onchange = reload;
  if (!staff) dayForm($('#dayCard'));
}
// итог дня: приготовлено / осталось по блюдам
async function dayForm(el, date = todayIso()) {
  const [d, { products }] = await Promise.all([api('/production?date=' + date), api('/products')]);
  const kz = LANG === 'kz'; const nm = (x) => (kz && x.name_kz) || x.name;
  const ids = [...new Set([...d.rows.map((x) => x.product_id), ...d.usual.map((x) => x.product_id)])];
  const row = (pid) => { const p = products.find((x) => x.id === pid) || d.usual.find((x) => x.product_id === pid); const cur = d.rows.find((x) => x.product_id === pid) || {};
    return `<div class="entry" data-pp="${pid}"><div class="t">${esc(nm(p || { name: '?' }))}</div>
      <input data-c inputmode="decimal" placeholder="${T('приготовлено')}" value="${cur.cooked_kg ?? ''}" style="width:96px;text-align:right">
      <input data-l inputmode="decimal" placeholder="${T('осталось')}" value="${cur.leftover_kg ?? ''}" style="width:86px;text-align:right"><span class="small">кг</span></div>`; };
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">${T('Итог дня: приготовлено / осталось')}</h3>
      <input type="date" id="dDate" value="${date}" max="${todayIso()}" style="width:auto"></div>
    <p class="small muted">${T('Вносите в конце смены — по этим цифрам система считает спрос и советует, сколько готовить. Остаток — то, что не продали.')}</p>
    <div id="dRows">${ids.map(row).join('') || `<p class="muted small">${T('Добавьте блюда, которые готовите')}</p>`}</div>
    <div class="row" style="margin-top:10px;gap:8px;align-items:center"><select id="dAdd" style="flex:1"><option value="">＋ ${T('Добавить блюдо')}</option>${products.filter((p) => !ids.includes(p.id) && !['oil', 'cardboard', 'pet', 'film', 'glass', 'can', 'packaging', 'eggshell', 'bones'].includes(p.kind)).map((p) => `<option value="${p.id}">${esc(nm(p))}</option>`).join('')}</select>
      <button id="dSave">${T('Сохранить итог дня')}</button></div>`;
  $('#dDate', el).onchange = (e) => dayForm(el, e.target.value);
  $('#dAdd', el).onchange = (e) => { const id = +e.target.value; if (!id) return; $('#dRows', el).querySelector('p')?.remove(); $('#dRows', el).insertAdjacentHTML('beforeend', row(id)); e.target.querySelector(`option[value="${id}"]`).remove(); e.target.value = ''; };
  $('#dSave', el).onclick = async () => {
    const items = $$('[data-pp]', el).map((x) => ({ product_id: +x.dataset.pp, cooked_kg: $('[data-c]', x).value.replace(',', '.'), leftover_kg: $('[data-l]', x).value.replace(',', '.') })).filter((x) => x.cooked_kg !== '');
    try { const r = await api('/production', { method: 'POST', body: { date: $('#dDate', el).value, items } }); buzz(); toast(`${T('Сохранено блюд')}: ${r.saved}`); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------- эко-калькулятор «Своя кружка» ----------
// Одноразовый стакан с крышкой ≈ 14 г (бумага с ПЭ + пластиковая крышка), след ≈ 21 г CO₂e по нижней оценке (Huhtamaki LCA);
// независимые оценки — до 61–110 г. Многоразовая кружка «отбивает» свой след примерно за 20–40 использований.
const CUP = { g: 14, co2g: 21, co2gHigh: 61 };
function pageEco(main) {
  const disc = Number(S.cfg?.cupDiscountKzt ?? 100);
  main.innerHTML = `
    <section class="hero">
      <div class="eyebrow">${T('Эко-калькулятор')}</div>
      <h1>${T('Своя кружка: сколько вы сэкономите')}</h1>
      <div class="muted small">${T('Приходите в кофейню со своей кружкой или термосом — получаете скидку, а одноразовый стакан не попадает на полигон.')}</div>
    </section>
    <div class="grid g2">
      <div class="card">
        <div class="field"><label>${T('Сколько кофе/чая в день')}</label><div class="qty-row"><button type="button" class="btn-light" data-d="-1" style="min-width:52px">−</button><input id="eN" inputmode="numeric" value="2" style="text-align:center"><button type="button" class="btn-light" data-d="1" style="min-width:52px">＋</button></div></div>
        <div class="field"><label>${T('Дней в неделю')}</label><input id="eW" type="range" min="1" max="7" value="5"><div class="small muted"><span id="eWv">5</span> ${T('дн.')}</div></div>
        <div class="field"><label>${T('Скидка за свою кружку, ₸')}</label><input id="eD" inputmode="numeric" value="${disc}"></div>
        <div class="field"><label>${T('Сколько человек (вы, группа, факультет)')}</label><input id="eP" inputmode="numeric" value="1"></div>
      </div>
      <div class="card" id="eOut"></div>
    </div>
    <div class="card small muted">${T('Допущения')}: ${T('стакан с крышкой')} ≈ ${CUP.g} г; ${T('углеродный след')} ≈ ${CUP.co2g} г CO₂e ${T('на стакан по нижней оценке')} (Huhtamaki LCA), ${T('по другим исследованиям — до')} ${CUP.co2gHigh}–110 г. ${T('Учебный год ≈ 36 недель. Многоразовая кружка окупает свой собственный след примерно за 20–40 использований.')}</div>`;
  const calc = () => {
    const n = Math.max(0, Math.min(20, +$('#eN').value || 0)); const w = +$('#eW').value; const d = Math.max(0, +$('#eD').value || 0); const ppl = Math.max(1, Math.min(100000, +$('#eP').value || 1));
    $('#eWv').textContent = w;
    const per = (weeks) => n * w * weeks * ppl;
    const rows = [[T('Неделя'), 1], [T('Месяц'), 4.3], [T('Учебный год'), 36]];
    const yr = per(36);
    $('#eOut').innerHTML = `<h3>${n} ${T('чашки в день')} × ${w} ${T('дн.')}${ppl > 1 ? ` × ${fmt(ppl, 0)} ${T('чел.')}` : ''}</h3>
      <div class="table-wrap"><table><thead><tr><th></th><th class="num">${T('Стаканов')}</th><th class="num">${T('Мусора')}</th><th class="num">CO₂</th><th class="num">${T('Скидка')}</th></tr></thead><tbody>
      ${rows.map(([l, wk]) => { const c = per(wk); return `<tr><td>${l}</td><td class="num">${fmt(c, 0)}</td><td class="num">${c * CUP.g >= 1000 ? fmt(c * CUP.g / 1000, 1) + ' кг' : fmt(c * CUP.g, 0) + ' г'}</td><td class="num">${fmt(c * CUP.co2g / 1000, 1)} кг</td><td class="num"><b>${fmt(c * d, 0)} ₸</b></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="alert alert-green" style="margin-top:12px">🌱 ${T('За учебный год')}: <b>${fmt(yr, 0)}</b> ${T('стаканов не окажутся на полигоне')}, ${T('а вы сэкономите')} <b>${fmt(yr * d, 0)} ₸</b>.
        ${n >= 2 ? `<br>${T('Даже если в свою кружку брать только одну чашку из')} ${n} — ${fmt(yr / n, 0)} ${T('стаканов и')} ${fmt(yr / n * d, 0)} ₸ ${T('за год')}.` : ''}</div>
      <div class="small muted">${T('Это как')} ${fmt(yr * CUP.co2g / 1000 / 0.12, 0)} ${T('км на автомобиле')} (≈ 120 г CO₂/км).</div>`;
  };
  $$('[data-d]').forEach((b) => b.onclick = () => { $('#eN').value = Math.max(0, (+$('#eN').value || 0) + +b.dataset.d); calc(); });
  ['#eN', '#eW', '#eD', '#eP'].forEach((id) => $(id).oninput = calc);
  calc();
}

// ---------- цели и рейтинг ----------
const BADGE_KZ = { goal: 'Мақсат орындалды', divert: 'Полигонға емес', regular: 'Тұрақты есеп', ontime: 'Есеп уақытында', growth: 'Өсім', nodata: 'Жазба жоқ' };
const badgeText = (b) => (LANG === 'kz' && BADGE_KZ[b.k] ? BADGE_KZ[b.k] + (b.k === 'growth' ? ` ${b.text.replace(/\D+/, '')}` : '') : b.text);
const badgesHtml = (bs) => `<div class="badges">${bs.map((b) => `<span class="badge ${b.level}">${esc(badgeText(b))}</span>`).join('')}</div>`;
function goalBar(r) {
  if (r.progress == null) return `<div class="small muted">${T('Мало данных для сравнения с базой')}</div>`;
  const w = Math.max(3, Math.min(100, r.progress));
  return `<div class="goal-bar ${r.progress >= 100 ? 'ok' : r.progress < 0 ? 'over' : ''}"><i style="width:${r.progress < 0 ? Math.max(3, Math.min(100, -r.progress)) : w}%"></i></div>
    <div class="small muted">${fmt(r.kgPerDay)} ${T('кг/день')} · ${T('база')} ${fmt(r.basePerDay)} · ${T('цель')} ≤ ${fmt(r.targetPerDay)} (−${fmt(r.goal.reduce_pct, 0)}%)</div>`;
}
function goalCard(g) {
  const ch = g.changePct;
  const head = ch == null ? T('Цель месяца') : ch <= -g.goal.reduce_pct ? `🎉 ${T('Цель месяца выполнена')}` : ch < 0 ? `${T('Отходов меньше на')} ${fmt(-ch)}% — ${T('до цели')} ${fmt(g.goal.reduce_pct + ch)}%` : `${T('Отходов больше на')} ${fmt(ch)}% ${T('к базе')}`;
  return `<a class="card goal-card" href="#/rating" style="display:block;color:inherit;text-decoration:none">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="small muted">${T('Цель и рейтинг')} · ${esc(MONTHS[new Date().getMonth()])}</div><h3 style="margin:2px 0 0">${head}</h3></div>
    <div class="rank-score">${g.place}<small>${T('место из')} ${g.of}</small></div></div>
    ${goalBar(g)}${badgesHtml(g.badges)}${g.savedKg ? `<div class="small" style="margin-top:6px">🌱 ${T('Сэкономлено к базе')}: <b>${fmt(g.savedKg)} кг</b></div>` : ''}</a>`;
}
async function pageRating(main, r) {
  const cur = todayIso().slice(0, 7);
  const prev = (() => { const d = new Date(cur + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const period = r.q.period || cur;
  const d = await api('/rating?period=' + period);
  const canEdit = ['reviewer', 'admin'].includes(S.user.role);
  main.innerHTML = `
    <div class="page-head"><div><h1>${T('Рейтинг подразделений')}</h1><div class="muted small">${esc(d.label)} · ${T('сравнение каждой организации со своей базой')} (${dmy(d.baseline.from)}–${dmy(d.baseline.to)})</div></div>
      <div class="period-chips">${[[cur, T('Этот месяц')], [prev, T('Прошлый месяц')]].map(([p, l]) => `<a class="pchip ${p === period ? 'on' : ''}" style="text-decoration:none" href="#/rating?period=${p}">${l}</a>`).join('')}</div></div>
    <div class="card">${d.rows.map((x) => `<div class="rank-row ${x.place <= 3 ? 'top' + x.place : ''} ${x.org_id === d.myOrg ? 'mine' : ''}">
      <div class="rank-n">${x.place}</div>
      <div style="min-width:0"><b>${esc(x.short)}</b> <span class="small muted">${esc(x.type)}</span>
        ${goalBar(x)}${badgesHtml(x.badges)}
        ${canEdit ? `<button class="btn-light btn-sm" data-goal="${x.org_id}" style="margin-top:8px">🎯 ${T('Цель')}: −${fmt(x.goal.reduce_pct, 0)}% · ${T('мимо полигона')} ${fmt(x.goal.diverted_pct, 0)}%</button>` : ''}</div>
      <div class="rank-score">${x.score}<small>${T('баллов')}</small></div></div>`).join('')}</div>
    <div class="card small muted"><b>${T('Как считаются баллы (из 100)')}</b><br>
      40 — ${T('снижение кг на активный день к своей базе (3 предыдущих месяца); цель выполнена = 40')}<br>
      30 — ${T('доля отходов мимо полигона (компост, корм, переработка, передача) к цели')}<br>
      20 — ${T('регулярность учёта: дни с записями к ожидаемым')}<br>
      10 — ${T('отчёт за прошлый месяц сдан до 5 числа')}<br>
      ${T('Так столовая и кафедра сравниваются честно — по динамике, а не по килограммам.')}</div>`;
  $$('[data-goal]').forEach((b) => b.onclick = () => {
    const x = d.rows.find((y) => y.org_id === +b.dataset.goal);
    modal(`<h2>${T('Цель')}: ${esc(x.short)}</h2>
      <div class="field"><label>${T('Снизить отходы (кг/день) к базе на, %')}</label><input id="gR" type="number" min="0" max="90" step="1" value="${x.goal.reduce_pct}"></div>
      <div class="field"><label>${T('Доля мимо полигона, %')}</label><input id="gD" type="number" min="0" max="100" step="5" value="${x.goal.diverted_pct}"></div>
      <div class="row"><button id="gS">${T('Сохранить')}</button><button class="btn-light" data-close>${T('Отмена')}</button></div>`, (m, close) => {
      $('#gS', m).onclick = async () => {
        try { await api('/goals/' + x.org_id, { method: 'PUT', body: { reduce_pct: $('#gR', m).value, diverted_pct: $('#gD', m).value } }); close(); toast(T('Цель сохранена')); route(); }
        catch (e) { toast(e.message, true); }
      };
    });
  });
}

async function pageMe(main) {
  const s = await api('/my-summary');
  const arrow = (c) => c == null ? '<span class="muted">—</span>' : `<span class="${c > 0 ? 'up' : 'down'}">${c > 0 ? '▲' : '▼'} ${fmt(Math.abs(c))}%</span>`;
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const rep = s.report;
  main.innerHTML = `
    <section class="hero">
      <div class="eyebrow">${esc(S.user.org_short)} · ${new Date().toLocaleDateString(LANG === 'kz' ? 'kk-KZ' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>${T('Моя сводка')}</h1>
      <div class="muted small">${T('Все ваши данные под рукой: сегодня, неделя, месяц. Отчёт — одной кнопкой.')}</div>
      <div class="hero-kpis">
        <div class="hero-kpi lime"><div class="label">${T('Сегодня')}</div><div class="value">${fmt(s.today.kg)} кг</div><div class="sub">${s.today.entries} ${T('взвеш.')}</div></div>
        <div class="hero-kpi"><div class="label">${T('7 полных дней')}</div><div class="value">${fmt(s.week.kg)} кг</div><div class="sub">${T('к прошлой неделе')}: ${arrow(s.week.changePct)}</div></div>
        <div class="hero-kpi"><div class="label">${T('Этот месяц')}</div><div class="value">${fmt(s.month.kg)} кг</div><div class="sub">${s.month.entries} ${T('записей')}</div></div>
        <div class="hero-kpi"><div class="label">${T('CO₂ за месяц')}</div><div class="value">${fmt(s.month.co2)} кг</div><div class="sub">${T('можно')} −${fmt(s.month.co2Potential)} кг</div></div>
        <div class="hero-kpi"><div class="label">${T('Отчёт за месяц')}</div><div class="value" style="font-size:17px;margin-top:6px">${chip(rep.status, rep.status_ru)}</div><div class="sub">${T('срок — до 5 числа')}</div></div>
      </div>
    </section>
    ${rep.status === 'returned' ? `<div class="alert alert-red"><b>Отчёт возвращён:</b> ${esc(rep.last_comment)} — <a href="#/form">исправить</a></div>` : ''}
    ${s.goal ? goalCard(s.goal) : ''}
    <div class="quick-actions">
      <a class="qa" href="#/form">${icon('edit')}<b>${T('Внести')}</b><small>${T('форма, фраза, весы')}</small></a>
      <a class="qa" href="/api/my-report.xlsx?p=month">${icon('file')}<b>${T('Отчёт за месяц')}</b><small>${T('Excel, можно переслать')}</small></a>
      <a class="qa" href="/api/my-report.xlsx?p=week">${icon('db')}<b>${T('Отчёт за неделю')}</b><small>Excel</small></a>
      <a class="qa" href="#/report/${rep.id}">${icon('check')}<b>${T('Статус отчёта')}</b><small>${T('история и комментарии')}</small></a>
    </div>
    <div class="grid g2">
      <div class="card"><h3>${T('По дням — 7 полных дней')}</h3><div class="chart-box" style="height:220px"><canvas id="cw"></canvas></div></div>
      <div class="card"><h3>${T('Что больше всего за неделю')}</h3>
        ${s.week.byType.slice(0, 5).map((t) => `<div class="bar-row"><span>${esc(t.name)}</span><b>${fmt(t.kg)} кг</b><i style="width:${s.week.kg ? Math.max(4, t.kg / s.week.byType[0].kg * 100) : 0}%"></i></div>`).join('') || `<p class="muted">${T('Нет данных за неделю')}</p>`}
        <p class="small muted" style="margin:10px 0 0">Мимо полигона за месяц: <b>${fmt(s.month.diverted)}%</b>. Подсказки «🌱 Рекомендуется» в форме помогают поднять эту долю.</p></div>
    </div>
    <div class="card" id="tgCard"></div>`;
  telegramCard($('#tgCard'));
  S.charts.push(new Chart($('#cw'), { type: 'bar', data: { labels: s.week.byDay.map((d) => `${wd[new Date(d.date + 'T00:00:00').getDay()]} ${d.date.slice(8)}`),
    datasets: [{ data: s.week.byDay.map((d) => d.kg), backgroundColor: '#4a72c4', borderRadius: 8, maxBarThickness: 34 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#eceff5' } } } } }));
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
      <tbody>${d.anomalies.map((a) => `<tr><td>${a.monthLabel}</td><td>${esc(a.org)}</td><td>${esc(a.type)}</td><td class="num">${fmt(a.curPerDay)}</td><td class="num">${fmt(a.avgPerDay)}</td><td class="num up">+${a.changePct}%</td><td class="num">${fmt(a.extraKg, 0)} кг</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Отклонений не выявлено.</p>'}</div>
    <div class="card"><h3>Что выбрасывают: продукты</h3>${d.byProduct?.length ? `<p class="small muted" style="margin-top:-6px">По записям, где указан продукт (ввод фразой, по фото, в Telegram или в поле «Продукт»). Потери — по ценам справочника продуктов.</p>
      ${d.byProduct.map((p) => `<div class="bar-row"><span>${esc(p.name)}</span><b>${fmt(p.kg)} кг${p.kzt ? ` · ≈ ${fmt(p.kzt, 0)} ₸` : ''}</b><i style="width:${Math.max(4, p.kg / d.byProduct[0].kg * 100)}%"></i></div>`).join('')}`
      : '<p class="muted small">Пока нет записей с указанием продукта. Продукт определяется автоматически при вводе фразой («хлеб 3 кг»), по фото и в Telegram — данные появятся после проверки отчётов.</p>'}</div>`;
  loadConclusion($('#concl'), new URLSearchParams({ from: d.from, to: d.to, ...(r.q.org ? { org: r.q.org } : {}) }));
  $('#range').onchange = (e) => go('/dashboard?' + new URLSearchParams({ range: e.target.value, ...(r.q.org ? { org: r.q.org } : {}) }));
  if ($('#org')) $('#org').onchange = (e) => go('/dashboard?' + new URLSearchParams({ range, ...(e.target.value ? { org: e.target.value } : {}) }));

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.color = '#66728c';
  const labels = d.monthly.map((m) => m.label);
  S.charts.push(new Chart($('#c1'), { type: 'bar', data: { labels, datasets: d.orgs.map((o, i) => ({ label: o, data: d.monthly.map((m) => m.byOrg[o]), backgroundColor: ORG_COLORS[i % 7], borderRadius: 3 })) },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } } }));
  const top = d.byType.slice(0, 9); const rest = d.byType.slice(9).reduce((a, x) => a + x.kg, 0);
  const pie = rest ? [...top, { name: 'Прочее', kg: rest }] : top;
  S.charts.push(new Chart($('#c2'), { type: 'doughnut', data: { labels: pie.map((x) => x.name), datasets: [{ data: pie.map((x) => x.kg), backgroundColor: PIE_COLORS, borderWidth: 1 }] },
    options: { maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: innerWidth < 720 ? 'bottom' : 'right', labels: { boxWidth: 12, font: { size: 11 } } } } } }));
  const c3 = staff && !r.q.org ? d.byOrg : d.byMethod;
  S.charts.push(new Chart($('#c3'), { type: 'bar', data: { labels: c3.map((x) => x.name), datasets: [{ label: 'кг', data: c3.map((x) => x.kg), backgroundColor: c3.map((_, i) => ORG_COLORS[i % 7]), borderRadius: 4 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#eceff5' } }, y: { grid: { display: false } } } } }));
  S.charts.push(new Chart($('#c4'), { type: 'line', data: { labels, datasets: [
    { label: 'Пригодно к переработке', data: d.monthly.map((m) => m.kg ? m.recyclableShare : null), borderColor: '#3459a0', backgroundColor: 'rgba(52,89,160,.12)', fill: true, tension: .3 },
    { label: 'Фактически переработано', data: d.monthly.map((m) => m.kg ? m.recycledShare : null), borderColor: '#e0b100', tension: .3 }] },
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
    <div class="tabs">${[['settings', 'Настройки и справочники'], ['orgs', S.cfg.orgsLabel], ['users', 'Пользователи'], ['types', 'Виды отходов'], ['products', 'Продукты (датасет)'], ['methods', 'Способы утилизации'], ['scales', 'Весы (API)']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div><div id="tab"></div>`;
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
  if (tab === 'products') {
    const { kinds, products } = await api('/products?all=1');
    const kindSel = (v, attr) => `<select ${attr}>${Object.entries(kinds).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    el.innerHTML = `<div class="card"><h3>Справочник продуктов — датасет для распознавания</h3>
      <p class="small">По этому списку система узнаёт продукт во фразе («хлеб 3 кг», «картоп 12 кило»), на фото и в Telegram, сама подбирает вид отхода организации по роду продукта
        и считает потери в ₸ по цене за кг. Синонимы — через запятую, можно на русском и казахском.</p>
      <div class="row" style="align-items:flex-end;flex-wrap:wrap;gap:10px">
        <label class="btn btn-light btn-sm" style="margin:0;color:var(--ink)">⬆ Загрузить CSV / Excel<input type="file" id="pFile" accept=".csv,.xlsx,text/csv" hidden></label>
        <a class="btn btn-light btn-sm" href="/api/products.csv">⬇ Скачать датасет (CSV)</a>
        <span class="small muted">Столбцы: name; name_kz; synonyms; kind; price_kzt_kg. Существующие продукты обновляются по названию.</span></div>
      <div id="pRes" style="margin-top:10px"></div></div>
    <div class="card"><h3>Добавить продукт</h3><form id="f" class="row" style="flex-wrap:wrap">
      <div class="field"><label>Название</label><input name="name" required placeholder="напр. Манты"></div>
      <div class="field"><label>Қазақша</label><input name="name_kz" placeholder="Мәнті"></div>
      <div class="field" style="flex:2"><label>Синонимы</label><input name="synonyms" placeholder="манты, мант, мәнті"></div>
      <div class="field"><label>Род отхода</label>${kindSel('plate', 'name="kind"')}</div>
      <div class="field"><label>Цена, ₸/кг</label><input name="price_kzt_kg" inputmode="decimal" placeholder="0"></div><button>Добавить</button></form></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Продукт</th><th>Қазақша</th><th>Синонимы</th><th>Род</th><th class="num">₸/кг</th><th class="num">Записей</th><th>Активен</th></tr></thead>
      <tbody>${products.map((p) => `<tr data-p="${p.id}"><td><b>${esc(p.name)}</b></td><td><input data-f="name_kz" value="${esc(p.name_kz || '')}" style="min-width:110px"></td>
        <td><input data-f="synonyms" value="${esc(p.synonyms)}" style="min-width:220px"></td><td>${kindSel(p.kind, 'data-f="kind"')}</td>
        <td class="num"><input data-f="price_kzt_kg" value="${p.price_kzt_kg}" inputmode="decimal" style="width:80px;text-align:right"></td><td class="num">${p.used}</td>
        <td><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Цены ориентировочные (розница, Алматы) — уточните по закупочным ценам столовой.</p></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); try { await api('/products', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Продукт добавлен'); route(); } catch (err) { toast(err.message, true); } };
    $$('[data-p]').forEach((tr) => tr.querySelectorAll('[data-f]').forEach((inp) => inp.onchange = async () => {
      const body = {}; tr.querySelectorAll('[data-f]').forEach((x) => { body[x.dataset.f] = x.type === 'checkbox' ? x.checked : x.value; });
      try { await api('/products/' + tr.dataset.p, { method: 'PUT', body }); toast('Сохранено'); } catch (err) { toast(err.message, true); }
    }));
    $('#pFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const file = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); });
      $('#pRes').textContent = 'Загружаю…';
      try { const r = await api('/products/import', { method: 'POST', body: { file } }); $('#pRes').innerHTML = `<div class="alert alert-green" style="margin:0">Добавлено: ${r.added}, обновлено: ${r.updated}.</div>`; setTimeout(route, 1200); }
      catch (err) { $('#pRes').innerHTML = `<div class="alert alert-red" style="margin:0">${esc(err.message)}</div>`; }
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
