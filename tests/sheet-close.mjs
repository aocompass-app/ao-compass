/* シートを閉じるときの後始末（onSheetClose / runSheetClose）のテスト
   - 小論文で「🤖 評価観点でチェック」を押すと画面が別のシートに置きかわる。
     そのときに本文が消えないか、答案が二重に増えないかを見る。
   - 後始末は一度きりで、次に開いた別のシートに持ち越されないこと。
   - アプリを閉じかけたとき（pagehide）は保存だけ走り、タイマーは止めないこと。
   - 面接・小論文以外のシート（タスク編集など）がこれまで通り動くこと。
   使い方: node tests/sheet-close.mjs                                          */
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
/* シートの中のボタンを文字で探して押す */
const sheetBtn = (p, re) => p.evaluate(r => {
  const b = [...document.querySelectorAll('#sheet button')].filter(x => new RegExp(r).test(x.textContent))[0];
  if (!b) return false; b.click(); return true;
}, re.source || re);
/* シートの中の textarea / 数値入力に、入力したことにして値を入れる */
const typeArea = (p, i, v) => p.evaluate(a => {
  const t = document.querySelectorAll('#sheet textarea')[a.i];
  t.value = a.v; t.dispatchEvent(new Event('input', { bubbles: true }));
}, { i, v });
const typeNum = (p, i, v) => p.evaluate(a => {
  const t = [...document.querySelectorAll('#sheet input')].filter(x => x.type === 'number')[a.i];
  t.value = a.v; t.dispatchEvent(new Event('input', { bubbles: true }));
}, { i, v });

/* 1. 小論文：本文を書いて「評価観点でチェック」を押しても本文が消えない */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  await typeArea(p, 0, '地域の公共交通をどう維持すべきか');
  await typeArea(p, 2, '私は路線バスの利用者数を三か月調べた。' + 'あ'.repeat(80));
  ok(await sheetBtn(p, /評価観点でチェック/), '「評価観点でチェック」ボタンがある');
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => S.essays.map(x => ({ t: x.theme, n: (x.body || '').length })));
  ok(after.length === 1, `チェックに移っても答案は1件だけ残る (${after.length}件)`);
  ok(after[0] && after[0].t === '地域の公共交通をどう維持すべきか' && after[0].n === 99,
     `本文とテーマがそのまま残っている (${JSON.stringify(after[0])})`);
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/主張が明確か/.test(tx), 'チェックの結果がちゃんと出ている');
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.essays.length) === 1, 'チェックを閉じても答案は増えない');
  await p.context().close();
}

/* 2. 自動保存でできた答案をもう一度開いて書き足しても、二重にならない */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  await typeArea(p, 2, '一回目');
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  const id1 = await p.evaluate(() => S.essays[0] && S.essays[0].id);
  await p.evaluate(i => openEssay(i), id1);
  await p.waitForTimeout(300);
  await typeArea(p, 2, '一回目と二回目');
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => S.essays.map(x => ({ id: x.id, b: x.body })));
  ok(r.length === 1, `開き直して書き足しても1件のまま (${r.length}件)`);
  ok(r[0].id === id1 && r[0].b === '一回目と二回目', `同じ答案が書き足されている (${JSON.stringify(r[0])})`);
  const disk = await p.evaluate(() => (JSON.parse(localStorage.getItem(lsKey())).essays || []).length);
  ok(disk === 1, `localStorage にも1件だけ (${disk}件)`);
  await p.context().close();
}

/* 3. 文字数目安をあとから入れると、カウンターがその場で変わる */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  await typeArea(p, 2, 'あ'.repeat(100));
  const before = await p.evaluate(() => document.querySelector('#sheet .counter').textContent);
  await typeNum(p, 1, '400');
  const after = await p.evaluate(() => document.querySelector('#sheet .counter').textContent);
  ok(before === '100字', `目安を入れる前は字数だけ (${before})`);
  ok(/8割の320字まであと220字/.test(after), `目安を入れたらすぐ残り字数が出る (${after})`);
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(150);
  ok(await p.evaluate(() => S.essays[0].charLimit) === 400, 'あとから入れた目安も保存される');
  await p.context().close();
}

/* 4. 後始末は一度きり。次に開いた別のシートに持ち越さない */
{
  const p = await open();
  await p.evaluate(() => {
    S.interview = [{ id: 'q1', question: '強みは。', category: '', schoolId: null,
                     answer: '', favorite: false, weak: false, selfEval: {}, history: [] }];
    S.tasks = []; save(); go('interview'); openInterview('q1');
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#sheet textarea').value = '最後までやり切ることです。'; });
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.interview[0].answer) === '最後までやり切ることです。', '閉じた時点で回答が保存される');
  /* 保存されたあとに回答を消し、関係のないシートを開く */
  await p.evaluate(() => { S.interview[0].answer = ''; save(); openSheet('別の画面', b => b.appendChild(el('p', 'small', 'テスト'))); });
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.interview[0].answer) === '', '前の画面の後始末が別のシートで二重に走らない');
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(150);
  ok(await p.evaluate(() => S.interview[0].answer) === '', '閉じたあとも書き戻されない');
  await p.context().close();
}

/* 5. アプリを閉じかけたとき（pagehide）は保存だけ。タイマーは止めない */
{
  const p = await open();
  await p.evaluate(() => {
    S.interview = [{ id: 'q1', question: '志望理由は。', category: '', schoolId: null,
                     answer: '', favorite: false, weak: false, selfEval: {}, history: [] }];
    save(); go('interview'); openInterview('q1');
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#sheet textarea').value = '書きかけの回答'; });
  ok(await sheetBtn(p, /開始/), 'タイマーの開始ボタンがある');
  await p.waitForTimeout(1200);
  const t1 = await p.evaluate(() => document.querySelectorAll('#sheet .card.tight div')[0].textContent);
  await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await p.waitForTimeout(200);
  const onDisk = await p.evaluate(() => (JSON.parse(localStorage.getItem(lsKey())).interview || [])[0].answer);
  ok(onDisk === '書きかけの回答', `アプリを閉じかけても書きかけが保存される (${onDisk})`);
  await p.waitForTimeout(1200);
  const t2 = await p.evaluate(() => document.querySelectorAll('#sheet .card.tight div')[0].textContent);
  ok(t1 !== t2, `戻ってきたらタイマーは動いたまま (${t1} → ${t2})`);
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  const t3 = await p.evaluate(() => document.querySelectorAll('#sheet .card.tight div')[0].textContent);
  await p.waitForTimeout(1100);
  ok(await p.evaluate(() => document.querySelectorAll('#sheet .card.tight div')[0].textContent) === t3,
     '✕ で閉じたときはタイマーが止まる');
  await p.context().close();
}

/* 6. 面接・小論文以外のシートも、これまで通り開いて保存できる */
{
  const p = await open();
  await p.evaluate(() => { S.tasks = []; S.schools = []; save(); go('tasks'); editTask(null); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#sheet input').value = '募集要項を確認する'; });
  ok(await sheetBtn(p, /^保存$/), 'タスク編集の保存ボタンが押せる');
  await p.waitForTimeout(300);
  const t = await p.evaluate(() => S.tasks.map(x => x.title));
  ok(t.length === 1 && t[0] === '募集要項を確認する', `タスクがこれまで通り作れる (${JSON.stringify(t)})`);
  /* 削除の確認シートも、二重の後始末で壊れないこと */
  await p.evaluate(() => { S.documents = [{ id: 'd1', title: '志望理由書', type: '志望理由書', body: 'あ', status: '下書き', updatedAt: Date.now() }]; save(); go('documents'); });
  await p.waitForTimeout(300);
  const okOpen = await p.evaluate(() => { try { openDocEditor('d1'); closeSheet(); return true; } catch (e) { return String(e); } });
  ok(okOpen === true, `書類エディターも開いて閉じられる (${okOpen})`);
  await p.context().close();
}

/* 7. 古いデータ（新しい項目がない）でも壊れない */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S = migrate({ essays: [{ id: 'e0', theme: '昔の答案', body: 'あ'.repeat(30) }],
                  interview: [{ id: 'i0', question: '昔の質問' }] });
    save();
    try { go('essay'); openEssay('e0'); closeSheet(); openInterview('i0'); closeSheet(); return true; }
    catch (e) { return String(e); }
  });
  await p.waitForTimeout(300);
  ok(r === true, `古いデータでも開いて閉じられる (${r})`);
  const n = await p.evaluate(() => [S.essays.length, S.interview.length].join(','));
  ok(n === '1,1', `古いデータが増えたり消えたりしない (${n})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
