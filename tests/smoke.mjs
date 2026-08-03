/* AO Compass 基本動作テスト（壊れていないことの確認）
   実行: node tests/smoke.mjs                                        */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { openApp, openView, lsWorks, ok, eq, section, finish, APP_PATH } from './helpers.mjs';

/* 画面ごとに必ず出ているはずの見出し */
const VIEW_KEY = {
  home: null,                    /* 状態で見出しが変わるので文字量だけ見る */
  schools: '志望校・入試情報',
  documents: '提出書類',
  interview: '面接対策',
  tasks: 'タスク・締切管理',
  self: '自己分析ワーク',
  settings: '設定',
};
const VIEW_ORDER = ['home', 'schools', 'documents', 'interview', 'tasks', 'self', 'settings'];

async function walkAllViews(page, errors, tag) {
  for (const v of VIEW_ORDER) {
    const r = await openView(page, v);
    ok(r.text.length > 20 && r.nodes > 5, tag + ' ' + v + ' 画面が中身つきで開く（文字数' + r.text.length + '）');
    const key = VIEW_KEY[v];
    if (key) ok(r.text.indexOf(key) >= 0, tag + ' ' + v + ' に見出し「' + key + '」がある');
  }
  ok(errors.length === 0, tag + ' JSエラーが出ない' + (errors.length ? '（' + errors.join(' / ') + '）' : ''));
}

const browser = await chromium.launch();

/* ====================================================================
   1. 何も入っていない状態で7画面
   ==================================================================== */
section('1. 初回（データなし）で7画面が開く');
{
  const { page, ctx, errors } = await openApp(browser);
  ok(await lsWorks(page), 'file:// で localStorage が使える');
  const onb = await page.evaluate(() => document.querySelector('#overlay').classList.contains('open'));
  ok(onb === false, '初回の案内シートが出ていない（__AO_NO_ONBOARD）');
  await walkAllViews(page, errors, '[初回]');
  await ctx.close();
}

/* ====================================================================
   2. 免責の帯とバージョン表記
   ==================================================================== */
section('2. 免責の帯とバージョン');
{
  const { page, ctx, errors } = await openApp(browser);
  const dis = await page.evaluate(() => {
    const d = document.querySelector('.disclaimer');
    if (!d) return null;
    const st = getComputedStyle(d);
    return { text: d.innerText.replace(/\s+/g, ''), shown: st.display !== 'none' && st.visibility !== 'hidden' };
  });
  ok(!!dis, '免責の帯（.disclaimer）がある');
  ok(dis && dis.shown, '免責の帯が常に表示されている');
  ok(dis && dis.text.indexOf('募集要項') >= 0 && dis.text.indexOf('原本を確認') >= 0,
    '「募集要項・原本を確認してください」の文が残っている');
  /* 画面を移動しても消えない */
  await openView(page, 'settings');
  const still = await page.evaluate(() => !!document.querySelector('.disclaimer'));
  ok(still, '画面を切り替えても免責の帯が残る');

  const ver = await page.evaluate(() => APP_VER);
  ok(/^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(ver), 'APP_VER が YYYY.MM.DD の形（' + ver + '）');
  ok(errors.length === 0, 'JSエラーが出ない' + (errors.length ? '（' + errors.join(' / ') + '）' : ''));
  await ctx.close();
}

/* ====================================================================
   3. 必要書類3件 → requiredDocs 3件 → 緊急タスク3件
   ==================================================================== */
section('3. 必要書類の洗い出しと緊急タスク');
{
  const { page, ctx, errors } = await openApp(browser);
  const res = await page.evaluate(() => {
    S.schools.push({
      id: 'sTest', name: 'テスト大学', faculty: '総合政策学部', dept: '政策学科',
      method: '総合型選抜', deadline: isoAdd(todayISO(), 20),
      docs: '志望理由書（800字）、活動報告書、学習計画書',
      checklist: {},
    });
    S.meta.primarySchoolId = 'sTest';
    save(); render();
    const docs = requiredDocs(S.schools[0]);
    const urgent = S.tasks.filter(t => t.docauto && t.urgent && !t.done);
    return { docs: docs, urgent: urgent.map(t => t.title), rows: docCheckup().length };
  });
  eq(res.docs.length, 3, 'requiredDocs が3件返る（' + res.docs.join('・') + '）');
  ok(res.docs.indexOf('志望理由書') === 0, '志望理由書が先頭にくる');
  eq(res.rows, 3, 'docCheckup も3件');
  eq(res.urgent.length, 3, '緊急タスクが3件できる');
  ok(res.urgent.every(t => t.indexOf('テスト大学') >= 0), '緊急タスクに学校名が入っている');

  /* 着手したら緊急タスクが減る */
  const after = await page.evaluate(() => {
    S.documents.push({ id: 'dTest', schoolId: 'sTest', title: 'テスト大学 志望理由書', type: '志望理由書', status: '下書き', body: 'あ'.repeat(120), feedbacks: [], versions: [], paragraphNotes: {}, scoreHistory: [] });
    save(); render();
    return S.tasks.filter(t => t.docauto && t.urgent && !t.done).length;
  });
  eq(after, 2, '本文を書いた書類の緊急タスクは自動で消える');
  ok(errors.length === 0, 'JSエラーが出ない' + (errors.length ? '（' + errors.join(' / ') + '）' : ''));
  await ctx.close();
}

/* ====================================================================
   4. タスクのチェックを同じ座標で4回押す
      → 押した行だけが変わる / 行の高さが変わらない
   ==================================================================== */
section('4. チェックの誤爆と行のずれ');
{
  const state = {
    meta: { primarySchoolId: null }, schools: [], activities: [], documents: [], interview: [], essays: [],
    feedback: [], certs: [],
    tasks: [
      { id: 't1', title: '募集要項を最新版で確認する', due: '2030-01-05', done: false, category: '大学研究' },
      { id: 't2', title: '志望理由書の初稿を書く（ここを押す）', due: '2030-01-06', done: false, category: '書類' },
      { id: 't3', title: '面接練習：志望理由を1分で話す', due: '2030-01-07', done: false, category: '面接' },
      { id: 't4', title: '活動報告書の材料を3行書く', due: '2030-01-08', done: false, category: '書類' },
      { id: 't5', title: '英検の証明書を用意する', due: '2030-01-09', done: false, category: '出願' },
    ],
  };
  const { page, ctx, errors } = await openApp(browser, { state });
  await openView(page, 'tasks');

  const box = await page.evaluate(() => {
    const row = document.querySelector('.list-row[data-tid="t2"]');
    const hit = row.querySelector('.checkhit');
    const b = hit.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const snap = () => page.evaluate(() => {
    const out = { done: {}, h: {}, tidAt: null };
    S.tasks.forEach(t => { out.done[t.id] = !!t.done; });
    document.querySelectorAll('.list-row[data-tid]').forEach(r => {
      out.h[r.getAttribute('data-tid')] = Math.round(r.getBoundingClientRect().height * 10) / 10;
    });
    return out;
  });

  const before = await snap();
  ok(Object.keys(before.h).length >= 5, 'タスクの行が5行ぶん出ている');

  let others = true, heights = true, hitSame = true;
  for (let i = 1; i <= 4; i++) {
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(320); /* 二度押し防止（220ms）を越えて押す */
    const now = await snap();
    /* 押した行の状態は毎回入れ替わる */
    eq(now.done.t2, i % 2 === 1, i + '回目：押した行（t2）の完了が切り替わる');
    /* ほかの行は動かない */
    ['t1', 't3', 't4', 't5'].forEach(id => { if (now.done[id] !== before.done[id]) others = false; });
    /* 行の高さが変わらない（＝下の行がずり上がらない） */
    Object.keys(before.h).forEach(id => { if (Math.abs(now.h[id] - before.h[id]) > 0.6) heights = false; });
    /* 同じ座標が、いまも同じ行のチェック欄か */
    const tidAt = await page.evaluate(p => {
      const e = document.elementFromPoint(p.x, p.y);
      const row = e && e.closest ? e.closest('.list-row[data-tid]') : null;
      return row ? row.getAttribute('data-tid') : null;
    }, box);
    if (tidAt !== 't2') hitSame = false;
  }
  ok(others, '4回押しても、押した行以外の done は変わらない');
  ok(heights, '4回押しても、どの行の高さも変わらない');
  ok(hitSame, '4回押しても、同じ座標はずっと t2 のチェック欄');
  ok(errors.length === 0, 'JSエラーが出ない' + (errors.length ? '（' + errors.join(' / ') + '）' : ''));
  await ctx.close();
}

/* ====================================================================
   5. 古い形のデータを migrate() に通しても全画面が開く
   ==================================================================== */
section('5. 古いデータの読み込み');
{
  /* まだ checklist / feedbacks / versions / prefs / story / interview が無かった頃の形 */
  const old = {
    schools: [{ id: 'a1', name: '旧データ大学', faculty: '文学部', deadline: '2030-10-01', docs: '志望理由書、活動報告書' }],
    documents: [{ id: 'd1', schoolId: 'a1', title: '志望理由書', body: 'わたしは高校で新聞づくりに取り組みました。'.repeat(6), status: '下書き', aiAnalysis: 'これは昔の文字列の形' }],
    tasks: [{ id: 'x1', title: '古いタスク', done: false }],
    activities: [{ id: 'ac1', name: '新聞部' }],
    self: { answers: { q1: '本を読むのが好きです' } },
    meta: { primarySchoolId: 'a1' },
  };
  const { page, ctx, errors } = await openApp(browser, { state: old });

  const shape = await page.evaluate(() => {
    const m = migrate(JSON.parse(JSON.stringify({
      schools: [{ id: 'z', name: 'ふるい大学' }], documents: [{ id: 'zz', title: 'x', aiAnalysis: 'str' }],
    })));
    return {
      hasChecklist: !!(m.schools[0] && typeof m.schools[0].checklist === 'object'),
      docLists: Array.isArray(m.documents[0].feedbacks) && Array.isArray(m.documents[0].versions) && Array.isArray(m.documents[0].scoreHistory),
      aiCleared: m.documents[0].aiAnalysis === null,
      prefs: !!m.prefs && m.prefs.alertDays === 14,
      lists: ['schools', 'activities', 'documents', 'interview', 'essays', 'tasks', 'feedback', 'certs'].every(k => Array.isArray(m[k])),
      tags: !!m.self && !!m.self.tags && Array.isArray(m.self.tags.strengths),
      story: !!m.story && typeof m.story.origin === 'string',
    };
  });
  ok(shape.hasChecklist, 'migrate で checklist が補われる');
  ok(shape.docLists, 'migrate で書類の feedbacks / versions / scoreHistory が配列になる');
  ok(shape.aiCleared, 'migrate で古い形の aiAnalysis が無効化される');
  ok(shape.prefs, 'migrate で prefs が補われる');
  ok(shape.lists, 'migrate で一覧がすべて配列になる');
  ok(shape.tags && shape.story, 'migrate で self.tags と story が補われる');

  const kept = await page.evaluate(() => ({ n: S.schools.length, name: S.schools[0].name, doc: S.documents[0].title }));
  eq(kept.n, 1, '古いデータの志望校が消えていない');
  eq(kept.name, '旧データ大学', '志望校名がそのまま残る');
  eq(kept.doc, '志望理由書', '書類もそのまま残る');
  await walkAllViews(page, errors, '[旧データ]');
  await ctx.close();
}

/* ====================================================================
   6. 単一ファイル・古いiOS Safari向けの約束
   ==================================================================== */
section('6. 約束ごと');
{
  const src = fs.readFileSync(APP_PATH, 'utf8');
  ok(!/\(\?<=/.test(src), '後読み正規表現 (?<=...) を使っていない');
  ok(!/\{\s*\.\.\.[A-Za-z_$]/.test(src), 'オブジェクトスプレッド {...a} を使っていない');
  ok(src.indexOf("LS_BASE='aoCompass_v1'") > 0, '保存キーが aoCompass_v1 のまま');
  ok(src.indexOf('id="root"') > 0, 'ルート要素が #root のまま');
  ok(!/sk-[A-Za-z0-9]{20,}/.test(src), '開発側のAPIキーらしい文字列が埋め込まれていない');
}

await browser.close();
finish();
