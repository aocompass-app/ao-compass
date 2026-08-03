/* 今回入れた改善そのものの確認
   ① ホームに「出願締切が近い順」の一覧が出る（第一志望より先の締切を知らせる）
   ② 第一志望カードに「次の一手」（チェックリストの未完了の先頭）が出る
   実行: node tests/home-deadlines.mjs                                   */
import { chromium } from 'playwright';
import { openApp, openView, ok, eq, section, finish } from './helpers.mjs';

const school = (id, name, dayOffset, extra) => Object.assign({
  id, name, faculty: '総合政策学部', dept: '政策学科', method: '総合型選抜',
  docs: '志望理由書', checklist: {}, _off: dayOffset,
}, extra || {});

/* 締切日は「今日から何日後」で入れる（実行日によらず同じ結果になるように） */
async function seed(page, schools, primaryId) {
  return page.evaluate(arg => {
    S.schools = arg.schools.map(s => {
      const o = Object.assign({}, s);
      o.deadline = (o._off === null) ? '' : isoAdd(todayISO(), o._off);
      delete o._off;
      return o;
    });
    S.meta.primarySchoolId = arg.primaryId;
    save(); go('home');
    return S.schools.length;
  }, { schools, primaryId });
}

function readCard(page, title) {
  return page.evaluate(t => {
    const cards = Array.prototype.slice.call(document.querySelectorAll('#root .card'));
    const c = cards.filter(x => { const h = x.querySelector('.card-title h3'); return h && h.textContent.indexOf(t) >= 0; })[0];
    if (!c) return null;
    return {
      rows: Array.prototype.slice.call(c.querySelectorAll('.list-row')).map(r => (r.innerText || '').replace(/\s+/g, ' ').trim()),
      notes: Array.prototype.slice.call(c.querySelectorAll('.ai-note')).map(n => (n.innerText || '').replace(/\s+/g, ' ').trim()),
      headBadge: (function () { const b = c.querySelector('.card-title .badge'); return b ? b.textContent : ''; })(),
      buttons: Array.prototype.slice.call(c.querySelectorAll('button')).map(b => b.textContent),
      tail: (c.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  }, title);
}

const browser = await chromium.launch();
const { page, ctx, errors } = await openApp(browser);

/* ==================================================================
   1. 第一志望より先に締切が来る学校があるとき
   ================================================================== */
section('1. 第一志望より先に締切が来る学校を知らせる');
await seed(page, [
  school('s1', '甲山大学', 60),
  school('s2', '乙川大学', 20),
  school('s3', '丙野大学', 90),
], 's1');
{
  const c = await readCard(page, '出願締切が近い順');
  ok(!!c, '「出願締切が近い順」カードがホームに出る');
  const names = c.rows.map(r => r.split(' ')[0]);
  eq(names.join(' > '), '乙川大学 > 甲山大学 > 丙野大学', '締切が早い順に並ぶ');
  ok(c.headBadge.indexOf('あと20日') >= 0, '見出しに最短の残り日数が出る（' + c.headBadge + '）');
  ok(c.notes.length === 1 && c.notes[0].indexOf('乙川大学') >= 0 && c.notes[0].indexOf('甲山大学') >= 0,
    '第一志望より先に締切が来ることを知らせる文が出る');
  ok(c.notes[0].indexOf('あと20日') >= 0, '知らせる文に残り日数が入っている');
  ok(c.rows.filter(r => r.indexOf('第一志望') >= 0).length === 1, '第一志望の印がちょうど1件つく');
  ok(c.rows[0].indexOf('あと20日') >= 0, '各行に残り日数が出る');
  ok(c.tail.indexOf('募集要項の原本') >= 0, 'カードの中でも要項の原本確認を促している');
}

/* ==================================================================
   2. 第一志望がいちばん早いときは、余計な警告を出さない
   ================================================================== */
section('2. 第一志望がいちばん早いときは警告を出さない');
await seed(page, [
  school('s1', '甲山大学', 20),
  school('s2', '乙川大学', 60),
], 's1');
{
  const c = await readCard(page, '出願締切が近い順');
  ok(!!c, '2校あればカードは出る');
  eq(c.notes.length, 0, '警告の文は出ない');
  eq(c.rows.length, 2, '2行ならぶ');
}

/* ==================================================================
   3. 締切が未入力の学校・締切が過ぎた学校の並び
   ================================================================== */
section('3. 未設定と締切済のあつかい');
await seed(page, [
  school('s1', '甲山大学', 40),
  school('s2', '未定大学', null),
  school('s3', '過去大学', -10),
], 's1');
{
  const c = await readCard(page, '出願締切が近い順');
  const names = c.rows.map(r => r.split(' ')[0]);
  eq(names.join(' > '), '甲山大学 > 未定大学 > 過去大学', '未設定→締切済 が下にくる');
  ok(c.rows[1].indexOf('締切未設定') >= 0, '締切未入力は「締切未設定」と分かる');
  ok(c.rows[1].indexOf('締切を入れる') >= 0, '締切未入力の学校には「締切を入れる」ボタンが出る');
  ok(c.rows[2].indexOf('締切済') >= 0, '締切が過ぎた学校は「締切済」と分かる');
  eq(c.notes.length, 0, '締切が過ぎた学校を「先に締切が来る」と誤って知らせない');
}
/* 「締切を入れる」で編集シートが開く */
{
  await page.evaluate(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#root .card .list-row'));
    const r = rows.filter(x => (x.innerText || '').indexOf('締切を入れる') >= 0)[0];
    r.querySelector('button').click();
  });
  await page.waitForTimeout(120);
  const sheet = await page.evaluate(() => ({
    open: document.querySelector('#overlay').classList.contains('open'),
    text: (document.querySelector('#sheet').innerText || '').replace(/\s+/g, ' '),
  }));
  ok(sheet.open && sheet.text.indexOf('出願締切') >= 0, '「締切を入れる」を押すと締切を入力できる画面が開く');
  await page.evaluate(() => closeSheet());
}

/* ==================================================================
   4. 1校だけ・0校のときは出さない（画面をむだに長くしない）
   ================================================================== */
section('4. 出さない場合');
await seed(page, [school('s1', '甲山大学', 30)], 's1');
{
  const c = await readCard(page, '出願締切が近い順');
  ok(c === null, '1校で締切も入っていればカードは出さない（上のカードと重複するため）');
}
await seed(page, [school('s1', '甲山大学', null)], 's1');
{
  const c = await readCard(page, '出願締切が近い順');
  ok(!!c, '1校でも締切が未入力なら、入力できるようカードを出す');
  ok(c && c.rows[0].indexOf('締切を入れる') >= 0, 'その1校に「締切を入れる」ボタンが出る');
}
await page.evaluate(() => { S.schools = []; S.meta.primarySchoolId = null; save(); go('home'); });
{
  const c = await readCard(page, '出願締切が近い順');
  ok(c === null, '志望校が0校ならカードは出さない');
}

/* ==================================================================
   5. 第一志望カードの「次の一手」
   ================================================================== */
section('5. 次の一手');
await seed(page, [school('s1', '甲山大学', 30), school('s2', '乙川大学', 60)], 's1');
const heroText = () => page.evaluate(() => (document.querySelector('#root .card').innerText || '').replace(/\s+/g, ' '));
{
  ok((await heroText()).indexOf('次の一手： 募集要項を最新版で確認') >= 0
    || (await heroText()).indexOf('次の一手：募集要項を最新版で確認') >= 0, '未チェックなら先頭項目が「次の一手」に出る');

  const t2 = await page.evaluate(() => { S.schools[0].checklist = { req: true, gpa: true }; save(); go('home'); return (document.querySelector('#root .card').innerText || '').replace(/\s+/g, ' '); });
  ok(t2.indexOf('志望理由書／自己推薦書を作成') >= 0, '済んだぶんを飛ばして、次の未完了項目が出る');
  ok(t2.indexOf('20%') >= 0, '進捗の％も一緒に合う（2/10）');

  const t3 = await page.evaluate(() => {
    const cl = {}; CHECK_ITEMS.forEach(it => { cl[it[0]] = true; });
    S.schools[0].checklist = cl; save(); go('home');
    return { text: (document.querySelector('#root .card').innerText || '').replace(/\s+/g, ' '), pr: schoolProgress(S.schools[0]) };
  });
  ok(t3.text.indexOf('すべて済みました') >= 0, '全部チェック済みなら、原本の確認をすすめる文に変わる');
  eq(t3.pr, 100, '全部チェックで進捗100%');
  ok(t3.text.indexOf('次の一手') < 0, '全部済んだら「次の一手」は出さない');
  ok(!/合格(でき|間違い|確実|保証)/.test(t3.text), '合格を保証する言い方をしていない');
}

/* ==================================================================
   6. 志望校シートのチェックリストが壊れていない（項目の共通化ぶん）
   ================================================================== */
section('6. チェックリストの共通化');
{
  const r = await page.evaluate(() => {
    S.schools[0].checklist = {}; save(); go('schools'); openSchool('s1');
    const rows = Array.prototype.slice.call(document.querySelectorAll('#sheet .list-row'));
    const labels = rows.map(x => (x.innerText || '').trim()).filter(Boolean);
    return { n: CHECK_ITEMS.length, labels: labels, keys: CHECK_ITEMS.map(i => i[0]).join(',') };
  });
  eq(r.n, 10, 'チェックリストは10項目');
  eq(r.keys, 'req,gpa,doc_ao,doc_katsu,eng,photo,web,fee,mail,mensetsu', '項目のキーは以前と同じ（保存済みデータと食い違わない）');
  ok(r.labels.indexOf('募集要項を最新版で確認') >= 0 && r.labels.indexOf('面接・プレゼン資料を提出') >= 0, 'シートに項目名が並ぶ');

  /* 押したら保存され、ホームの「次の一手」に反映される */
  const after = await page.evaluate(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#sheet .list-row'));
    const target = rows.filter(x => (x.innerText || '').indexOf('募集要項を最新版で確認') >= 0)[0];
    target.querySelector('.checkhit').click();
    const saved = !!(JSON.parse(localStorage.getItem('aoCompass_v1')).schools[0].checklist.req);
    closeSheet(); go('home');
    return { saved: saved, home: (document.querySelector('#root .card').innerText || '').replace(/\s+/g, ' ') };
  });
  ok(after.saved, 'チェックが localStorage に保存される');
  ok(after.home.indexOf('評定条件') >= 0, 'ホームの「次の一手」が次の項目に進む');
}

/* ==================================================================
   7. 締切の行を押すと志望校の詳細が開く / JSエラーなし
   ================================================================== */
section('7. 導線とエラー');
{
  await seed(page, [school('s1', '甲山大学', 60), school('s2', '乙川大学', 20)], 's1');
  await page.evaluate(() => {
    const cards = Array.prototype.slice.call(document.querySelectorAll('#root .card'));
    const c = cards.filter(x => { const h = x.querySelector('.card-title h3'); return h && h.textContent.indexOf('出願締切が近い順') >= 0; })[0];
    c.querySelector('.list-row button').click();
  });
  await page.waitForTimeout(200);
  const sheet = await page.evaluate(() => ({
    open: document.querySelector('#overlay').classList.contains('open'),
    text: (document.querySelector('#sheet').innerText || '').replace(/\s+/g, ' '),
  }));
  ok(sheet.open && sheet.text.indexOf('乙川大学') >= 0, '締切の行の「開く」でその学校の詳細が開く');
  ok(sheet.text.indexOf('原本') >= 0, '詳細でも原本確認の注意が出る');
  await page.evaluate(() => closeSheet());

  /* ホーム以外の画面も引き続き開く */
  for (const v of ['home', 'schools', 'documents', 'interview', 'tasks', 'self', 'settings']) {
    const r = await openView(page, v);
    ok(r.text.length > 20, v + ' 画面が引き続き開く');
  }
  ok(errors.length === 0, 'JSエラーが出ない' + (errors.length ? '（' + errors.join(' / ') + '）' : ''));
}

await ctx.close();
await browser.close();
finish();
