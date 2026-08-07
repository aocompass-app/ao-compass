/* ホームの日程まわりのテスト   使い方: node tests/home-dates.mjs
   確かめること
   1) 第一志望のカウントダウンが、出願締切を過ぎたあとも 試験日 → 合格発表 へ自動で切り替わる
   2) ホームに「ほかの志望校の直近の日程」が締切の近い順で出る（第一志望は重複して出さない） */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.resolve(HERE, '..', 'index.html');
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

/* 第一志望を1校だけ置いて、ホームのカウントダウン部分の文字を読む。
   d は各日程の「今日から何日後か」（null = 未入力） */
async function heroText(p, d) {
  return await p.evaluate(days => {
    const at = n => (n === null || n === undefined) ? '' : isoAdd(todayISO(), n);
    S.schools = [{ id: 'h1', name: '見本大学', faculty: '法学部', checklist: {}, tasks: [],
                   entryStart: at(days.entry), deadline: at(days.dl), examDate: at(days.exam), resultDate: at(days.result) }];
    S.documents = []; S.tasks = []; S.meta.primarySchoolId = 'h1';
    save(); go('home');
    const b = document.querySelector('#root .countdown');
    return b ? b.innerText.replace(/\s+/g, ' ').trim() : '(カウントダウンが無い)';
  }, d);
}

/* 1. 出願締切が来ていないときは、これまでどおり出願締切のカウントダウン */
{
  const p = await open();
  const t = await heroText(p, { entry: null, dl: 20, exam: 40, result: 55 });
  ok(/20/.test(t) && t.includes('出願締切'), `締切前は出願締切まで20日と出る (${t})`);
  ok(!t.includes('過ぎています'), '締切前に「過ぎています」は出ない');

  /* 2. 締切を過ぎたら試験日に切り替わる */
  const t2 = await heroText(p, { entry: null, dl: -5, exam: 10, result: 30 });
  ok(t2.includes('試験日') && /10/.test(t2), `締切後は試験日まで10日に切り替わる (${t2})`);
  ok(t2.includes('過ぎています'), '出願締切が過ぎたことも併せて伝える');

  /* 3. 試験も終わっていれば合格発表 */
  const t3 = await heroText(p, { entry: null, dl: -30, exam: -3, result: 12 });
  ok(t3.includes('合格発表') && /12/.test(t3), `試験後は合格発表まで12日になる (${t3})`);

  /* 4. 全部終わっていれば「終了」 */
  const t4 = await heroText(p, { entry: -60, dl: -40, exam: -20, result: -5 });
  ok(t4.includes('終了') && !t4.includes('締切未設定'), `全日程が終わったら終了と出る (${t4})`);

  /* 5. 日程が何も入っていなければ従来どおり「締切未設定」 */
  const t5 = await heroText(p, { entry: null, dl: null, exam: null, result: null });
  ok(t5.includes('締切未設定'), `日程が空なら締切未設定のまま (${t5})`);

  /* 6. 締切が空でもエントリー開始が入っていれば、それを出す */
  const t6 = await heroText(p, { entry: 7, dl: null, exam: null, result: null });
  ok(t6.includes('エントリー開始') && /7/.test(t6), `締切未入力ならエントリー開始を出す (${t6})`);

  /* 7. 今日が試験日なら「あと0日」相当で残る（終了扱いにしない） */
  const t7 = await heroText(p, { entry: null, dl: -10, exam: 0, result: 20 });
  ok(t7.includes('試験日') && !t7.includes('終了'), `当日の日程は終了にしない (${t7})`);
  await p.context().close();
}

/* 8. 併願校の直近日程カード */
{
  const p = await open();
  const r = await p.evaluate(() => {
    const at = n => isoAdd(todayISO(), n);
    S.schools = [
      { id: 'a', name: '第一志望大学', priority: 1, checklist: {}, deadline: at(50), examDate: at(70) },
      { id: 'b', name: 'あとから締切大学', priority: 3, checklist: {}, deadline: at(30) },
      { id: 'c', name: 'すぐ締切大学', priority: 2, checklist: {}, deadline: at(4) },
      { id: 'd', name: '発表待ち大学', checklist: {}, deadline: at(-20), resultDate: at(15) },
      { id: 'e', name: '日程未入力大学', checklist: {} },
      { id: 'f', name: '全部終わった大学', checklist: {}, deadline: at(-90), resultDate: at(-60) },
      { id: 'g', name: 'まだ先の大学', checklist: {}, deadline: at(60) }
    ];
    S.documents = []; S.tasks = []; S.meta.primarySchoolId = 'a';
    save(); go('home');
    const card = document.querySelector('#root [data-home-deadlines]');
    return {
      has: !!card,
      order: card ? [...card.querySelectorAll('.list-row[data-dsid]')].map(x => x.getAttribute('data-dsid')).join(',') : '',
      text: card ? card.innerText.replace(/\s+/g, ' ') : ''
    };
  });
  ok(r.has, '併願校がいると「ほかの志望校の直近の日程」カードが出る');
  ok(r.order === 'c,d,b', `近い順に3件まで並ぶ (${r.order})`);
  ok(!r.text.includes('第一志望大学'), '第一志望はここに重ねて出さない');
  ok(!r.text.includes('日程未入力大学') && !r.text.includes('全部終わった大学'), '日程が無い／全部終わった学校は出さない');
  ok(r.text.includes('あと4日'), `残り日数が出る (${r.text.slice(0, 60)})`);
  ok(r.text.includes('合格発表'), '締切が過ぎた学校は合格発表として出る');
  ok(r.text.includes('ほか1校'), `3件を超えた分は件数で伝える (${r.text.includes('ほか1校')})`);

  /* 9. 「見る」ボタンで志望校の詳細が開く */
  await p.evaluate(() => { document.querySelector('#root [data-home-deadlines] .list-row[data-dsid="c"] button').click(); });
  await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => document.body.innerText.includes('出願チェックリスト'));
  ok(sheet, '「見る」で志望校の詳細シートが開く');
  await p.context().close();
}

/* 10. 志望校が第一志望1校だけならカードは出さない（画面を増やさない） */
{
  const p = await open();
  const none = await p.evaluate(() => {
    S.schools = [{ id: 'a', name: '一校だけ大学', checklist: {}, deadline: isoAdd(todayISO(), 10) }];
    S.documents = []; S.tasks = []; S.meta.primarySchoolId = 'a';
    save(); go('home');
    return !document.querySelector('#root [data-home-deadlines]');
  });
  ok(none, '1校だけのときは併願カードを出さない');
  await p.context().close();
}

/* 11. 日程の項目が無い古いデータでもホームが開く */
{
  const p = await open();
  const okOld = await p.evaluate(() => {
    const old = { schools: [{ id: 'o1', name: '旧データ大学' }, { id: 'o2', name: '旧データ短大' }],
                  documents: [{ id: 'x', title: '旧書類', body: 'あ' }], tasks: [] };
    S = migrate(old); save();
    try { go('home'); return document.querySelector('#root').innerText.length > 20; } catch (e) { return String(e); }
  });
  ok(okOld === true, `日程の項目が無い古いデータでもホームが開く (${okOld})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
