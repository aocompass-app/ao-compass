/* 自己分析ワークの回答欄まわりの回帰テスト
   使い方: node tests/self-answer.mjs

   1. 回答を保存したあとも、質問の見出しが .smt に包まれたまま（右に寄らない）
   2. 回答欄に文字数が表示され、入力に追従する                                */
import { chromium } from 'playwright';
import { openApp } from './smoke.mjs';

let pass = 0, fail = 0;
function ok(name) { pass++; console.log('  [32m✓[0m ' + name); }
function ng(name, detail) { fail++; console.log('  [31m✗[0m ' + name + (detail ? '\n      → ' + detail : '')); }
function check(name, cond, detail) { cond ? ok(name) : ng(name, detail); }

/* 見出しの中の「質問文」がどこから始まっているかを測る（バッジの文字は3字なので除外される） */
const MEASURE = `(function(sm){
  const w=document.createTreeWalker(sm,NodeFilter.SHOW_TEXT,null);
  let n,last=null;
  while((n=w.nextNode())){ if(n.textContent.trim().length>3) last=n; }
  if(!last) return null;
  const r=document.createRange(); r.selectNodeContents(last);
  return Math.round(r.getBoundingClientRect().x);
})`;

async function main() {
  const browser = await chromium.launch();
  const { ctx, page, jsErrors } = await openApp(browser);

  await page.evaluate(() => { S = migrate({}); save(); go('self'); });
  const det = page.locator('#root details.acc').first();
  await det.waitFor();
  await page.evaluate(() => { document.querySelectorAll('#root details.acc').forEach(d => { d.open = true; }); });

  /* ---- 保存前の状態 ---- */
  const before = await page.evaluate(M => {
    const d = document.querySelectorAll('#root details.acc')[0];
    const sm = d.querySelector('summary');
    return {
      hasSmt: !!sm.querySelector(':scope > .smt'),
      hasBadge: !!sm.querySelector('.badge'),
      badgeText: (sm.querySelector('.badge') || {}).textContent,
      textX: eval(M)(sm),
      smX: Math.round(sm.getBoundingClientRect().x),
      counter: (d.querySelector('.counter') || {}).textContent,
      h: Math.round(sm.getBoundingClientRect().height),
    };
  }, MEASURE);

  console.log('\n[1] 保存前の見出し');
  check('見出しが <span class="smt"> に包まれている', before.hasSmt);
  check('「未回答」バッジが出ている', before.badgeText === '未回答', before.badgeText);
  check('回答欄の下に文字数が出ている', before.counter === '0字', before.counter);

  /* ---- 回答を入力して自動保存させる ---- */
  console.log('\n[2] 回答を入力して自動保存させたあと');
  const ANS = '文化祭の実行委員として、来場者アンケートを二百件集めて配置を変えました。';
  await det.locator('textarea').fill(ANS);
  await page.waitForFunction(a => (S.self.answers.q1 || '') === a, ANS, { timeout: 5000 });
  await page.waitForTimeout(200);

  const after = await page.evaluate(M => {
    const d = document.querySelectorAll('#root details.acc')[0];
    const sm = d.querySelector('summary');
    return {
      hasSmt: !!sm.querySelector(':scope > .smt'),
      badgeText: (sm.querySelector('.badge') || {}).textContent,
      badgeClass: (sm.querySelector('.badge') || {}).className,
      textX: eval(M)(sm),
      counter: (d.querySelector('.counter') || {}).textContent,
      h: Math.round(sm.getBoundingClientRect().height),
      prog: document.querySelector('#root .card.tight').innerText.replace(/\s/g, ''),
    };
  }, MEASURE);

  check('保存後も見出しが <span class="smt"> に包まれている（右寄り崩れの再発防止）', after.hasSmt);
  check('保存後も質問文の位置が動かない', after.textX != null && Math.abs(after.textX - before.textX) <= 2,
    `before=${before.textX} after=${after.textX}`);
  check('バッジが「回答済」に変わる', after.badgeText === '回答済', after.badgeText);
  check('バッジは消えずに色だけ変わる', /badge/.test(after.badgeClass || '') && /ok/.test(after.badgeClass || ''), after.badgeClass);
  check('進捗が 1/8 になる', after.prog.indexOf('1/8') >= 0, after.prog);

  console.log('\n[3] 文字数の表示');
  const expected = ANS.replace(/\s/g, '').length + '字';
  check('入力した文字数が表示される（' + expected + '）', after.counter === expected, after.counter);
  await det.locator('textarea').fill('');
  await page.waitForTimeout(100);
  const zero = await page.evaluate(() => document.querySelectorAll('#root details.acc')[0].querySelector('.counter').textContent);
  check('消したら 0字 に戻る', zero === '0字', zero);

  console.log('\n[4] 画面を作り直しても崩れない');
  /* 入力欄から手を離す（フォーカスが残ったままだと、作り直しの blur で入力欄の中身が書き戻される） */
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { S.self.answers.q1 = 'あああああ'; save(); render(); });
  const rerender = await page.evaluate(M => {
    const d = document.querySelectorAll('#root details.acc')[0];
    const sm = d.querySelector('summary');
    return { hasSmt: !!sm.querySelector(':scope > .smt'), textX: eval(M)(sm), counter: (d.querySelector('.counter') || {}).textContent };
  }, MEASURE);
  check('再描画後も .smt に包まれている', rerender.hasSmt);
  check('再描画後も質問文の位置が同じ', Math.abs(rerender.textX - before.textX) <= 2, `before=${before.textX} after=${rerender.textX}`);
  check('再描画後の文字数が保存内容と合う', rerender.counter === '5字', rerender.counter);

  check('JSエラーが出ない', jsErrors.length === 0, jsErrors.join(' | '));

  await ctx.close();
  await browser.close();
  console.log(`\n=== self-answer: ${pass} 件成功 / ${fail} 件失敗 ===`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
