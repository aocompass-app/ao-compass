/* AO Compass 基本動作テスト（playwright）
   使い方: node tests/smoke.mjs
   index.html を file:// で 390x844（iPhone 相当）で開いて、壊れていないかを確かめます。 */
import { chromium } from 'playwright';
import { ok, summary, openApp, goto, visibleText, seedSchool, VIEWS } from './helpers.mjs';

async function main() {
  const browser = await chromium.launch();
  const { ctx, page, errors } = await openApp(browser);

  /* --- 1. 7画面が中身つきで開く --- */
  console.log('\n[1] 7つの画面が開く');
  for (const [view, label] of VIEWS) {
    await goto(page, view);
    const txt = await visibleText(page);
    ok(txt.trim().length > 40, `${label}（${view}）が中身つきで開く`, `文字数=${txt.trim().length}`);
  }
  ok(errors.length === 0, '7画面を開いてもJSエラーが出ない', errors.join(' | '));

  /* --- 2. 必要書類3件 → requiredDocs 3件・緊急タスク3件 --- */
  console.log('\n[2] 必要書類から緊急タスクができる');
  await seedSchool(page, '志望理由書、活動報告書、学習計画書');
  const reqd = await page.evaluate(() => requiredDocs(S.schools[0]));
  ok(reqd.length === 3, 'requiredDocs が3件返る', JSON.stringify(reqd));
  const urgent = await page.evaluate(() => { syncDocTasks(); return S.tasks.filter(t => t.docauto && t.urgent).length; });
  ok(urgent === 3, '緊急タスクが3件できる', '件数=' + urgent);

  /* --- 3. 同じ座標で4回押しても、押した行以外は変わらない・高さも変わらない --- */
  console.log('\n[3] チェックの誤爆と行のズレが起きない');
  await page.evaluate(() => {
    S = migrate({});
    S.tasks = [
      { id: 't1', title: 'タスクA：志望理由書の材料を集める', due: null, done: false, category: '書類' },
      { id: 't2', title: 'タスクB：面接の想定問答を3つ書く', due: null, done: false, category: '面接' },
      { id: 't3', title: 'タスクC：活動報告書の下書き', due: null, done: false, category: '書類' },
      { id: 't4', title: 'タスクD：募集要項をもう一度読む', due: null, done: false, category: '出願' },
    ];
    save(); go('tasks');
  });
  await page.waitForTimeout(80);

  const hit = page.locator('#root .list-row[data-tid="t2"] .checkhit');
  const box = await hit.boundingBox();
  const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const readHeights = () => page.evaluate(() =>
    ['t1', 't2', 't3', 't4'].map(id => Math.round(document.querySelector(`#root .list-row[data-tid="${id}"]`).getBoundingClientRect().height)));
  const heightsBefore = await readHeights();

  for (let i = 0; i < 4; i++) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300);   /* tapOK の 220ms より長く待って、毎回きちんと反応させる */
  }

  const state = await page.evaluate(() => S.tasks.map(t => !!t.done));
  ok(state[0] === false && state[2] === false && state[3] === false, '押した行以外の done が変わらない', JSON.stringify(state));
  ok(state[1] === false, '4回押すと元に戻る（偶数回）', JSON.stringify(state));
  const heightsAfter = await readHeights();
  ok(JSON.stringify(heightsBefore) === JSON.stringify(heightsAfter), '行の高さが変わらない',
    JSON.stringify(heightsBefore) + ' → ' + JSON.stringify(heightsAfter));

  /* 1回だけ押したときに、その行だけ確実に入ること */
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  const one = await page.evaluate(() => S.tasks.map(t => !!t.done));
  ok(one[1] === true && one[0] === false && one[2] === false && one[3] === false, '1回押すとその行だけチェックが入る', JSON.stringify(one));

  /* --- 4. 古い形のデータでも全画面が開く --- */
  console.log('\n[4] 古い形のデータを読み込んでも壊れない');
  const before4 = errors.length;
  const migrated = await page.evaluate(() => {
    /* 昔のバージョンにあった最低限の形（新しい項目は一切入っていない） */
    const oldRaw = {
      schools: [{ id: 's9', name: '昔から入っている大学', deadline: '2026-10-01' }],
      documents: [{ id: 'd9', title: '志望理由書', body: 'むかしむかし書いた本文です。', schoolId: 's9' }],
      tasks: [{ id: 'k9', title: '昔のタスク', done: false }],
      self: { answers: { q1: '昔の回答' } },
    };
    S = migrate(oldRaw);
    save();
    return {
      schools: S.schools.length, documents: S.documents.length, tasks: S.tasks.length,
      checklistOk: typeof S.schools[0].checklist === 'object',
      versionsOk: Array.isArray(S.documents[0].versions),
      tagsOk: Array.isArray(S.self.tags.strengths),
      prefsOk: !!S.prefs && S.prefs.textSize === 'm',
      docTaskOffOk: !!S.meta.docTaskOff && typeof S.meta.docTaskOff === 'object',
      answerKept: S.self.answers.q1 === '昔の回答',
    };
  });
  ok(migrated.schools === 1 && migrated.documents === 1 && migrated.answerKept, 'migrate が古いデータを消さない', JSON.stringify(migrated));
  ok(migrated.checklistOk && migrated.versionsOk && migrated.tagsOk && migrated.prefsOk && migrated.docTaskOffOk,
    'migrate が足りない項目を補う', JSON.stringify(migrated));
  for (const [view, label] of VIEWS) {
    await goto(page, view);
    const txt = await visibleText(page);
    ok(txt.trim().length > 20, `古いデータでも ${label} が開く`);
  }
  ok(errors.length === before4, '古いデータでもJSエラーが出ない', errors.slice(before4).join(' | '));

  /* --- 5. 免責の帯とバージョン表記 --- */
  console.log('\n[5] 免責の帯とバージョン');
  const band = await page.evaluate(() => ({
    hasBand: document.body.innerText.includes('入試情報は必ず大学公式サイトの最新の募集要項・原本を確認してください'),
    ver: (typeof APP_VER === 'string') ? APP_VER : null,
  }));
  ok(band.hasBand, '「募集要項・原本を確認してください」の帯が常時表示されている');
  ok(/^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(band.ver || ''), 'APP_VER が YYYY.MM.DD の形', String(band.ver));

  await ctx.close();
  await browser.close();
  summary('smoke');
}

main().catch(e => { console.error(e); process.exit(1); });
