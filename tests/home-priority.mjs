/* ホームの「並び順」まわりのテスト   使い方: node tests/home-priority.mjs
   確かめること
   1) 「作成中の書類」が、締切が近い大学のものから並ぶ（登録順ではない）
   2) 志望校が未設定の書類は最後、締切バッジは付けない（ありもしない期限を作らない）
   3) 「次の面接練習」で苦手が先に来る（苦手が4番目以降でもホームに出る）
   4) 「今日のひとこと」が、出願締切を過ぎたあとも試験日・合格発表に切り替わる */
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

/* --- 1〜2. 作成中の書類の並び順 --- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    const at = n => isoAdd(todayISO(), n);
    S.schools = [
      { id: 'far',  name: 'まだ先の大学', checklist: {}, deadline: at(60) },
      { id: 'soon', name: 'すぐ締切の大学', checklist: {}, deadline: at(5) },
      { id: 'mid',  name: '中くらいの大学', checklist: {}, deadline: at(25) },
      { id: 'ex',   name: '出願済みの大学', checklist: {}, deadline: at(-10), examDate: at(2) }
    ];
    /* わざと「締切が遠い大学の書類」から登録する。登録順のままなら far が先頭に残る */
    S.documents = [
      { id: 'd_far',  schoolId: 'far',  title: '先の志望理由書', body: 'あ'.repeat(10), status: '下書き', charLimit: 800 },
      { id: 'd_mid',  schoolId: 'mid',  title: '中くらい自己PR', body: 'い'.repeat(10), status: '修正中', charLimit: 0 },
      { id: 'd_none', schoolId: null,   title: '志望校未定メモ', body: 'う'.repeat(10), status: '下書き', charLimit: 0 },
      { id: 'd_soon', schoolId: 'soon', title: 'すぐ出す活動報告書', body: 'え'.repeat(10), status: '下書き', charLimit: 0 },
      { id: 'd_ex',   schoolId: 'ex',   title: '面接プレゼン資料', body: 'お'.repeat(10), status: '下書き', charLimit: 0 },
      { id: 'd_done', schoolId: 'soon', title: '完成した書類', body: 'か'.repeat(10), status: '完成', charLimit: 0 }
    ];
    S.tasks = []; S.meta.primarySchoolId = 'far';
    save(); go('home');
    const rows = [...document.querySelectorAll('#root .list-row[data-hdoc]')];
    const card = rows.length ? rows[0].closest('.card') : null;
    return {
      order: rows.map(x => x.getAttribute('data-hdoc')).join(','),
      text: card ? card.innerText.replace(/\s+/g, ' ') : '',
      noneBadge: (() => {
        const rr = rows.find(x => x.getAttribute('data-hdoc') === 'd_none');
        return rr ? /あと\d+日|今日/.test(rr.innerText) : null;
      })(),
      soonRow: (() => {
        const rr = rows.find(x => x.getAttribute('data-hdoc') === 'd_soon');
        return rr ? rr.innerText.replace(/\s+/g, ' ') : '';
      })()
    };
  });
  ok(r.order === 'd_ex,d_soon,d_mid', `締切が近い順に3件並ぶ (${r.order})`);
  ok(!r.text.includes('完成した書類'), '完成した書類はここに出さない');
  ok(/ほか2件/.test(r.text), `3件を超えた分は件数で伝える (${/ほか2件/.test(r.text)})`);
  ok(/出願締切 あと5日/.test(r.soonRow), `締切までの残り日数がその書類の行に出る (${r.soonRow})`);
  ok(/試験日 あと2日/.test(r.text), '出願が済んだ大学の書類は次の日程（試験日）で並ぶ');
  ok(r.noneBadge === null, '志望校未設定の書類は3件の外（締切が分からないので後回し）');
  await p.context().close();
}

/* --- 2b. 志望校未設定の書類しか無いときは、締切バッジを付けない --- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S.schools = []; S.tasks = [];
    S.documents = [{ id: 'x1', schoolId: null, title: 'ひとりごとメモ', body: 'あ', status: '下書き', charLimit: 0 }];
    S.meta.primarySchoolId = null;
    save(); go('home');
    const rr = document.querySelector('#root .list-row[data-hdoc="x1"]');
    return rr ? rr.innerText.replace(/\s+/g, ' ') : '(行が無い)';
  });
  ok(r.includes('ひとりごとメモ'), `志望校が無くても書類は出る (${r})`);
  ok(!/あと\d+日|出願締切|試験日/.test(r), 'ありもしない締切バッジを作らない');
  await p.context().close();
}

/* --- 3. 面接練習は苦手が先 --- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    /* ホームの通常表示に入るため志望校を1校置く（0校＋書類0件だと「ようこそ」画面になる） */
    S.schools = [{ id: 'i1', name: '面接テスト大学', checklist: {} }];
    S.documents = []; S.tasks = []; S.meta.primarySchoolId = 'i1';
    /* 未回答を3問先に置く。登録順のままだと苦手2問はホームに出てこない */
    S.interview = [
      { id: 'q1', question: '未回答その1', answer: '', weak: false },
      { id: 'q2', question: '未回答その2', answer: '', weak: false },
      { id: 'q3', question: '未回答その3', answer: '', weak: false },
      { id: 'q4', question: '苦手な質問A', answer: 'ある程度書いた', weak: true },
      { id: 'q5', question: '苦手な質問B', answer: 'ある程度書いた', weak: true },
      { id: 'q6', question: '答え済みで苦手でない', answer: 'できている', weak: false }
    ];
    save(); go('home');
    const card = [...document.querySelectorAll('#root .card')].find(c => /次の面接練習/.test(c.innerText));
    const t = card ? card.innerText.replace(/\s+/g, ' ') : '(カードが無い)';
    return { text: t, aIdx: t.indexOf('苦手な質問A'), uIdx: t.indexOf('未回答その1') };
  });
  ok(r.text.includes('苦手な質問A') && r.text.includes('苦手な質問B'), `苦手が4番目以降でもホームに出る (${r.text.slice(0, 70)})`);
  ok(r.aIdx > -1 && r.uIdx > -1 && r.aIdx < r.uIdx, '苦手が未回答より先に並ぶ');
  ok(!r.text.includes('答え済みで苦手でない'), '答えてあって苦手でない質問は出さない');
  ok(/ほか2問/.test(r.text), `3問を超えた分は件数で伝える (${/ほか2問/.test(r.text)})`);
  await p.context().close();
}

/* --- 4. 今日のひとこと --- */
async function adviceText(p, d) {
  return await p.evaluate(days => {
    const at = n => (n === null || n === undefined) ? '' : isoAdd(todayISO(), n);
    S.schools = [{ id: 'h1', name: '見本大学', faculty: '法学部', checklist: {}, tasks: [],
                   entryStart: at(days.entry), deadline: at(days.dl), examDate: at(days.exam), resultDate: at(days.result) }];
    S.documents = []; S.tasks = []; S.interview = []; S.meta.primarySchoolId = 'h1';
    save(); go('home');
    const n = [...document.querySelectorAll('#root .ai-note')].find(x => /今日のひとこと/.test(x.innerText));
    return n ? n.innerText.replace(/\s+/g, ' ').trim() : '(ひとことが無い)';
  }, d);
}
{
  const p = await open();
  const t1 = await adviceText(p, { entry: null, dl: 20, exam: 40, result: 55 });
  ok(/出願締切まで\s*あと20日/.test(t1), `締切前はこれまでどおり出願までの日数 (${t1.slice(0, 40)})`);

  const t2 = await adviceText(p, { entry: null, dl: -5, exam: 7, result: 30 });
  ok(/試験日まで\s*あと7日/.test(t2), `締切後は試験日までの日数に切り替わる (${t2.slice(0, 40)})`);
  ok(!/経験の棚卸し/.test(t2), '試験が近いのに「経験の棚卸しから」に戻らない');

  const t3 = await adviceText(p, { entry: null, dl: -40, exam: -3, result: 10 });
  ok(/合格発表まで\s*あと10日/.test(t3), `試験後は合格発表までの日数になる (${t3.slice(0, 40)})`);
  ok(!/合格(する|できる|間違い)/.test(t3), '合否を保証する言い方はしない');

  const t4 = await adviceText(p, { entry: 6, dl: 40, exam: null, result: null });
  ok(/エントリー開始まで\s*あと6日/.test(t4), `エントリー開始が先ならそれを伝える (${t4.slice(0, 40)})`);

  const t5 = await adviceText(p, { entry: null, dl: null, exam: null, result: null });
  ok(/経験の棚卸し/.test(t5), `日程が空なら従来どおりの案内 (${t5.slice(0, 30)})`);

  const t6 = await adviceText(p, { entry: -90, dl: -60, exam: -40, result: -20 });
  ok(t6.length > 5 && !/残り/.test(t6), `全日程が終わっていても文が壊れない (${t6.slice(0, 40)})`);

  const t7 = await adviceText(p, { entry: null, dl: 0, exam: 20, result: 40 });
  ok(/出願締切は\s*今日です/.test(t7) && !/あと0日/.test(t7), `締切当日は「今日です」と出す (${t7.slice(0, 30)})`);
  ok(t1.includes('AIは合否を判断しません'), '免責の一文は残っている');
  await p.context().close();
}

/* --- 5. 古い形のデータでもホームが開く --- */
{
  const p = await open();
  const okOld = await p.evaluate(() => {
    const old = { schools: [{ id: 'o1', name: '旧データ大学' }],
                  documents: [{ id: 'x', title: '旧書類', body: 'あ' }], tasks: [] };
    S = migrate(old); save();
    try { go('home'); return document.querySelector('#root').innerText.length > 20; } catch (e) { return String(e); }
  });
  ok(okOld === true, `status や weak が無い古いデータでもホームが開く (${okOld})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
