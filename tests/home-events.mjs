/* ホームの「日程の印」と、その印をタップした先のテスト   使い方: node tests/home-events.mjs
   この回（2026.08.19-4）で変えた挙動そのものを確かめる。
   確かめること
   1) 日程の印は SCHOOL_EVENTS 1か所で決まっている（画面ごとに絵文字が食い違わない）
   2) schoolEventsOn(iso) が「大事な順」で返す／無い日は空／志望校0校でも落ちない
   3) 7日ストリップの印をタップすると、その日のプランに「何の日か」が出る
      （今までは出願締切だけ。試験日・合格発表・エントリー開始は無印で、開いても何も書いていなかった）
   4) 併願カードの「ほかN校」と志望順位の帯
   5) 「作成中の書類」「次の面接練習」の「ほかN件／N問」
   6) 全日程が終わった第一志望でカウントダウンが「終了」になり、締切未設定と混ざらない
   7) 390px で横スクロールしない・古いデータで壊れない */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'index.html');
const FILE = 'file://' + SRC;
const EXE = process.env.PW_CHROMIUM || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const errors = [];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.addInitScript('window.__AO_NO_ONBOARD=1;');
  await p.goto(FILE);
  await p.waitForTimeout(400);
  return p;
}

/* ホームを、指定した志望校・書類・面接質問で描き直す。
   ダミーのタスクを1件置くのは、プランもタスクも無いと7日ストリップが出ないため。 */
async function home(p, a) {
  await p.evaluate(o => {
    const at = n => (n === null || n === undefined) ? '' : isoAdd(todayISO(), n);
    S.schools = (o.schools || []).map(x => {
      const s = { id: x.id, name: x.name, checklist: {} };
      if (x.priority !== undefined) s.priority = x.priority;
      if (x.entry != null) s.entryStart = at(x.entry);
      if (x.dl != null) s.deadline = at(x.dl);
      if (x.exam != null) s.examDate = at(x.exam);
      if (x.result != null) s.resultDate = at(x.result);
      return s;
    });
    S.documents = o.documents || [];
    S.interview = o.interview || [];
    S.tasks = [{ id: 't_dummy', title: 'ダミーの予定', due: todayISO(), done: false, auto: true }];
    S.meta.primarySchoolId = o.pid === undefined ? (S.schools[0] ? S.schools[0].id : null) : o.pid;
    save(); go('home');
  }, a);
  await p.waitForTimeout(120);
}

/* --- 1. 印は SCHOOL_EVENTS 1か所で決まっている --- */
{
  const p = await open();
  const r = await p.evaluate(() => ({
    defined: typeof SCHOOL_EVENTS !== 'undefined' && Array.isArray(SCHOOL_EVENTS),
    order: SCHOOL_EVENTS.map(e => e.key).join(','),
    pins: SCHOOL_EVENTS.map(e => e.pin).join(''),
    uniqPins: new Set(SCHOOL_EVENTS.map(e => e.pin)).size,
    uniqLabels: new Set(SCHOOL_EVENTS.map(e => e.label)).size,
    /* 志望校シートの表の見出しと同じ言葉を使っているか（言い換えを増やさない） */
    sameAsKeys: SCHOOL_DATE_KEYS.every(kv => SCHOOL_EVENTS.some(e => e.key === kv[0] && e.label === kv[1]))
  }));
  ok(r.defined, '日程の種類が SCHOOL_EVENTS にまとめてある');
  ok(r.order === 'deadline,examDate,entryStart,resultDate', `並びは大事な順 (${r.order})`);
  ok(r.uniqPins === 4 && r.uniqLabels === 4, `4種類の印が重なっていない (${r.pins})`);
  ok(r.sameAsKeys, '志望校シートの日程の呼び方と同じ言葉になっている');

  /* --- 2. schoolEventsOn --- */
  const ev = await p.evaluate(() => {
    const at = n => isoAdd(todayISO(), n);
    S.schools = [
      { id: 'a', name: 'A大学', checklist: {}, deadline: at(3), resultDate: at(3) },
      { id: 'b', name: 'B大学', checklist: {}, examDate: at(3), entryStart: at(9) }
    ];
    save();
    const day3 = schoolEventsOn(at(3));
    return {
      labels: day3.map(e => e.label).join(','),
      schools: day3.map(e => e.school.name).join(','),
      pins: day3.map(e => e.pin).join(''),
      empty: schoolEventsOn(at(1)).length,
      noArg: schoolEventsOn('').length,
      farStillFound: schoolEventsOn(at(9)).map(e => e.label).join(',')
    };
  });
  ok(ev.labels === '出願締切,試験日,合格発表', `同じ日の日程が大事な順で返る (${ev.labels})`);
  ok(ev.schools === 'A大学,B大学,A大学', `どの大学の日程かも一緒に返る (${ev.schools})`);
  ok(ev.pins === '📮📝🎉', `印も順番どおり (${ev.pins})`);
  ok(ev.empty === 0, '何も無い日は空で返る');
  ok(ev.noArg === 0, '日付が空でも落ちない');
  ok(ev.farStillFound === 'エントリー開始', `7日より先の日でも呼べば返る (${ev.farStillFound})`);

  const zero = await p.evaluate(() => { S.schools = []; save(); return schoolEventsOn(todayISO()).length; });
  ok(zero === 0, '志望校0校でも落ちない');
  await p.context().close();
}

/* --- 3. ストリップの印をタップ → その日のプランに「何の日か」が出る --- */
{
  const p = await open();
  await home(p, { schools: [{ id: 's1', name: '見本大学', entry: 1, dl: 2, exam: 3, result: 4 }] });

  /* 3日後＝試験日のマスを押す */
  await p.evaluate(() => { document.querySelectorAll('#root .day-cell')[3].click(); });
  await p.waitForTimeout(350);
  const t3 = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/見本大学 の試験日です/.test(t3), `試験日のマスから「何の日か」が読める (${(t3.match(/.{0,6}試験日です/) || [''])[0]})`);
  ok(t3.indexOf('📝') >= 0, 'ストリップと同じ印が出ている');
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);

  /* 4日後＝合格発表 */
  await p.evaluate(() => { document.querySelectorAll('#root .day-cell')[4].click(); });
  await p.waitForTimeout(350);
  ok(await p.evaluate(() => /見本大学 の合格発表です/.test(document.body.innerText.replace(/\s+/g, ' '))), '合格発表の日も何の日か出る');
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);

  /* 1日後＝エントリー開始 */
  await p.evaluate(() => { document.querySelectorAll('#root .day-cell')[1].click(); });
  await p.waitForTimeout(350);
  ok(await p.evaluate(() => /見本大学 のエントリー開始です/.test(document.body.innerText.replace(/\s+/g, ' '))), 'エントリー開始の日も何の日か出る');
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);

  /* 2日後＝出願締切（今までどおりの文章のまま） */
  await p.evaluate(() => { document.querySelectorAll('#root .day-cell')[2].click(); });
  await p.waitForTimeout(350);
  const t2 = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/📮 見本大学 の出願締切です/.test(t2), `出願締切は今までどおり (${(t2.match(/.{0,10}出願締切です/) || [''])[0]})`);
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);

  /* 6日後＝何も無い日。ありもしない予定を作らない */
  await p.evaluate(() => { document.querySelectorAll('#root .day-cell')[6].click(); });
  await p.waitForTimeout(350);
  const t6 = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(t6.includes('この日に予定はありません'), `日程が無い日は今までどおり (${t6.includes('この日に予定はありません')})`);
  ok(!/の試験日です|の出願締切です|の合格発表です/.test(t6), 'ありもしない日程を出さない');
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);

  /* 別々の大学の日程が同じ日に重なったら、両方を並べる */
  await home(p, { schools: [{ id: 'a', name: 'あ大学', dl: 2 }, { id: 'い', name: 'い大学', exam: 2 }] });
  await p.evaluate(() => { document.querySelectorAll('#root .day-cell')[2].click(); });
  await p.waitForTimeout(350);
  const both = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/あ大学 の出願締切です/.test(both) && /い大学 の試験日です/.test(both), `重なった日は両方の大学を並べる (${both.includes('い大学')})`);
  await p.context().close();
}

/* --- 4. 併願カードの「ほかN校」と志望順位の帯 --- */
{
  const p = await open();
  await home(p, {
    pid: 'p',
    schools: [
      { id: 'p', name: '第一志望大学', priority: 1, dl: 40 },
      { id: 'x', name: 'すぐの大学', priority: 2, dl: 3 },
      { id: 'y', name: 'つぎの大学', priority: 4, dl: 10 },
      { id: 'z', name: 'そのつぎ大学', dl: 20 },
      { id: 'w', name: 'あまり大学', dl: 33 },
      { id: 'v', name: 'あまり大学2', dl: 34 }
    ]
  });
  const r = await p.evaluate(() => {
    const c = document.querySelector('#root [data-home-deadlines]');
    return {
      text: c ? c.innerText.replace(/\s+/g, ' ') : '(カードが無い)',
      rows: c ? [...c.querySelectorAll('.list-row[data-dsid]')].length : 0,
      order: c ? [...c.querySelectorAll('.list-row[data-dsid]')].map(x => x.getAttribute('data-dsid')).join(',') : '',
      pri: c ? !!c.querySelector('.list-row[data-dsid="x"] .pill-priority') : false
    };
  });
  ok(r.rows === 3, `行は3件まで (${r.rows})`);
  ok(r.order === 'x,y,z', `近い順に並ぶ (${r.order})`);
  ok(/5校/.test(r.text), `見出しの件数は第一志望をのぞいた数 (${r.text.slice(0, 30)})`);
  ok(/ほか2校/.test(r.text), `枠に入らなかった分は件数で伝える (${/ほか2校/.test(r.text)})`);
  ok(r.pri, '志望順位の帯が出る（第何志望かが分かる）');
  ok(!/第一志望大学/.test(r.text), '第一志望はここに重ねて出さない');

  /* 全日程が終わった学校しか残っていなければ、カードは出さない */
  await home(p, { pid: 'p', schools: [{ id: 'p', name: '第一志望大学', dl: 10 }, { id: 'q', name: '終わった大学', dl: -90, result: -60 }] });
  ok(await p.evaluate(() => !document.querySelector('#root [data-home-deadlines]')), '出す日程が無ければカードごと出さない');
  await p.context().close();
}

/* --- 5. 「作成中の書類」「次の面接練習」の残り件数 --- */
{
  const p = await open();
  await home(p, {
    pid: 's1',
    schools: [{ id: 's1', name: '見本大学', dl: 12 }],
    documents: [1, 2, 3, 4, 5].map(n => ({ id: 'd' + n, schoolId: 's1', title: '下書き' + n, body: 'あ', status: '下書き', charLimit: 0 })),
    interview: [1, 2, 3, 4].map(n => ({ id: 'q' + n, question: '質問' + n, answer: '', weak: false }))
  });
  const r = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#root .card')];
    const d = cards.find(c => /作成中の書類/.test(c.innerText));
    const i = cards.find(c => /次の面接練習/.test(c.innerText));
    return {
      dRows: d ? d.querySelectorAll('.list-row[data-hdoc]').length : 0,
      dText: d ? d.innerText.replace(/\s+/g, ' ') : '',
      iText: i ? i.innerText.replace(/\s+/g, ' ') : ''
    };
  });
  ok(r.dRows === 3, `書類は3件まで (${r.dRows})`);
  ok(/ほか2件/.test(r.dText), `残りの書類は件数で伝える (${r.dText.slice(0, 60)})`);
  ok(/ほか1問/.test(r.iText), `残りの質問は件数で伝える (${r.iText.slice(0, 60)})`);

  /* ちょうど3件以下なら「ほか」は出さない（うその件数を出さない） */
  await home(p, {
    pid: 's1',
    schools: [{ id: 's1', name: '見本大学', dl: 12 }],
    documents: [{ id: 'd1', schoolId: 's1', title: 'ひとつだけ', body: 'あ', status: '下書き', charLimit: 0 }],
    interview: [{ id: 'q1', question: 'ひとつだけ質問', answer: '', weak: false }]
  });
  const r2 = await p.evaluate(() => document.querySelector('#root').innerText);
  ok(!/ほか0件|ほか0問/.test(r2), '3件以下のときに「ほか0件」を出さない');
  await p.context().close();
}

/* --- 6. 全日程が終わった第一志望のカウントダウン --- */
{
  const p = await open();
  await home(p, { pid: 'e', schools: [{ id: 'e', name: '終わった大学', entry: -80, dl: -60, exam: -30, result: -7 }] });
  const t = await p.evaluate(() => {
    const b = document.querySelector('#root .countdown');
    return { text: b ? b.innerText.replace(/\s+/g, ' ') : '(無い)', cls: b ? b.className : '' };
  });
  ok(/終了/.test(t.text), `全日程が終わったら「終了」 (${t.text})`);
  ok(!/締切未設定|—/.test(t.text), '日程を入れていない人の表示と混ざらない');
  ok(!/urgent|soon/.test(t.cls), '終わったものを赤く急がせない');

  /* 日程を1つも入れていない人は、今までどおり「締切未設定」 */
  await home(p, { pid: 'n', schools: [{ id: 'n', name: '日程未入力大学' }] });
  const t2 = await p.evaluate(() => document.querySelector('#root .countdown').innerText.replace(/\s+/g, ' '));
  ok(/締切未設定/.test(t2) && !/終了/.test(t2), `日程が空なら締切未設定のまま (${t2})`);
  await p.context().close();
}

/* --- 7. 390px で横スクロールしない・古いデータで壊れない --- */
{
  const p = await open();
  await home(p, {
    pid: 'a',
    schools: [
      { id: 'a', name: 'とても長い名前の国際教養情報大学', priority: 1, dl: -3, exam: 5, result: 30 },
      { id: 'b', name: 'これも長い名前の総合政策学園大学', priority: 2, dl: 6 },
      { id: 'c', name: 'さんばんめのながいなまえの大学', priority: 3, dl: 9 },
      { id: 'd', name: 'よんばんめのながいなまえの大学', priority: 4, dl: 15 }
    ],
    documents: [{ id: 'd1', schoolId: 'a', title: 'とても長いタイトルの志望理由書です', body: 'あ'.repeat(50), status: '下書き', charLimit: 800 }],
    interview: [{ id: 'q1', question: 'とても長い面接の質問文をここに入れておきます', answer: '', weak: true }]
  });
  const w = await p.evaluate(() => {
    const r = document.querySelector('#root');
    return { sw: r.scrollWidth, cw: r.clientWidth, body: document.body.scrollWidth };
  });
  ok(w.sw <= w.cw + 1, `390px で横スクロールしない (${w.sw}/${w.cw})`);
  ok(w.body <= 391, `body もはみ出さない (${w.body})`);

  /* 締切が過ぎた第一志望でも、ちゃんと試験日に切り替わっている */
  const cd = await p.evaluate(() => document.querySelector('#root .countdown').innerText.replace(/\s+/g, ' '));
  ok(/試験日/.test(cd) && /5/.test(cd), `締切後は試験日のカウントダウン (${cd})`);

  const okOld = await p.evaluate(() => {
    const old = {
      schools: [{ id: 'o1', name: '旧データ大学' }, { id: 'o2', name: '旧データ短大' }],
      documents: [{ id: 'x', title: '旧書類', body: 'あ' }],
      tasks: [{ id: 'ot', title: '旧タスク', due: todayISO() }]
    };
    S = migrate(old); save();
    try {
      const views = ['home', 'schools', 'documents', 'interview', 'tasks', 'self', 'portfolio', 'settings'];
      for (const v of views) { go(v); if (document.querySelector('#root').innerText.length < 10) return 'から:' + v; }
      go('home');
      const cells = [...document.querySelectorAll('#root .day-cell')];
      return cells.every(c => !c.getAttribute('data-dayev')) && !document.querySelector('#root [data-home-deadlines]');
    } catch (e) { return String(e); }
  });
  ok(okOld === true, `日程の項目が無い古いデータで全画面が開く (${okOld})`);

  /* 古いデータでその日のプランを開いても、日程の案内は出ない */
  await p.evaluate(() => openDaySheet(todayISO()));
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !/の出願締切です|の試験日です/.test(document.body.innerText)), '古いデータでは日程の案内を出さない');
  await p.context().close();
}

/* --- 8. 古いiOS Safari で落ちる書き方を増やしていない --- */
{
  const src = fs.readFileSync(SRC, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/\(\?<[=!]/.test(code), '後読み正規表現を使っていない');
  ok(!/\{\s*\.\.\./.test(code), 'オブジェクトスプレッドを使っていない');
  ok(/const APP_VER='2026\.08\.19-4'/.test(src), 'APP_VER が今回の版になっている');
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
