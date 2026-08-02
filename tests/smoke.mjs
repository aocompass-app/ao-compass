/* AO Compass — 基本動作の確認（playwright）
   使い方: node tests/smoke.mjs
   index.html を file:// で 390x844（スマホ相当）で開いて、
   壊れていないことだけを確かめます。アプリ本体は変更しません。 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(HERE, '..', 'index.html');

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('  ✓ ' + name); };
const ng = (name, detail) => { fail++; console.log('  ✗ ' + name + (detail ? '\n      → ' + detail : '')); };
function check(name, cond, detail) { cond ? ok(name) : ng(name, detail); }

/* 毎回まっさらな状態でアプリを開く */
export async function openApp(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.__AO_NO_ONBOARD = 1; });
  if (seed) {
    await page.addInitScript((s) => {
      try { localStorage.setItem('aoCompass_v1', JSON.stringify(s)); } catch (e) {}
    }, seed);
  }
  await page.goto(FILE);
  await page.waitForSelector('#root');
  await page.waitForTimeout(150);
  return { ctx, page, errors };
}

export const VIEWS = ['home', 'schools', 'documents', 'interview', 'tasks', 'self', 'settings'];

export async function gotoView(page, v) {
  await page.evaluate((x) => window.go(x), v);
  await page.waitForTimeout(120);
}

/* テスト用の志望校（必要書類を3件書いたもの） */
export function seedWithSchool() {
  return {
    meta: { primarySchoolId: 's1', demoLoaded: true },
    profile: { name: 'テスト', onboarded: true },
    schools: [{
      id: 's1', name: 'テスト大学', faculty: '総合政策学部', dept: '総合政策学科',
      method: '総合型選抜', deadline: '2099-09-15', examDate: '2099-10-01',
      resultDate: '2099-11-01', entryStart: '2099-08-01',
      docs: '志望理由書、活動報告書、学習計画書', checklist: {}
    }],
    activities: [], documents: [], interview: [], essays: [], tasks: [],
    feedback: [], certs: []
  };
}

async function main() {
  const browser = await chromium.launch();

  /* ---- 1. 7つの画面が中身つきで開き、JSエラーが出ない ---- */
  console.log('\n[1] 7画面が開くか');
  {
    const { ctx, page, errors } = await openApp(browser, seedWithSchool());
    for (const v of VIEWS) {
      await gotoView(page, v);
      const info = await page.evaluate(() => {
        const r = document.querySelector('#root');
        /* view / APP_VER は let・const なので window には生えません。素の名前で読みます */
        return { view: view, len: (r.innerText || '').replace(/\s/g, '').length, kids: r.children.length };
      });
      check(`${v} が中身つきで開く（${info.len}文字）`, info.view === v && info.kids > 0 && info.len > 20,
        JSON.stringify(info));
    }
    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---- 2. 必要書類3件 → requiredDocs が3件、緊急タスクも3件 ---- */
  console.log('\n[2] 必要書類の洗い出しと緊急タスク');
  {
    const { ctx, page, errors } = await openApp(browser, seedWithSchool());
    await gotoView(page, 'schools');
    const r = await page.evaluate(() => {
      const s = S.schools[0];
      const labels = requiredDocs(s);
      syncDocTasks();
      const auto = S.tasks.filter((t) => t.docauto && !t.done);
      return { labels, autoTitles: auto.map((t) => t.title), urgent: auto.every((t) => t.urgent) };
    });
    check('requiredDocs が3件返る: ' + r.labels.join('/'), r.labels.length === 3, JSON.stringify(r.labels));
    check('志望理由書が先頭', r.labels[0] === '志望理由書', r.labels[0]);
    check('緊急タスクが3件できる', r.autoTitles.length === 3, JSON.stringify(r.autoTitles));
    check('緊急タスクに urgent が付く', r.urgent === true);
    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---- 3. 同じ座標で4回押しても、押した行以外の done が変わらない・行の高さも変わらない ---- */
  console.log('\n[3] タスクのチェックが隣の行にずれない');
  {
    const seed = seedWithSchool();
    seed.tasks = [];
    for (let i = 1; i <= 6; i++) {
      seed.tasks.push({
        id: 't' + i, title: 'テスト用のタスク' + i + '（本文の長さを揃えるための文章です）',
        due: '2099-09-01', done: false, category: '書類'
      });
    }
    const { ctx, page, errors } = await openApp(browser, seed);
    await gotoView(page, 'tasks');

    const rows = page.locator('.list-row[data-tid]');
    const n = await rows.count();
    check('タスク行が描画される（' + n + '行）', n >= 6);

    /* 自動生成される緊急タスクも混ざるので、行は id で指名します */
    const targetId = 't2';
    const target = page.locator('.list-row[data-tid="' + targetId + '"]');
    /* 画面の外にある行は指で押せないので、まず見える位置まで送ります */
    await target.scrollIntoViewIfNeeded();
    /* 文字の読み込みで全体が 1px ほど落ち着くまで待ってから基準を取ります */
    await page.waitForTimeout(700);
    const hit = await target.locator('.checkhit').boundingBox();
    const pt = { x: Math.round(hit.x + hit.width / 2), y: Math.round(hit.y + hit.height / 2) };
    check('押す座標が画面の中にある', pt.y > 0 && pt.y < 844, JSON.stringify(pt));

    /* 行の高さと「文書内での位置」（スクロールに左右されない）を記録 */
    const geo = () => rows.evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.dataset.tid, top: r.top + window.scrollY, h: r.height };
    }));
    const before = await geo();

    /* 同じ座標を4回。押すたびに対象行だけが反転し、他は不動であること */
    for (let i = 0; i < 4; i++) {
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(320); /* tapOK の 220ms より長く待つ */
      const st = await page.evaluate((id) => ({
        self: !!S.tasks.find((t) => t.id === id).done,
        others: S.tasks.filter((t) => t.id !== id).map((t) => !!t.done)
      }), targetId);
      const expected = (i % 2 === 0);
      check(`${i + 1}回目: 押した行が ${expected ? '完了' : '未完了'} になる`, st.self === expected, JSON.stringify(st));
      check(`${i + 1}回目: 他の行の done が変わらない`, st.others.every((x) => x === false), JSON.stringify(st.others));
      /* 指の下にあるのが最後まで同じ行であること（これがずれると隣の行にチェックが入る） */
      const under = await page.evaluate((p) => {
        const e = document.elementFromPoint(p.x, p.y);
        const row = e && e.closest && e.closest('.list-row[data-tid]');
        return row ? row.dataset.tid : null;
      }, pt);
      check(`${i + 1}回目: 同じ座標の下にあるのが同じ行`, under === targetId, '実際: ' + under);
    }

    const after = await geo();
    check('行の並びが変わらない', before.map((x) => x.id).join() === after.map((x) => x.id).join());
    check('行の高さが変わらない',
      before.every((x, i) => Math.abs(x.h - after[i].h) < 0.5),
      JSON.stringify(before.map((x) => x.h)) + ' → ' + JSON.stringify(after.map((x) => x.h)));
    const moved = before.map((x, i) => Math.abs(x.top - after[i].top));
    check('行が上下にずれない（最大 ' + Math.max.apply(null, moved).toFixed(2) + 'px）',
      moved.every((d) => d < 1), JSON.stringify(moved));
    check('最後は全タスクが未完了に戻っている',
      (await page.evaluate(() => S.tasks.every((t) => !t.done))) === true);
    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---- 4. 古い形のデータを migrate に通しても全画面が開く ---- */
  console.log('\n[4] 古いデータの読み込み');
  {
    /* 昔のバージョンで保存されたつもりの、項目が足りないデータ */
    const old = {
      schools: [{ id: 'x1', name: '昔の大学', deadline: '2099-09-01' }],
      documents: [{ id: 'd1', schoolId: 'x1', title: '昔の志望理由書', body: 'むかしの本文です。' }],
      tasks: [{ id: 'k1', title: '昔のタスク', due: '2099-08-20' }]
    };
    const { ctx, page, errors } = await openApp(browser, old);
    const mg = await page.evaluate((raw) => {
      const m = migrate(raw);
      return {
        keys: Object.keys(m).sort(),
        docFixed: Array.isArray(m.documents[0].feedbacks) && Array.isArray(m.documents[0].versions)
          && Array.isArray(m.documents[0].scoreHistory) && typeof m.documents[0].paragraphNotes === 'object',
        checklist: typeof m.schools[0].checklist === 'object',
        prefs: !!m.prefs && !!m.self && !!m.self.tags && Array.isArray(m.self.tags.strengths),
        kept: m.schools[0].name === '昔の大学' && m.documents[0].body === 'むかしの本文です。'
      };
    }, old);
    check('足りない配列が補われる', mg.docFixed, JSON.stringify(mg));
    check('checklist が用意される', mg.checklist);
    check('prefs / self.tags が用意される', mg.prefs);
    check('元のデータが消えない', mg.kept);

    for (const v of VIEWS) {
      await gotoView(page, v);
      const len = await page.evaluate(() => (document.querySelector('#root').innerText || '').replace(/\s/g, '').length);
      check(`古いデータでも ${v} が開く（${len}文字）`, len > 20);
    }
    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---- 5. 免責の帯とバージョン表記 ---- */
  console.log('\n[5] 免責表示とバージョン');
  {
    const { ctx, page, errors } = await openApp(browser, seedWithSchool());
    await gotoView(page, 'schools');
    const t = await page.evaluate(() => document.querySelector('#root').innerText);
    check('志望校画面に「募集要項」の免責が出ている', t.includes('募集要項') && t.includes('必ず'), t.slice(0, 120));

    const ver = await page.evaluate(() => APP_VER);
    check('APP_VER が YYYY.MM.DD の形（' + ver + '）', /^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(ver), String(ver));

    const html = await page.content();
    check('免責の一文がファイルに残っている', html.includes('募集要項'));
    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(`\n===== 合計 ${pass + fail} 件 / 成功 ${pass} / 失敗 ${fail} =====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
