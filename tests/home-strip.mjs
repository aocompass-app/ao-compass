/* ホームの7日間ストリップの「日程の印」テスト   使い方: node tests/home-strip.mjs
   確かめること
   1) 出願締切だけでなく、試験日・合格発表・エントリー開始の日にも印が付く
   2) 同じ日に複数あるときは大事な順（出願締切→試験日→エントリー開始→合格発表）の印になる
   3) 何も無い日には印を付けない（ありもしない予定を作らない）
   4) 長押し／ホバーで出る説明に、どの大学の何の日かが入る */
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

/* 7日ストリップは「今日やること」カードの中にある。
   プランもタスクも無いと逆算プランの案内だけになるので、ダミーのタスクを1件置いて出す。 */
async function strip(p, schools) {
  return await p.evaluate(list => {
    const at = n => isoAdd(todayISO(), n);
    S.schools = list.map(x => {
      const s = { id: x.id, name: x.name, checklist: {} };
      if (x.entry != null) s.entryStart = at(x.entry);
      if (x.dl != null) s.deadline = at(x.dl);
      if (x.exam != null) s.examDate = at(x.exam);
      if (x.result != null) s.resultDate = at(x.result);
      return s;
    });
    S.documents = []; S.interview = [];
    S.tasks = [{ id: 't1', title: 'ダミーの予定', due: todayISO(), done: false, auto: true }];
    S.meta.primarySchoolId = list.length ? list[0].id : null;
    save(); go('home');
    const cells = [...document.querySelectorAll('#root .day-cell')];
    return cells.map(c => ({
      ev: c.getAttribute('data-dayev') || '',
      pin: (c.querySelector('.pin') || {}).textContent || '',
      dl: c.classList.contains('dl'),
      title: c.title || ''
    }));
  }, schools);
}

/* --- 1. 4種類の日程それぞれに印が付く --- */
{
  const p = await open();
  const c = await strip(p, [{ id: 's1', name: '見本大学', entry: 1, dl: 2, exam: 3, result: 4 }]);
  ok(c.length === 7, `7日ぶんのマスが出る (${c.length})`);
  /* 印はカレンダー（SCHOOL_EVENTS の凡例）とそろえる。
     ここだけ別の絵文字にすると、同じ ✏️ がカレンダーでは「エントリー開始」、
     ホームでは「試験日」になってしまい、かえって読み違える。 */
  ok(c[1].ev === 'エントリー開始' && c[1].pin === '✏️', `エントリー開始の日に印が付く (${c[1].pin}${c[1].ev})`);
  ok(c[2].ev === '出願締切' && c[2].pin === '📮', `出願締切の日に印が付く (${c[2].pin}${c[2].ev})`);
  ok(c[3].ev === '試験日' && c[3].pin === '📝', `試験日の日に印が付く（今までは無印だった） (${c[3].pin}${c[3].ev})`);
  ok(c[4].ev === '合格発表' && c[4].pin === '🎉', `合格発表の日に印が付く（今までは無印だった） (${c[4].pin}${c[4].ev})`);
  ok(c[1].dl && c[3].dl && c[4].dl, '日程のある日は枠の色も変わる');
  ok(c[0].ev === '' && c[5].ev === '' && c[6].ev === '', '日程が無い日には印を付けない');
  ok(/見本大学/.test(c[3].title) && /試験日/.test(c[3].title), `説明にどの大学の何の日かが入る (${c[3].title})`);
  await p.context().close();
}

/* --- 2. 重なった日は大事な順。別の大学どうしでも拾う --- */
{
  const p = await open();
  const c = await strip(p, [
    { id: 'a', name: 'A大学', dl: 3 },
    { id: 'b', name: 'B大学', exam: 3 },
    { id: 'c', name: 'C大学', result: 5, exam: 5 }
  ]);
  ok(c[3].pin === '📮', `同じ日に締切と試験が重なったら締切の印 (${c[3].pin})`);
  ok(c[3].ev === '出願締切,試験日', `重なった日程は両方おぼえている (${c[3].ev})`);
  ok(/A大学/.test(c[3].title) && /B大学/.test(c[3].title), `別々の大学の日程が同じ日に出る (${c[3].title.replace(/\n/g, ' / ')})`);
  ok(c[5].pin === '📝' && c[5].ev === '試験日,合格発表', `1校の中で重なっても大事な順 (${c[5].pin}${c[5].ev})`);
  await p.context().close();
}

/* --- 3. 8日以降の日程はストリップに出ない（7日ぶんしか無いので） --- */
{
  const p = await open();
  const c = await strip(p, [{ id: 's1', name: '先の大学', dl: 20 }]);
  ok(c.every(x => x.ev === ''), '7日より先の日程はストリップに出ない');
  await p.context().close();
}

/* --- 4. タスクの件数表示は今までどおり残る --- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S.schools = [{ id: 's1', name: 'タスク大学', checklist: {}, deadline: isoAdd(todayISO(), 2) }];
    S.documents = []; S.interview = [];
    S.tasks = [
      { id: 't1', title: '今日の予定', due: todayISO(), done: false, auto: true },
      { id: 't2', title: '明日の予定その1', due: isoAdd(todayISO(), 1), done: false, auto: true },
      { id: 't3', title: '明日の予定その2', due: isoAdd(todayISO(), 1), done: false, auto: true }
    ];
    S.meta.primarySchoolId = 's1';
    save(); go('home');
    const cells = [...document.querySelectorAll('#root .day-cell')];
    return { cnt1: (cells[1].querySelector('.cnt') || {}).textContent || '',
             title1: cells[1].title,
             pin2: (cells[2].querySelector('.pin') || {}).textContent || '' };
  });
  /* 保存時に必要書類のタスクが足されることがあるので、件数はちょうど2とは限らない。
     「印ではなく件数が出ていて、置いた2件がちゃんと数に入っている」ことだけを見る。 */
  ok(/^\d+$/.test(r.cnt1) && +r.cnt1 >= 2, `日程が無い日は今までどおり未完了の件数が出る (${r.cnt1})`);
  ok(/明日の予定その1/.test(r.title1), 'タスク名の説明も残っている');
  ok(r.pin2 === '📮', `締切の日は今までどおり📮 (${r.pin2})`);
  await p.context().close();
}

/* --- 5. 日程の項目が無い古いデータでも壊れない --- */
{
  const p = await open();
  const okOld = await p.evaluate(() => {
    const old = { schools: [{ id: 'o1', name: '旧データ大学' }],
                  documents: [{ id: 'x', title: '旧書類', body: 'あ' }],
                  tasks: [{ id: 'ot', title: '旧タスク', due: todayISO() }] };
    S = migrate(old); save();
    try {
      go('home');
      const cells = [...document.querySelectorAll('#root .day-cell')];
      return cells.length === 7 && cells.every(c => !c.getAttribute('data-dayev'));
    } catch (e) { return String(e); }
  });
  ok(okOld === true, `日程の項目が無い古いデータでもストリップが出る (${okOld})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
