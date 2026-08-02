/* 今回入れた「タスク・締切」まわりの改善そのものを確かめるテスト
   使い方: node tests/tasks.mjs

   A) 自動でできた書類タスクを編集・削除しても、画面を切り替えたときに元に戻らない
   B) さわっていない書類タスクは、これまでどおり自動で最新に保たれる
   C) タスク一覧が「期限を過ぎた／未完了（日付ごと）／先の予定」に分かれる */
import { chromium } from 'playwright';
import { ok, summary, openApp, goto, visibleText, seedSchool } from './helpers.mjs';

async function main() {
  const browser = await chromium.launch();
  const { ctx, page, errors } = await openApp(browser);

  /* ============ A) 自動タスクを自分で直したら、勝手に戻らない ============ */
  console.log('\n[A] 自動でできた「緊急」書類タスクを自分で直せる');
  await seedSchool(page, '志望理由書、活動報告書');

  const made = await page.evaluate(() => { syncDocTasks(); return S.tasks.filter(t => t.docauto).length; });
  ok(made === 2, '必要書類2件から「緊急」タスクが2件できる', '件数=' + made);

  /* 日付とタイトルを自分で書き換える（editTask の保存と同じ処理を通す） */
  const edited = await page.evaluate(() => {
    const t = S.tasks.filter(x => x.docauto)[0];
    const dkey = t.dkey;
    t.title = '日曜に図書館で志望理由書のネタ出し';
    t.due = isoAdd(todayISO(), 20);
    detachDocTask(t);
    save();
    render(); render();                     /* 画面を作り直しても戻らないこと（render で syncDocTasks が走る） */
    const now = S.tasks.filter(x => x.id === t.id)[0];
    return {
      dkey,
      title: now ? now.title : null,
      due: now ? now.due : null,
      wantDue: isoAdd(todayISO(), 20),
      stillAuto: !!(now && now.docauto),
      duplicated: S.tasks.filter(x => x.docauto && x.dkey === dkey).length,
      total: S.tasks.length,
    };
  });
  ok(edited.title === '日曜に図書館で志望理由書のネタ出し', '書き換えたタスク名が元に戻らない', String(edited.title));
  ok(edited.due === edited.wantDue, '自分で決めた締切日が元に戻らない', edited.due + ' / 期待=' + edited.wantDue);
  ok(edited.stillAuto === false, '編集したタスクは自動管理から外れる');
  ok(edited.duplicated === 0, '同じ書類のタスクが二重に作られない', '重複=' + edited.duplicated);
  ok(edited.total === 2, 'タスクの総数は増えも減りもしない', '総数=' + edited.total);

  /* 削除したら復活しない */
  const deleted = await page.evaluate(() => {
    const t = S.tasks.filter(x => x.docauto)[0];
    const dkey = t.dkey;
    docTaskOff(dkey);                       /* editTask の削除ボタンと同じ処理 */
    S.tasks = S.tasks.filter(x => x.id !== t.id);
    save();
    render(); render();
    return { revived: S.tasks.filter(x => x.dkey === dkey).length, total: S.tasks.length, off: !!S.meta.docTaskOff[dkey] };
  });
  ok(deleted.revived === 0, '削除した書類タスクが作り直されない', '復活=' + deleted.revived);
  ok(deleted.total === 1, '残るのは自分で編集した1件だけ', '総数=' + deleted.total);

  /* 「作らないでほしい」の記録が保存され、読み直しても残る */
  const persisted = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem(lsKey()));
    const back = migrate(raw);
    return Object.keys(back.meta.docTaskOff || {}).length;
  });
  ok(persisted === 2, '編集・削除の記録が保存され、読み直しても残る', '件数=' + persisted);

  /* ============ B) さわっていないタスクは、これまでどおり自動更新 ============ */
  console.log('\n[B] さわっていないタスクは自動で最新に保たれる');
  await seedSchool(page, '志望理由書');
  const autoKept = await page.evaluate(() => {
    syncDocTasks();
    const t = S.tasks.filter(x => x.docauto)[0];
    const dkey = t.dkey;
    t.due = '2020-01-01';                   /* 何かの拍子に古い日付になった状態を作る */
    syncDocTasks();
    const now = S.tasks.filter(x => x.dkey === dkey)[0];
    return { due: now.due, isFuture: now.due >= todayISO(), urgent: !!now.urgent };
  });
  ok(autoKept.isFuture, 'さわっていない書類タスクは締切が自動で今日以降に直る', autoKept.due);
  ok(autoKept.urgent, '「緊急」の目印は残る');

  /* 書類に本文を書いたら、自動タスクは消える（元からの動き） */
  const goneAfterStart = await page.evaluate(() => {
    S.documents.push({ id: 'dd1', schoolId: 'sc1', title: 'テスト大学 志望理由書', type: '志望理由書',
      status: '下書き', body: '私は地域の図書館で子ども向けの読み聞かせを2年続けてきました。', charLimit: 0,
      paragraphNotes: {}, feedbacks: [], versions: [], scoreHistory: [], updatedAt: Date.now() });
    syncDocTasks();
    return S.tasks.filter(t => t.docauto).length;
  });
  ok(goneAfterStart === 0, '書類に手をつけると「緊急」タスクは自動で消える', '残り=' + goneAfterStart);

  /* ============ C) タスク一覧の並び ============ */
  console.log('\n[C] タスク一覧が「期限を過ぎた／これから／先の予定」に分かれる');
  await page.evaluate(() => {
    S = migrate({});
    const T = todayISO();
    S.tasks = [
      { id: 'o1', title: '過ぎたタスクA', due: isoAdd(T, -5), done: false },
      { id: 'o2', title: '過ぎたタスクB', due: isoAdd(T, -1), done: false },
      { id: 'n1', title: '今日のタスク1', due: T, done: false },
      { id: 'n2', title: '今日のタスク2', due: T, done: false },
      { id: 'n3', title: '明日のタスク', due: isoAdd(T, 1), done: false },
      { id: 'n4', title: '来週のタスク', due: isoAdd(T, 6), done: false },
      { id: 'f1', title: 'ずっと先のタスク1', due: isoAdd(T, 30), done: false },
      { id: 'f2', title: 'ずっと先のタスク2', due: isoAdd(T, 45), done: false },
      { id: 'x1', title: '期限なしのタスク', due: '', done: false },
      { id: 'z1', title: '終わったタスク', due: isoAdd(T, -2), done: true },
    ];
    save(); go('tasks');
  });
  await page.waitForTimeout(80);

  const heads = await page.evaluate(() => ({
    over: (document.querySelector('#root [data-tk="over"]') || {}).textContent || null,
    open: (document.querySelector('#root [data-tk="open"]') || {}).textContent || null,
    done: (document.querySelector('#root [data-tk="done"]') || {}).textContent || null,
  }));
  ok(heads.over === '期限を過ぎた（2）', '期限を過ぎたタスクが別枠にまとまる', String(heads.over));
  ok(heads.open === '未完了（7）', '未完了は期限を過ぎた分を除いて数える', String(heads.open));
  ok(heads.done === '完了済み（1）', '完了済みの件数はこれまでどおり', String(heads.done));

  /* 期限を過ぎた枠には、過ぎたタスクだけが入る */
  const inOverCard = await page.evaluate(() => {
    const h = document.querySelector('#root [data-tk="over"]');
    const card = h.closest('.card');
    return Array.prototype.map.call(card.querySelectorAll('.list-row[data-tid]'), r => r.getAttribute('data-tid'));
  });
  ok(JSON.stringify(inOverCard) === JSON.stringify(['o1', 'o2']), '期限を過ぎた枠に入るのは過ぎたタスクだけ', JSON.stringify(inOverCard));

  /* たたまれた中身は、開かないと見えない（閉じた details の中）。
     visibleText() は details を全部開けてしまうので、先に閉じている状態を見る */
  const folded = await page.evaluate(() => {
    const d = Array.prototype.filter.call(document.querySelectorAll('#root details.acc'),
      x => (x.querySelector('summary') || {}).textContent.indexOf('より先の予定') >= 0)[0];
    if (!d) return null;
    const wasOpen = d.open;
    const hiddenBefore = !d.innerText.includes('ずっと先のタスク1');
    d.open = true;
    return { wasOpen, hiddenBefore, opened: d.innerText.includes('ずっと先のタスク1') };
  });
  ok(folded && folded.wasOpen === false, '先の予定は最初たたまれている', JSON.stringify(folded));
  ok(folded && folded.hiddenBefore, 'たたまれている間は先の予定が一覧に出てこない');
  ok(folded && folded.opened, '開けば先の予定も読める');

  const txt = await visibleText(page);
  ok(txt.includes('今日'), '日付の見出しに「今日」が出る');
  ok(txt.includes('明日'), '日付の見出しに「明日」が出る');
  ok(txt.includes('期限なし'), '期限なしのタスクにも見出しが付く');
  ok(txt.includes('14日より先の予定（2件）'), '2週間より先はたたまれる', txt.includes('ずっと先') ? '' : '(中身が読めていません)');

  /* アコーディオンの見出しが右に寄らない（.smt で包む決まり） */
  const smtOk = await page.evaluate(() =>
    Array.prototype.every.call(document.querySelectorAll('#root details.acc > summary'),
      s => !!s.querySelector(':scope > .smt')));
  ok(smtOk, 'アコーディオンの見出しが .smt で包まれている（右寄りにならない）');

  /* ============ D) 分かれても、チェックの挙動は変わらない ============ */
  console.log('\n[D] 枠が分かれてもチェックがずれない');
  const hit = page.locator('#root .list-row[data-tid="n1"] .checkhit');
  const box = await hit.boundingBox();
  const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const ids = ['o1', 'o2', 'n1', 'n2', 'n3', 'n4'];
  const readHeights = () => page.evaluate(list => list.map(id =>
    Math.round(document.querySelector(`#root .list-row[data-tid="${id}"]`).getBoundingClientRect().height)), ids);
  const h0 = await readHeights();
  for (let i = 0; i < 4; i++) { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(300); }
  const st = await page.evaluate(() => { const m = {}; S.tasks.forEach(t => { m[t.id] = !!t.done; }); return m; });
  ok(st.n1 === false && st.n2 === false && st.o1 === false && st.o2 === false && st.n3 === false && st.n4 === false,
    '4回押しても他の行の done が変わらない', JSON.stringify(st));
  const h1 = await readHeights();
  ok(JSON.stringify(h0) === JSON.stringify(h1), '枠が分かれていても行の高さが変わらない', JSON.stringify(h0) + ' → ' + JSON.stringify(h1));

  /* 期限切れの1件を消すと、両方の見出しの件数がその場で直る */
  await page.evaluate(() => {
    const r = document.querySelector('#root .list-row[data-tid="o1"] .checkhit');
    r.click();
  });
  await page.waitForTimeout(120);
  const heads2 = await page.evaluate(() => ({
    over: document.querySelector('#root [data-tk="over"]').textContent,
    open: document.querySelector('#root [data-tk="open"]').textContent,
    done: document.querySelector('#root [data-tk="done"]').textContent,
  }));
  ok(heads2.over === '期限を過ぎた（1）' && heads2.done === '完了済み（2）',
    'チェックすると件数がその場で直る', JSON.stringify(heads2));

  ok(errors.length === 0, 'ここまででJSエラーが出ていない', errors.join(' | '));

  await ctx.close();
  await browser.close();
  summary('tasks');
}

main().catch(e => { console.error(e); process.exit(1); });
