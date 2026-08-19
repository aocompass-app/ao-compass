/* 模擬面接を途中で閉じたときの後始末（onSheetClose）のテスト
   - 「✕」や背景タップで閉じても、時間の計測と読み上げが裏で動き続けないこと
   - 「やめる」以外で閉じたときに、勝手に回答が保存されてしまわないこと
   - 「次の質問へ」で、前の問の答えが次の問に混ざらないこと（問番号を固定して持っている）
   - 小論文の字数カウンターに、募集要項を確認する案内が出ていること
   使い方: node tests/mock-interview-close.mjs                                  */
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
  /* 読み上げを止めた回数を数えられるようにする */
  await p.addInitScript(`window.__cancels=0;
    try{ if('speechSynthesis' in window){ const o=window.speechSynthesis.cancel;
      window.speechSynthesis.cancel=function(){ window.__cancels++; try{ return o.apply(window.speechSynthesis,arguments); }catch(e){} }; } }catch(e){}`);
  await p.goto(FILE);
  await p.waitForTimeout(400);
  return p;
}
const sheetBtn = (p, re) => p.evaluate(r => {
  const b = [...document.querySelectorAll('#sheet button')].filter(x => new RegExp(r).test(x.textContent))[0];
  if (!b) return false; b.click(); return true;
}, re.source || re);
/* 模擬面接の残り時間（大きな数字） */
const clock = p => p.evaluate(() => {
  const n = [...document.querySelectorAll('#sheet div')].filter(d => /font-size:\s*32px/.test(d.getAttribute('style') || ''))[0];
  return n ? n.textContent : null;
});
const startMock = (p, n) => p.evaluate(cnt => {
  S.interview = [];
  for (let k = 1; k <= cnt; k++) S.interview.push({ id: 'q' + k, question: '質問' + k + 'です。', category: '',
    schoolId: null, answer: '', favorite: false, weak: false, selfEval: {}, history: [] });
  save(); go('interview');
  runMockInterview(mockQuestions(cnt).slice(0, cnt), { n: cnt, sec: 60, speakOn: false });
}, n);

/* 1. ✕ で閉じたら時間の計測が止まる（裏で回り続けない） */
{
  const p = await open();
  await startMock(p, 2);
  await p.waitForTimeout(1300);
  const t1 = await clock(p);
  ok(t1 && t1 !== '1:00', `閉じる前は時間が減っている (${t1})`);
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(2200);
  ok(await clock(p) === t1, `✕ で閉じたあとは時間が止まっている (${t1})`);
  await p.context().close();
}

/* 2. 背景タップで閉じても止まる／読み上げも止める */
{
  const p = await open();
  await startMock(p, 2);
  await p.waitForTimeout(1300);
  const before = await p.evaluate(() => window.__cancels);
  const t1 = await clock(p);
  await p.evaluate(() => { const ov = document.querySelector('#overlay'); ov.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await p.waitForTimeout(2200);
  ok(await clock(p) === t1, `背景タップでも時間が止まる (${t1})`);
  ok(await p.evaluate(() => window.__cancels) > before, '閉じたときに読み上げも止めている');
  ok(await p.evaluate(() => document.querySelector('#overlay').classList.contains('open')) === false, 'シートが閉じている');
  await p.context().close();
}

/* 3. 途中で閉じただけでは、回答は勝手に保存されない */
{
  const p = await open();
  await startMock(p, 2);
  await p.waitForTimeout(300);
  await p.evaluate(() => { const ta = document.querySelector('#sheet textarea'); ta.value = '途中まで話した内容'; ta.dispatchEvent(new Event('input')); });
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(250);
  const ans = await p.evaluate(() => S.interview.map(x => x.answer));
  ok(ans.join('|') === '|', `閉じただけでは面接タブに書き込まれない (${JSON.stringify(ans)})`);
  ok(await p.evaluate(() => S.interview.length) === 2, '質問が増えていない');
  await p.context().close();
}

/* 4. 「次の質問へ」で、前の問の答えが次の問に混ざらない */
{
  const p = await open();
  await startMock(p, 2);
  await p.waitForTimeout(300);
  await p.evaluate(() => { const ta = document.querySelector('#sheet textarea'); ta.value = '一問目の答えです。'; ta.dispatchEvent(new Event('input')); });
  ok(await sheetBtn(p, /次の質問へ/), '「次の質問へ」がある');
  await p.waitForTimeout(300);
  const blank = await p.evaluate(() => document.querySelector('#sheet textarea').value);
  ok(blank === '', `二問目の答えの欄はからっぽ (${JSON.stringify(blank)})`);
  ok(await sheetBtn(p, /終わって講評を見る/), '最後は「終わって講評を見る」になる');
  await p.waitForTimeout(300);
  const saved = await p.evaluate(() => S.interview.map(x => x.question + '=' + (x.answer || '')));
  ok(saved[0] === '質問1です。=一問目の答えです。', `一問目だけが保存される (${saved[0]})`);
  ok(saved[1] === '質問2です。=', `答えていない二問目に混ざらない (${saved[1]})`);
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/おつかれさまでした/.test(tx) && /答えた1問/.test(tx), '講評画面に保存件数が出る');
  await p.context().close();
}

/* 5. 講評画面を閉じてもエラーにならず、面接タブに反映されている */
{
  const p = await open();
  await startMock(p, 1);
  await p.waitForTimeout(300);
  await p.evaluate(() => { const ta = document.querySelector('#sheet textarea'); ta.value = '答えました。'; ta.dispatchEvent(new Event('input')); });
  await sheetBtn(p, /終わって講評を見る/);
  await p.waitForTimeout(300);
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(250);
  const disk = await p.evaluate(() => (JSON.parse(localStorage.getItem(lsKey())).interview || [])[0].answer);
  ok(disk === '答えました。', `端末にも保存されている (${disk})`);
  ok((await p.evaluate(() => document.querySelector('#root').innerText)).includes('回答あり'), '一覧が「回答あり」になっている');
  await p.context().close();
}

/* 6. 小論文の字数まわり：募集要項の確認をうながす一文がある／免責の帯も消えていない */
{
  const p = await open();
  await p.evaluate(() => { S.essays = []; save(); go('essay'); openEssay(null); });
  await p.waitForTimeout(300);
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/募集要項/.test(tx), '字数の下に募集要項を確認する案内が出る');
  ok(!/合格を保証|必ず合格/.test(tx), '合格を保証するような言い回しが無い');
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(150);
  ok((await p.evaluate(() => document.body.innerText)).includes('大学公式サイトの最新の募集要項'), '免責の帯が消えていない');
  await p.context().close();
}

/* 7. 古いデータでも模擬面接が始められて閉じられる */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S = migrate({ interview: [{ id: 'i0', question: '昔の質問' }] });
    save();
    try { runMockInterview(mockQuestions(1), { n: 1, sec: 60, speakOn: false }); closeSheet(); return true; }
    catch (e) { return String(e); }
  });
  await p.waitForTimeout(300);
  ok(r === true, `古いデータでも模擬面接が開いて閉じられる (${r})`);
  ok(await p.evaluate(() => S.interview.length) === 1, '古いデータの質問が増えたり消えたりしない');
  await p.context().close();
}

/* 8. 390px で模擬面接の画面が横にはみ出さない */
{
  const p = await open();
  await startMock(p, 3);
  await p.waitForTimeout(300);
  const w = await p.evaluate(() => { const s = document.querySelector('#sheet'); return [s.scrollWidth, s.clientWidth]; });
  ok(w[0] <= w[1] + 1, `横スクロールが出ない (${w.join(' / ')})`);
  await p.evaluate(() => closeSheet());
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
