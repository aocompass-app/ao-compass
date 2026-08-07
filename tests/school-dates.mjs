/* 志望校の日程表示テスト   使い方: node tests/school-dates.mjs
   確かめること：
   ・出願締切が過ぎても、試験日・合格発表までのカウントダウンが消えないこと
   ・詳細シートの試験日・合格発表に「あとN日」が出ること
   ・出願締切／必要書類が空のときだけ、入力をうながす案内が出ること         */
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

/* 5パターンの志望校を入れて、カードのバッジがどう出るかを見る */
const CASES = [
  { id: 'c1', name: 'まだ先大学', d: 20, ex: 50, rs: 70 },   // 締切前
  { id: 'c2', name: '出願ずみ大学', d: -5, ex: 10, rs: 30 },  // 締切後・試験前
  { id: 'c3', name: '発表待ち大学', d: -40, ex: -3, rs: 12 }, // 試験も終わり発表前
  { id: 'c4', name: 'ぜんぶ終わった大学', d: -60, ex: -30, rs: -5 },
  { id: 'c5', name: '日付なし大学', d: null, ex: null, rs: null },
];

{
  const p = await open();
  const cards = await p.evaluate(cs => {
    const t = todayISO();
    S.schools = cs.map(c => ({
      id: c.id, name: c.name, faculty: '総合学部', dept: '', method: '総合型選抜',
      deadline: c.d == null ? '' : isoAdd(t, c.d),
      examDate: c.ex == null ? '' : isoAdd(t, c.ex),
      resultDate: c.rs == null ? '' : isoAdd(t, c.rs),
      docs: '志望理由書', docList: ['志望理由書'], checklist: {}
    }));
    S.documents = []; S.tasks = [];
    save(); go('schools');
    const out = {};
    /* 「提出書類の取り組み状況」カードにも大学名が並ぶので、
       志望校カード（詳細ボタンを持つカード）だけを見る */
    document.querySelectorAll('#root .card').forEach(el => {
      if (el.innerText.indexOf('詳細・チェックリスト') < 0) return;
      const hit = cs.filter(c => el.innerText.indexOf(c.name) >= 0)[0];
      if (hit && !out[hit.id]) out[hit.id] = el.innerText.replace(/\s+/g, ' ');
    });
    return out;
  }, CASES);

  ok(/締切まで20日/.test(cards.c1 || ''), `締切前は締切のカウントダウン (${cards.c1})`);
  ok(!/試験まで/.test(cards.c1 || ''), '締切前は試験のカウントダウンを出さない');

  ok(/締切済/.test(cards.c2 || '') && /試験まで10日/.test(cards.c2 || ''),
    `締切が過ぎたら試験までのカウントダウンに切り替わる (${cards.c2})`);

  ok(/合格発表まで12日/.test(cards.c3 || ''),
    `試験も終わったら合格発表までのカウントダウン (${cards.c3})`);

  ok(/締切済/.test(cards.c4 || '') && !/まで\d+日/.test(cards.c4 || ''),
    `すべて終わった大学は締切済だけ (${cards.c4})`);

  ok(/締切未設定/.test(cards.c5 || '') && !/まで\d+日/.test(cards.c5 || ''),
    `日付が何も無ければ締切未設定のまま (${cards.c5})`);

  /* 締切だけ空で合格発表が入っている場合 */
  const c6 = await p.evaluate(() => {
    S.schools = [{ id: 'c6', name: '締切だけ空大学', faculty: '', dept: '', method: '',
      deadline: '', examDate: '', resultDate: isoAdd(todayISO(), 8),
      docs: '志望理由書', docList: ['志望理由書'], checklist: {} }];
    save(); go('schools');
    const el = [...document.querySelectorAll('#root .card')]
      .filter(x => x.innerText.indexOf('詳細・チェックリスト') >= 0 && x.innerText.indexOf('締切だけ空大学') >= 0)[0];
    return el ? el.innerText.replace(/\s+/g, ' ') : '';
  });
  ok(/締切未設定/.test(c6) && /合格発表まで8日/.test(c6),
    `締切未設定でも次の日程は数える (${c6})`);

  await p.context().close();
}

/* 詳細シート：試験日・合格発表にも「あとN日」が出る */
{
  const p = await open();
  const tx = await p.evaluate(() => {
    S.schools = [{ id: 'd1', name: '見本大学', faculty: '法学部', dept: '', method: '総合型選抜',
      deadline: isoAdd(todayISO(), 6), examDate: isoAdd(todayISO(), 21), resultDate: isoAdd(todayISO(), 40),
      docs: '志望理由書、活動報告書', docList: ['志望理由書', '活動報告書'], checklist: {} }];
    save(); render(); openSchool('d1');
    return document.querySelector('#sheet').innerText.replace(/\s+/g, ' ');
  });
  ok(/出願締切.*あと6日/.test(tx), '詳細に 出願締切のあと何日 が出る');
  ok(/試験日.*あと21日/.test(tx), '詳細に 試験日のあと何日 が出る');
  ok(/合格発表.*あと40日/.test(tx), '詳細に 合格発表のあと何日 が出る');
  ok(!/がまだ空です/.test(tx), '締切も書類も入っていれば入力の案内は出さない');
  await p.context().close();
}

/* 詳細シート：締切・必要書類が空のときだけ案内が出る */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S.schools = [{ id: 'e1', name: 'からっぽ大学', checklist: {} }];
    save(); render(); openSchool('e1');
    const a = document.querySelector('#sheet').innerText.replace(/\s+/g, ' ');
    closeSheet();
    S.schools = [{ id: 'e2', name: '締切だけ大学', deadline: isoAdd(todayISO(), 9), checklist: {} }];
    save(); render(); openSchool('e2');
    const b = document.querySelector('#sheet').innerText.replace(/\s+/g, ' ');
    return { a, b };
  });
  ok(/出願締切日・必要書類/.test(r.a) && /がまだ空です/.test(r.a),
    '両方空なら両方の名前を出して案内する');
  ok(/この志望校を編集/.test(r.a), '案内から編集へ行けるボタンがある');
  ok(/必要書類/.test(r.b) && !/出願締切日・必要書類/.test(r.b),
    '締切だけ入っていれば必要書類だけを案内する');
  await p.context().close();
}

/* 古いデータ（日付の項目がそもそも無い）でも志望校が開ける */
{
  const p = await open();
  const okOld = await p.evaluate(() => {
    S = migrate({ schools: [{ id: 'o1', name: '旧データ大学' }] }); save();
    try { go('schools'); openSchool('o1'); closeSheet(); return true; } catch (e) { return String(e); }
  });
  ok(okOld === true, `日付の項目が無い古いデータでも開ける (${okOld})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
