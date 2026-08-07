/* 面接練習・小論文の「書きかけが消えない」まわりのテスト
   使い方: node tests/interview-essay.mjs                                     */
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
const sheetBtn = (p, re) => p.evaluate(r => {
  const b = [...document.querySelectorAll('#sheet button')].filter(x => new RegExp(r).test(x.textContent))[0];
  if (!b) return false; b.click(); return true;
}, re.source || re);

/* 1. 面接練習：回答を書いて ✕ で閉じても消えない */
{
  const p = await open();
  await p.evaluate(() => {
    S.interview = [{ id: 'q1', question: 'なぜこの大学を志望しましたか。', category: 'よくある質問',
                     schoolId: null, answer: '', favorite: false, weak: false, selfEval: {}, history: [] }];
    save(); go('interview'); openInterview('q1');
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#sheet textarea').value = '私は探究活動で地域の交通を調べました。'; });
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  const inMem = await p.evaluate(() => S.interview[0].answer);
  const onDisk = await p.evaluate(() => (JSON.parse(localStorage.getItem(lsKey())).interview || [])[0].answer);
  ok(inMem === '私は探究活動で地域の交通を調べました。', '✕ で閉じても回答が残る');
  ok(onDisk === inMem, '閉じた時点で localStorage にも書かれている');
  ok((await p.evaluate(() => document.querySelector('#root').innerText)).includes('回答あり'),
     '一覧のカードが「未回答」から「回答あり」に変わる');
  await p.context().close();
}

/* 2. 面接練習：「ふりかえる」で別シートに移っても回答が消えない */
{
  const p = await open();
  await p.evaluate(() => {
    S.interview = [{ id: 'q1', question: 'あなたの強みは。', category: '', schoolId: null,
                     answer: '', favorite: false, weak: false, selfEval: {}, history: [] }];
    save(); go('interview'); openInterview('q1');
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#sheet textarea').value = '最後までやり切ることです。'; });
  ok(await sheetBtn(p, /ふりかえ/), '「ふりかえる」ボタンがある');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => S.interview[0].answer) === '最後までやり切ることです。',
     'ふりかえりシートに移っても書いた回答が保存されている');
  await p.context().close();
}

/* 3. 面接練習：シートを閉じたらタイマーが止まる（裏で回り続けない） */
{
  const p = await open();
  await p.evaluate(() => {
    S.interview = [{ id: 'q1', question: 'Q', category: '', schoolId: null, answer: '',
                     favorite: false, weak: false, selfEval: {}, history: [] }];
    save(); go('interview'); openInterview('q1');
  });
  await p.waitForTimeout(300);
  await sheetBtn(p, /開始/);
  await p.waitForTimeout(1200);
  const disp = () => p.evaluate(() => document.querySelector('#sheet div[style*="28px"]').textContent);
  const t1 = await disp();
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(2200);
  ok(t1 !== '0:00', `閉じる前はタイマーが動いている (${t1})`);
  ok(await disp() === t1, '閉じたあとはタイマーが止まっている');
  await p.context().close();
}

/* 4. 自己評価はタップした時点で保存される */
{
  const p = await open();
  await p.evaluate(() => {
    S.interview = [{ id: 'q1', question: 'Q', category: '', schoolId: null, answer: '',
                     favorite: false, weak: false, selfEval: {}, history: [] }];
    save(); go('interview'); openInterview('q1');
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelectorAll('#sheet .seg')[0].querySelectorAll('button')[2].click(); });
  const saved = await p.evaluate(() => (JSON.parse(localStorage.getItem(lsKey())).interview[0].selfEval || {})['具体性']);
  ok(saved === 3, `自己評価を押した時点で保存される (具体性=${saved})`);
  await p.context().close();
}

/* 5. よくある質問から追加 → 閉じたら一覧にすぐ出る */
{
  const p = await open();
  await p.evaluate(() => { S.interview = []; save(); go('interview'); });
  await p.waitForTimeout(200);
  ok((await p.evaluate(() => document.querySelector('#root').innerText)).includes('質問がありません'),
     '追加前は「質問がありません」');
  await p.evaluate(() => showQBank());
  await p.waitForTimeout(200);
  await p.evaluate(() => { const bs = [...document.querySelectorAll('#sheet button')].filter(x => x.textContent === '＋追加'); bs[0].click(); bs[1].click(); });
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(250);
  const tx = await p.evaluate(() => document.querySelector('#root').innerText);
  ok(await p.evaluate(() => S.interview.length) === 2, '2問追加された');
  ok(!tx.includes('質問がありません'), '閉じたあとの一覧に追加した質問が出ている');
  await p.context().close();
}

/* 6. 小論文：本文を書いて閉じても答案が残る（新規） */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const ta = document.querySelectorAll('#sheet textarea');
    ta[0].value = '地方の人口減少について';        // テーマ
    ta[2].value = 'あ'.repeat(120);                 // 本文
  });
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(250);
  const e = await p.evaluate(() => S.essays.map(x => ({ t: x.theme, n: (x.body || '').length, id: !!x.id, c: !!x.createdAt })));
  ok(e.length === 1 && e[0].t === '地方の人口減少について' && e[0].n === 120, `閉じても答案が残る (${JSON.stringify(e)})`);
  ok(e[0].id && e[0].c, 'id と作成日が付いている（一覧が壊れない）');
  ok((await p.evaluate(() => document.querySelector('#root').innerText)).includes('地方の人口減少について'),
     '一覧にもすぐ出る');
  await p.context().close();
}

/* 7. 小論文：何も書かずに閉じても、からの答案は増えない */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.essays.length) === 0, '空のまま閉じても答案は作られない');
  await p.context().close();
}

/* 8. 小論文：保存ボタンでも二重に増えない */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelectorAll('#sheet textarea')[0].value = 'テーマA'; });
  await sheetBtn(p, /^保存$/);
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => S.essays.length) === 1, `保存ボタンでも1件だけ (${await p.evaluate(() => S.essays.length)}件)`);
  await p.context().close();
}

/* 9. 小論文：字数の過不足がひと目で分かる */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  const count = n => p.evaluate(len => {
    const nums = document.querySelectorAll('#sheet input[type=number]');
    nums[1].value = '400';
    const ta = document.querySelectorAll('#sheet textarea')[2];
    ta.value = 'あ'.repeat(len); ta.dispatchEvent(new Event('input'));
    const c = document.querySelector('#sheet .counter');
    return { t: c.textContent, col: c.style.color };
  }, n);
  const over = await count(500), good = await count(380), few = await count(100);
  ok(/100字オーバー/.test(over.t) && /alert/.test(over.col), `超過は赤で「◯字オーバー」(${over.t})`);
  ok(/あと20字/.test(good.t) && /ok/.test(good.col), `8割を超えたら緑で残り字数 (${good.t})`);
  ok(/8割の320字まであと220字/.test(few.t), `8割未満はあと何字か出る (${few.t})`);
  const noLimit = await p.evaluate(() => {
    const nums = document.querySelectorAll('#sheet input[type=number]');
    nums[1].value = ''; nums[1].dispatchEvent(new Event('input'));
    return document.querySelector('#sheet .counter').textContent;
  });
  ok(noLimit === '100字', `目安なしなら字数だけ (${noLimit})`);
  await p.context().close();
}

/* 10. 古いデータでも面接・小論文が開く（壊していない） */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S = migrate({ interview: [{ id: 'oq', question: '昔の質問' }], essays: [{ id: 'oe', theme: '昔のテーマ' }] });
    save();
    try { go('interview'); openInterview('oq'); closeSheet(); go('essay'); openEssay('oe'); closeSheet(); return true; }
    catch (e) { return String(e); }
  });
  ok(r === true, `旧データでも面接練習・小論文が開いて閉じられる (${r})`);
  ok(await p.evaluate(() => S.essays.length) === 1, '旧データの答案が増えたり消えたりしない');
  await p.context().close();
}

/* 11. 小論文の削除が、自動保存で復活しない */
{
  const p = await open();
  await p.evaluate(() => {
    S.essays = [{ id: 'e1', theme: '消す答案', body: 'ほげ', createdAt: 1, selfEval: {} }];
    save(); go('essay'); openEssay('e1');
  });
  await p.waitForTimeout(300);
  await sheetBtn(p, /^削除$/);
  await p.waitForTimeout(250);
  await sheetBtn(p, /削除する/);
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.essays.length) === 0, '削除した答案が自動保存で戻ってこない');
  await p.context().close();
}

/* 12. 面接の質問削除も同じく戻ってこない */
{
  const p = await open();
  await p.evaluate(() => {
    S.interview = [{ id: 'q1', question: '消す質問', answer: 'あ', selfEval: {}, history: [] }];
    save(); go('interview'); editInterview('q1');
  });
  await p.waitForTimeout(300);
  await sheetBtn(p, /^削除$/);
  await p.waitForTimeout(250);
  await sheetBtn(p, /削除する/);
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.interview.length) === 0, '削除した質問が戻ってこない');
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
