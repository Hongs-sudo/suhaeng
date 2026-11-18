// 3단계(Preview · 테스트 · Review) 화면: 홈, 채점, 회차·세트, 세트 편집, Review 구성, 문제은행, 학습지 인쇄
import { STAGES, TERM, termKey, termLabel, unitsOf, unitOf, setKey, resultKey, isLegacyTerm } from "./curriculum.js?v=8";
import { BANK, RES, ensureBank, getFigure } from "./bankcache.js?v=8";
import { requestExtract, requestVariant } from "./bankai.js?v=8";
import { filesToJpegs, shrinkBlob, filesToPageBlobs, blobToDataURL } from "./analyze.js?v=8";
import { esc, fmt } from "./report.js?v=8";

let C = null; // main.js 가 넘겨 주는 공통 도구 {S, main, $, $$, toast, busy, recs, stu, sheet, closeSheet, scored, isAdmin}
export function initThree(ctx) { C = ctx; }

/* ---------------------------------------------------------------- 공통 */
const SRC = { textbook: ["교과서", "c-tb"], db: ["내 문제 DB", "c-db"], old: ["기존 수행", "c-old"], ai: ["AI 변형", "c-ai"] };
const srcChip = it => { const s = SRC[(it.source || {}).type] || ["기타", ""]; return `<span class="chip ${s[1]}">${s[0]}${it.source && it.source.ref ? " · " + esc(it.source.ref) : ""}</span>`; };
const stars = d => `<span class="dif">${"★".repeat(Math.max(1, Math.min(3, +d || 1)))}</span>`;
export function math(el) {
  if (!el || !window.renderMathInElement) return;
  try { window.renderMathInElement(el, { delimiters: [{ left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }], throwOnError: false }); } catch (e) { /* 수식 오류는 원문 그대로 둔다 */ }
}
// 본문은 수식(\( \))만 KaTeX로 그리고 나머지는 글자 그대로
const bodyHTML = t => esc(t || "").replace(/\n/g, "<br>");
async function paintFigs(root) {
  for (const im of root.querySelectorAll("img[data-fig]")) {
    const src = await getFigure(C.S.store, im.dataset.fig);
    if (src) { im.src = src; im.hidden = false; } else im.remove();
  }
}
const figTag = it => it.figId ? `<img class="qfig" data-fig="${esc(it.figId)}" alt="문항 그림" hidden>` : "";
const active = () => C.S.students.filter(s => s.status === "재원");
const mineOrAll = list => { const m = list.filter(s => s.teacher === C.S.user.name); return m.length ? m : list; };
const res = (sid, r, stage) => RES.results[resultKey(sid, TERM, r, stage)];
const rv = (sid, r) => RES.reviews[`${sid}_${termKey()}_${r}`];
const testRec = (sid, r) => C.recs(sid)[r];
const testScore = (sid, r) => { const x = testRec(sid, r); return C.scored(x) ? x.score : null; };
const stScore = (sid, r, stage) => stage === "test" ? testScore(sid, r) : (x => x && x.status === "응시" && typeof x.score === "number" ? x.score : null)(res(sid, r, stage));
const done = (sid, r, stage) => stage === "test" ? !!testRec(sid, r) : !!res(sid, r, stage);

// 학년별 '지금 회차' = 가장 최근에 테스트를 본 회차 (없으면 Preview 결과, 그것도 없으면 1회)
function curRound(g) {
  let best = null;
  active().filter(s => s.grade === g).forEach(s => Object.entries(C.recs(s.id)).forEach(([r, x]) => { if (x && x.date && (!best || x.date > best.date)) best = { r: +r, date: x.date }; }));
  if (best) return best.r;
  let r0 = 1; Object.values(RES.results).forEach(x => { const st = C.stu(x.sid); if (st && st.grade === g && x.stage === "preview") r0 = Math.max(r0, x.round); });
  return r0;
}
const setOf = (sem, g, r) => BANK.sets[setKey(sem, g, r)] || {};
const filled = a => (a || []).filter(Boolean).length;

/* ================================================================ 홈 */
export function viewHome() {
  const { S, main } = C;
  const studs = active();
  const cr = { 1: curRound(1), 2: curRound(2), 3: curRound(3) };
  const same = cr[1] === cr[2] && cr[2] === cr[3];
  const atCur = s => cr[s.grade];
  const tot = studs.length || 1;
  const cnt = st => studs.filter(s => done(s.id, atCur(s), st)).length;
  const nP = cnt("preview"), nT = studs.filter(s => testScore(s.id, atCur(s)) != null).length, nTin = cnt("test");
  const nRi = studs.filter(s => (rv(s.id, atCur(s)) || {}).issued).length, nRg = cnt("review");
  const pend = studs.reduce((a, s) => a + Object.values(C.recs(s.id)).filter(x => x && x.pending).length, 0);
  const toIssue = studs.filter(s => testScore(s.id, atCur(s)) != null && !(rv(s.id, atCur(s)) || {}).issued);
  const absent = studs.filter(s => !testRec(s.id, atCur(s)) && studs.some(o => o.grade === s.grade && testRec(o.id, atCur(o))));
  const nextReady = [1, 2, 3].filter(g => setOf(TERM.sem, g, Math.min(10, cr[g] + 1)).previewOk).length;
  const rep = r => r <= 5 ? "1차 리포트 (1~5회)" : "2차 리포트 (6~10회)";
  const bar = (n, d) => `<div class="m"><span style="width:${Math.round(100 * n / d)}%"></span></div>`;

  const grid = [1, 2, 3].map(g => {
    const gs = studs.filter(s => s.grade === g), n = gs.length || 1;
    const cells = Array.from({ length: 10 }, (_, i) => {
      const r = i + 1, f = st => gs.filter(s => done(s.id, r, st)).length / n;
      const w = [f("preview"), f("test"), f("review")].map(x => `<i style="--w:${Math.round(x * 100)}%"></i>`).join("");
      return `<a class="cell3 ${r === cr[g] ? "cur" : ""}" href="#/grade/test/${g}/${r}" title="중${g} ${r}회 ${esc(unitOf(g, r))}">${w}</a>`;
    }).join("");
    return `<span class="g">중${g}</span>${cells}`;
  }).join("");

  const mine = mineOrAll(studs).slice().sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, "ko"));
  const nextAct = s => {
    const r = atCur(s), x = testRec(s.id, r);
    if (x && x.pending) return [`채점 확인`, `#/a/${s.id}/${r}`, "b"];
    if (!res(s.id, r, "preview")) return [`Preview 채점`, `#/grade/preview/${s.grade}/${r}`, "b"];
    if (!x) return [`테스트 입력`, `#/s/${s.id}/${r}`, "c"];
    const v = rv(s.id, r);
    if (!v || !v.issued) return [`Review 발급`, `#/rv/${s.id}/${r}`, "a"];
    if (!res(s.id, r, "review")) return [`Review 채점`, `#/grade/review/${s.grade}/${r}`, "a"];
    return [`${Math.min(10, r + 1)}회 Preview`, `#/grade/preview/${s.grade}/${Math.min(10, r + 1)}`, "b"];
  };
  const sc = v => v == null ? "—" : `${fmt(v)}<small>/50</small>`;
  const avg = st => { const v = studs.map(s => stScore(s.id, atCur(s), st)).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const items = Object.values(BANK.items);
  const bySrc = t => items.filter(it => (it.source || {}).type === t).length;
  const maxSrc = Math.max(1, ...["textbook", "db", "old", "ai"].map(bySrc));
  const sched = TERM.sem === 1
    ? [["3월", "1~2회"], ["4월", "3~5회"], ["4월 말", "1차 리포트 (1~5회)", 1], ["5~6월", "6~9회"], ["7월", "10회"], ["7월 말", "2차 리포트 (6~10회)", 1]]
    : [["9월", "1~2회"], ["10월", "3~5회"], ["10월 말", "1차 리포트 (1~5회)", 1], ["11월", "6~9회"], ["12월", "10회"], ["12월 말", "2차 리포트 (6~10회)", 1]];

  main.innerHTML = `<div class="home">
    <div class="hello"><div><h1>${same ? `이번 회차 · ${termLabel()} ${cr[1]}회차` : `이번 회차 · ${termLabel()}`}</h1>
      <div class="muted small">${[1, 2, 3].map(g => `중${g} ${cr[g]}회 ${esc(unitOf(g, cr[g]))}`).join(" · ")}</div></div></div>
    <div class="home-grid"><div class="home-main">
      <div class="flowband">
        <a class="fb" href="#/grade/preview"><i>STEP 1</i><b>Preview</b>${bar(nP, tot)}<small class="num">채점 ${nP} / ${studs.length}</small></a>
        <a class="fb" href="#/grade/test"><i>STEP 2</i><b>테스트</b>${bar(nT, tot)}<small class="num">응시 ${nTin} / ${studs.length} · 채점 ${nT}</small></a>
        <a class="fb" href="#/review"><i>STEP 3</i><b>Review</b>${bar(nRg, tot)}<small class="num">발급 ${nRi} · 채점 ${nRg}</small></a>
        <a class="fb rp" href="#/reports"><i>5회차마다</i><b>리포트</b><small>${rep(cr[1])}</small></a>
      </div>
      <div class="todos">
        <a class="tdc ${pend ? "hot" : ""}" href="#/bulk"><b class="num">${pend}</b><span>채점 확인 대기</span><small>AI 분석 끝 · 확인하고 저장</small></a>
        <a class="tdc ${toIssue.length ? "hot" : ""}" href="#/review"><b class="num">${toIssue.length}</b><span>Review 발급 대기</span><small>테스트 채점이 끝난 학생</small></a>
        <a class="tdc" href="#/sets"><b class="num">${nextReady}<small>/3</small></b><span>다음 회차 Preview</span><small>확정된 학년 수</small></a>
        <a class="tdc" href="#/grade/test"><b class="num">${absent.length}</b><span>테스트 미응시</span><small>결시 · 보충 일정 잡기</small></a>
      </div>
      <section class="card prog"><div class="hd"><h2>학년별 진행</h2><span class="leg"><span>칸마다 위에서부터 Preview · 테스트 · Review</span><span><i class="lg on"></i>끝난 학생 비율</span><span><i class="lg cur"></i>지금 회차</span></span></div>
        <div class="tblwrap"><div class="prg"><span></span>${Array.from({ length: 10 }, (_, i) => `<span class="h">${i + 1}</span>`).join("")}${grid}</div></div></section>
      <section class="card"><div class="hd2"><h2>${mine.some(s => s.teacher === S.user.name) ? "내 학생" : "학생"} <small class="muted">· 지금 회차</small></h2><a class="btn sm" href="#/students">학생 전체</a></div>
        <div class="tblwrap"><table class="stu3"><thead><tr><th>학생</th><th>회차</th><th>Preview</th><th>테스트</th><th>Review</th><th>다음 할 일</th></tr></thead><tbody>
        ${mine.slice(0, 30).map(s => { const r = atCur(s), [t, h, c] = nextAct(s);
          return `<tr><td><a href="#/s/${s.id}"><b>${esc(s.name)}</b> <small class="muted">중${s.grade}</small></a></td><td class="num">${r}회</td><td class="s num">${sc(stScore(s.id, r, "preview"))}</td><td class="s num">${testRec(s.id, r) && !C.scored(testRec(s.id, r)) ? esc(testRec(s.id, r).status || "확인 대기") : sc(testScore(s.id, r))}</td><td class="s num">${sc(stScore(s.id, r, "review"))}</td><td><a class="nx ${c}" href="${h}">${t}</a></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty-state">재원 학생이 없습니다.</td></tr>`}
        </tbody></table></div></section>
    </div>
    <aside class="home-side">
      <section class="card"><h2>빠른 실행</h2><div class="quick">
        <a class="btn fill" href="#/grade/preview">점수 · 오답 입력</a><a class="btn" href="#/bulk">시험지 스캔 올리기</a>
        <a class="btn" href="#/sets">학습지 인쇄</a><a class="btn" href="#/review">Review 발급</a></div></section>
      <section class="card"><h2>${termLabel()} 일정</h2><div class="cal">${sched.map(([a, b, rp]) => `<div><span>${a}</span><span class="${rp ? "rep" : ""}">${b}</span></div>`).join("")}</div></section>
      <section class="card"><h2>지금 회차 평균 <small class="muted">(채점 끝난 학생)</small></h2>
        ${STAGES.map(st => { const a = avg(st.key); return `<div class="minibar"><span>${st.name}</span><span class="b"><span style="width:${a == null ? 0 : Math.round(a * 2)}%"></span></span><b class="num">${a == null ? "–" : fmt(a)}</b></div>`; }).join("")}</section>
      <section class="card"><h2>문제은행 <a class="small" href="#/bank" style="float:right">열기</a></h2>
        ${[["textbook", "교과서"], ["db", "내 문제 DB"], ["old", "기존 수행"], ["ai", "AI 변형"]].map(([k, n]) => `<div class="minibar"><span>${n}</span><span class="b"><span style="width:${Math.round(100 * bySrc(k) / maxSrc)}%"></span></span><b class="num">${bySrc(k).toLocaleString()}</b></div>`).join("")}
        ${BANK.loaded ? "" : `<p class="small muted" style="margin:6px 0 0">문제은행을 여는 중이에요.</p>`}</section>
    </aside></div></div>`;
  if (!BANK.loaded) ensureBank(S.store).then(() => { if ((location.hash || "#/") === "#/") viewHome(); }).catch(() => {});
}

/* ================================================================ 채점 (Preview · 테스트 · Review) */
export function viewGrade(stage = "preview", g = 0, r = 0) {
  const { S, main } = C;
  const G = S.gr = S.gr || { mine: null };
  g = g || G.g || 1; r = r || curRound(g); G.g = g;
  if (G.mine == null) G.mine = S.students.some(s => s.teacher === S.user.name);
  let list = active().filter(s => s.grade === g && (!G.mine || s.teacher === S.user.name)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const pend = S.students.reduce((a, s) => a + Object.values(C.recs(s.id)).filter(x => x && x.pending).length, 0);
  const head = `<div class="page-head"><h1>채점</h1><span class="sp"></span><span class="muted small">${termLabel()}</span></div>
    <div class="stage-tabs">${STAGES.map(st => `<a href="#/grade/${st.key}/${g}/${r}" aria-current="${st.key === stage ? "page" : "false"}"><i>STEP ${st.step}</i>${st.name}</a>`).join("")}</div>
    <div class="list-tools"><div class="chips">${[1, 2, 3].map(x => `<a class="chipa" href="#/grade/${stage}/${x}/${curRound(x)}" aria-pressed="${x === g}">중${x}</a>`).join("")}
      <select class="input sm" id="rsel" aria-label="회차">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${i + 1 === r ? "selected" : ""}>${i + 1}회 · ${esc(unitOf(g, i + 1))}</option>`).join("")}</select>
      <button class="chipb" id="mine" aria-pressed="${!!G.mine}">내 학생만</button></div></div>`;
  if (stage === "test") {
    main.innerHTML = head + `<div class="card note-card"><p>테스트는 지금처럼 <b>점수 입력 → 시험지 스캔 → AI 분석 → 확인하고 저장</b> 순서예요. 학생 이름을 누르면 점수 입력 창이 열려요.</p>
      <div class="rowx"><a class="btn fill" href="#/bulk">시험지 일괄 올리기</a>${pend ? `<a class="btn gold" href="#/bulk">확인 대기 <b class="num">${pend}</b>건</a>` : ""}</div></div>
      <div class="tblwrap"><table class="mtab"><thead><tr><th>학생</th><th>상태</th><th class="num">점수</th><th>분석</th></tr></thead><tbody>
      ${list.map(s => { const x = testRec(s.id, r); return `<tr><td><a href="#/s/${s.id}/${r}"><b>${esc(s.name)}</b></a> <small class="muted">${esc(s.school || "")}</small></td><td>${x ? esc(x.status || "응시") : `<span class="muted">미입력</span>`}</td><td class="num">${x && typeof x.score === "number" ? fmt(x.score) : "–"}</td><td>${x && x.analyzed ? `<a class="nx b" href="#/a/${s.id}/${r}">분석 완료</a>` : x && x.pending ? `<a class="nx a" href="#/a/${s.id}/${r}">확인 대기</a>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty-state">학생이 없습니다.</td></tr>`}
      </tbody></table></div>`;
  } else {
    const set = setOf(TERM.sem, g, r);
    const ids = stage === "preview" ? (set.preview || []) : null;
    main.innerHTML = head + `<div class="card note-card"><p>${stage === "preview" ? "Preview는 학년 공통 10문항이에요." : "Review는 학생마다 문항이 달라요. 발급된 학생만 채점할 수 있어요."} 칸을 눌러 문항 점수를 고르면 바로 저장돼요. <b>5</b>는 맞음, <b>0</b>은 틀림, 그 사이는 부분 점수예요.</p>
      ${stage === "preview" && !set.previewOk ? `<p class="warn-line">이 회차 Preview 세트가 아직 확정되지 않았어요. <a href="#/set/${TERM.sem}/${g}/${r}">세트 만들기</a></p>` : ""}</div>
      <div class="tblwrap"><table class="mtab"><thead><tr><th>학생</th>${Array.from({ length: 10 }, (_, i) => `<th class="q">${i + 1}</th>`).join("")}<th class="num">합계</th><th></th></tr></thead><tbody>
      ${list.map(s => markRow(s, r, stage)).join("") || `<tr><td colspan="13" class="empty-state">학생이 없습니다.</td></tr>`}
      </tbody></table></div>
      <p class="small muted">문항 번호에 마우스를 올리면 개념이 보여요.${ids && filled(ids) ? "" : ""}</p>`;
    main.querySelector("tbody").onclick = e => onMarkClick(e, r, stage);
  }
  C.$("#rsel").onchange = e => location.hash = `#/grade/${stage}/${g}/${e.target.value}`;
  C.$("#mine").onclick = () => { G.mine = !G.mine; viewGrade(stage, g, r); };
}
function markRow(s, r, stage) {
  const x = res(s.id, r, stage) || {};
  const can = stage === "preview" || (rv(s.id, r) || {}).issued;
  if (!can) return `<tr data-s="${s.id}"><td><b>${esc(s.name)}</b></td><td colspan="10" class="muted small">Review가 아직 발급되지 않았어요</td><td></td><td><a class="nx a" href="#/rv/${s.id}/${r}">구성하기</a></td></tr>`;
  const m = x.marks || Array(10).fill(null);
  const abs = x.status === "결시";
  return `<tr data-s="${s.id}" class="${abs ? "abs" : ""}"><td><b>${esc(s.name)}</b></td>${m.map((v, i) => `<td class="mc ${v == null ? "" : v >= 5 ? "o" : v <= 0 ? "x" : "p"}" data-i="${i}">${v == null ? "" : fmt(v)}</td>`).join("")}
    <td class="num tot">${abs ? "결시" : x.score != null ? fmt(x.score) : ""}</td><td><button class="btn sm" data-abs="1">${abs ? "결시 취소" : "결시"}</button></td></tr>`;
}
async function onMarkClick(e, r, stage) {
  const tr = e.target.closest("tr[data-s]"); if (!tr) return;
  const sid = tr.dataset.s, key = resultKey(sid, TERM, r, stage);
  const cur = RES.results[key] || { sid, term: termKey(), round: r, stage, marks: Array(10).fill(null), status: "응시" };
  const save = async next => {
    const marks = next.marks || cur.marks;
    const all = marks.every(v => v != null);
    const doc = { ...cur, ...next, marks, grade: C.stu(sid).grade, score: next.status === "결시" ? null : (all ? marks.reduce((a, b) => a + b, 0) : marks.some(v => v != null) ? marks.reduce((a, b) => a + (b || 0), 0) : null), complete: all, date: cur.date || new Date().toISOString().slice(0, 10), by: C.S.user.email, at: Date.now() };
    RES.results[key] = { id: key, ...doc };
    tr.outerHTML = markRow(C.stu(sid), r, stage);
    try { await C.S.store.setX("results", key, doc, false); } catch (x) { C.toast("저장하지 못했습니다: " + x.message, 4000); }
  };
  if (e.target.closest("[data-abs]")) return save({ status: cur.status === "결시" ? "응시" : "결시" });
  const td = e.target.closest("td.mc"); if (!td) return;
  const i = +td.dataset.i;
  // 점수 고르기: 작은 칸을 칸 바로 아래에 띄운다
  document.querySelectorAll(".mpop").forEach(p => p.remove());
  const pop = document.createElement("div"); pop.className = "mpop";
  pop.innerHTML = [5, 4, 3, 2, 1, 0].map(v => `<button data-v="${v}" class="${v === 5 ? "o" : v === 0 ? "x" : ""}">${v}</button>`).join("") + `<button data-v="h" title="0.5점 단위">.5</button><button data-v="" title="지우기">⌫</button>`;
  document.body.appendChild(pop);
  const b = td.getBoundingClientRect(); pop.style.left = Math.min(window.innerWidth - 300, Math.max(8, b.left + window.scrollX - 110)) + "px"; pop.style.top = (b.bottom + window.scrollY + 4) + "px";
  const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener("pointerdown", close, true); } };
  setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  pop.onclick = ev => {
    const bt = ev.target.closest("button"); if (!bt) return;
    const marks = [...cur.marks]; let v = bt.dataset.v;
    if (v === "h") { const c0 = marks[i]; if (c0 != null && c0 < 5 && c0 % 1 === 0) marks[i] = c0 + 0.5; else return; }
    else marks[i] = v === "" ? null : +v;
    pop.remove(); document.removeEventListener("pointerdown", close, true);
    save({ marks, status: "응시" });
  };
}

/* ================================================================ 회차 · 세트 */
export async function viewSets(sem = 0, g = 0) {
  const { S, main } = C;
  const V = S.sv = S.sv || {};
  sem = sem || V.sem || TERM.sem; g = g || V.g || 1; V.sem = sem; V.g = g;
  main.innerHTML = `<div class="page-head"><h1>회차 · 세트</h1></div><p class="muted">문제은행을 불러오는 중…</p>`;
  await ensureBank(S.store).catch(() => {});
  const cur = sem === TERM.sem;
  const studs = active().filter(s => s.grade === g);
  const rows = unitsOf(g, sem).map((u, i) => {
    const r = i + 1, st = setOf(sem, g, r);
    const p = filled(st.preview), t = filled(st.test);
    const pS = st.previewOk ? `<span class="stt ok">확정 · ${p}문항</span>` : p ? `<span class="stt draft">초안 ${p}/10</span>` : `<span class="stt none">비어 있음</span>`;
    const tS = st.testOk ? `<span class="stt ok">확정 · 숫자 ${(st.plan || []).filter(x => x === "num").length} · 내용 ${(st.plan || []).filter(x => x === "content").length}</span>` : t ? `<span class="stt draft">변형 ${t}/10</span>` : `<span class="stt none">${st.previewOk ? "변형 전" : "Preview 확정 후"}</span>`;
    const iss = cur ? studs.filter(s => (rv(s.id, r) || {}).issued).length : 0;
    const rS = !cur ? `<span class="muted small">—</span>` : iss ? `<span class="stt ok num">${iss} / ${studs.length}명 발급</span>` : `<span class="stt none">${studs.some(s => testScore(s.id, r) != null) ? "발급 전" : "테스트 전"}</span>`;
    return `<tr><td class="r">${r}</td><td class="unit">${esc(u)}</td><td>${pS}</td><td>${tS}</td><td>${rS}</td><td class="acts"><a class="btn sm" href="#/set/${sem}/${g}/${r}">열기</a>${cur ? `<a class="btn sm" href="#/review/${g}/${r}">Review</a>` : ""}</td></tr>`;
  }).join("");
  main.innerHTML = `<div class="page-head"><h1>회차 · 세트</h1><span class="sp"></span><a class="btn sm" href="#/bank">문제은행</a></div>
    <p class="muted" style="max-width:70ch">학년 · 학기마다 10회차, 회차마다 Preview · 테스트 · Review가 한 묶음이에요. Preview를 먼저 확정하고, 테스트는 그 Preview를 바꾼 문항(숫자 변형 5 · 내용 변형 5)으로 만들어요.</p>
    <div class="list-tools"><div class="chips">${[1, 2].map(x => `<a class="chipa" href="#/sets/${x}/${g}" aria-pressed="${x === sem}">${x}학기${x === TERM.sem ? " (진행 중)" : ""}</a>`).join("")}
      <span style="width:8px"></span>${[1, 2, 3].map(x => `<a class="chipa" href="#/sets/${sem}/${x}" aria-pressed="${x === g}">중${x}</a>`).join("")}</div></div>
    <div class="tblwrap"><table class="board"><thead><tr><th>회차</th><th>단원</th><th>Preview</th><th>테스트</th><th>Review ${cur ? `<small class="muted">(${termLabel()})</small>` : ""}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${sem === TERM.sem && isLegacyTerm() ? `<p class="small muted">${termLabel()} 테스트는 지금까지처럼 2026년 수행평가 시험지 · 채점기준표로 채점해요. 새 세트는 2027년부터 쓰여요.</p>` : ""}`;
}

/* ---------------------------------------------------------------- 세트 편집 */
const emptySet = () => ({ preview: Array(10).fill(null), test: Array(10).fill(null), plan: ["num", "content", "num", "content", "num", "content", "num", "content", "num", "content"] });
export async function viewSet(sem, g, r) {
  const { S, main } = C;
  main.innerHTML = `<p class="muted">불러오는 중…</p>`;
  await ensureBank(S.store).catch(() => {});
  const key = setKey(sem, g, r);
  const st = { ...emptySet(), ...(BANK.sets[key] || {}) };
  st.preview = Array.from({ length: 10 }, (_, i) => (st.preview || [])[i] || null);
  st.test = Array.from({ length: 10 }, (_, i) => (st.test || [])[i] || null);
  const unit = unitOf(g, r, sem);
  const save = async (patch, msg) => {
    Object.assign(st, patch);
    BANK.sets[key] = { ...(BANK.sets[key] || {}), ...st, id: key };
    try { await S.store.setX("sets", key, { preview: st.preview, test: st.test, plan: st.plan, previewOk: !!st.previewOk, testOk: !!st.testOk, sem, grade: g, round: r, by: S.user.email, at: Date.now() }, false); if (msg) C.toast(msg); }
    catch (e) { C.toast("저장하지 못했습니다: " + e.message, 4000); }
    paint();
  };
  const itemRow = (id, i, kind) => {
    const it = id && BANK.items[id];
    if (!it) return `<div class="q empty"><div class="n">${i + 1}</div><div class="qbd muted">비어 있음${kind === "test" ? ` <button class="chipb sm" data-plan="${i}">${st.plan[i] === "content" ? "내용 변형" : "숫자 변형"}</button>` : ""}</div><div class="acts">${kind === "preview" && !st.previewOk ? `<button class="btn sm" data-pick="${i}">고르기</button>` : kind === "test" && st.previewOk && !st.testOk && st.preview[i] ? `<button class="btn sm gold" data-var="${i}">변형 만들기</button>` : ""}</div></div>`;
    const locked = kind === "preview" ? st.previewOk : st.testOk;
    return `<div class="q"><div class="n">${i + 1}</div><div class="qbd"><div class="qb">${bodyHTML(it.body)}</div>${figTag(it)}
      <div class="meta">${srcChip(it)}${stars(it.diff)}${it.concept ? `<span class="muted small">${esc(it.concept)}</span>` : ""}${it.status === "check" ? `<span class="chip c-warn">검산 확인 필요</span>` : ""}${it.needFig ? `<span class="chip c-warn">그림 확인 필요</span>` : ""}
      ${kind === "test" ? `<button class="chipb sm" data-plan="${i}" ${locked ? "disabled" : ""}>${st.plan[i] === "content" ? "내용 변형" : "숫자 변형"}</button>` : ""}</div></div>
      <div class="acts">${locked ? "" : `${kind === "preview" ? `<button class="btn sm" data-pick="${i}">바꾸기</button>` : `<button class="btn sm" data-var="${i}">다시 변형</button>`}<button class="btn sm" data-edit="${id}">고치기</button><button class="btn sm" data-rm="${kind}:${i}">빼기</button>`}</div></div>`;
  };
  function paint() {
    const pN = filled(st.preview), tN = filled(st.test);
    main.innerHTML = `<div class="stu-head"><a class="back" href="#/sets/${sem}/${g}" aria-label="회차 목록으로">‹</a><div style="flex:1;min-width:0"><h1>중${g} · ${sem}학기 ${r}회 <small class="muted">${esc(unit)}</small></h1></div></div>
      <div class="set-cols">
        <section class="card"><div class="hd2"><h2><i class="stepi">STEP 1</i> Preview <small class="muted num">${pN}/10</small></h2>
          <div class="rowx">${st.previewOk ? `<span class="stt ok">확정</span><button class="btn sm" id="p-unlock">확정 풀기</button>` : `<button class="btn sm" id="p-auto">은행에서 자동 채우기</button><button class="btn sm fill" id="p-ok" ${pN < 10 ? "disabled" : ""}>확정</button>`}
          <button class="btn sm" data-print="preview" ${pN ? "" : "disabled"}>학습지</button><button class="btn sm" data-print="preview-key" ${pN ? "" : "disabled"}>정답</button></div></div>
          <p class="small muted">학년 공통 10문항 · 난이도 ★ 3 · ★★ 4 · ★★★ 3 이 기본이에요.</p>
          <div class="qlist">${st.preview.map((id, i) => itemRow(id, i, "preview")).join("")}</div></section>
        <section class="card"><div class="hd2"><h2><i class="stepi">STEP 2</i> 테스트 <small class="muted num">${tN}/10</small></h2>
          <div class="rowx">${st.testOk ? `<span class="stt ok">확정</span><button class="btn sm" id="t-unlock">확정 풀기</button>` : `<button class="btn sm gold" id="t-all" ${st.previewOk ? "" : "disabled"}>빈 칸 모두 변형 만들기</button><button class="btn sm fill" id="t-ok" ${tN < 10 ? "disabled" : ""}>확정</button>`}
          <button class="btn sm" data-print="test" ${tN ? "" : "disabled"}>학습지</button><button class="btn sm" data-print="test-key" ${tN ? "" : "disabled"}>정답</button></div></div>
          <p class="small muted">${st.previewOk ? "Preview 문항을 바꿔 만들어요. 숫자 · 내용 변형은 문항마다 눌러 바꿀 수 있어요. 정답은 서버가 따로 다시 풀어 맞을 때만 ‘검산 완료’로 들어와요." : "Preview를 먼저 확정해 주세요."}</p>
          <div class="qlist">${st.test.map((id, i) => itemRow(id, i, "test")).join("")}</div></section>
      </div>`;
    math(main); paintFigs(main);
  }
  paint();
  main.onclick = async e => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.pick != null) return pickItem({ g, sem, r, unit, exclude: [...st.preview, ...st.test] }, id => { const p = [...st.preview]; p[+b.dataset.pick] = id; save({ preview: p }); });
    if (b.dataset.edit) return openItemEditor(BANK.items[b.dataset.edit], () => paint());
    if (b.dataset.rm) { const [k, i] = b.dataset.rm.split(":"); const a = [...st[k]]; a[+i] = null; return save({ [k]: a }); }
    if (b.dataset.plan != null) { const pl = [...st.plan]; pl[+b.dataset.plan] = pl[+b.dataset.plan] === "num" ? "content" : "num"; return save({ plan: pl }); }
    if (b.dataset.var != null) { C.busy(b, true, "만드는 중"); await makeVariant(st, +b.dataset.var, g, unit, sem, r); C.busy(b, false); return save({}); }
    if (b.dataset.print) {
      const [kind, key2] = b.dataset.print.split("-");
      const ids = st[kind].filter(Boolean);
      const label = kind === "preview" ? "Preview" : "테스트";
      return key2 ? printKey({ title: `${label} 정답 · 채점기준`, sub: `중${g} · ${sem}학기 · ${r}회 ${unit}`, ids }) : printSheets([{ title: `${label} · ${unit}`, sub: `중${g} · ${sem}학기 · ${r}회`, ids }]);
    }
    switch (b.id) {
      case "p-auto": { const p = autoFill(g, sem, r, st.preview, [...st.test]); return save({ preview: p }, `${filled(p)}문항을 채웠어요`); }
      case "p-ok": return save({ previewOk: true }, "Preview를 확정했어요");
      case "p-unlock": if (st.testOk) { C.toast("테스트 확정을 먼저 풀어 주세요"); return; } return save({ previewOk: false });
      case "t-all": {
        C.busy(b, true, "변형 만드는 중");
        for (let i = 0; i < 10; i++) if (!st.test[i] && st.preview[i]) { b.innerHTML = `<span class="spinner"></span> ${i + 1}/10`; await makeVariant(st, i, g, unit, sem, r); }
        C.busy(b, false); return save({}, "변형 문항을 만들었어요. 검산 표시를 확인해 주세요");
      }
      case "t-ok": if (st.test.some(id => (BANK.items[id] || {}).status === "check") && !confirm("검산 확인이 필요한 문항이 있어요. 그래도 확정할까요?")) return; return save({ testOk: true }, "테스트를 확정했어요");
      case "t-unlock": return save({ testOk: false });
    }
  };
}
async function makeVariant(st, i, g, unit, sem, r) {
  const parent = BANK.items[st.preview[i]]; if (!parent) return;
  const type = st.plan[i] || "num";
  try {
    const v = await requestVariant({ store: C.S.store, item: { ...parent, hasFigure: !!parent.figId }, type, grade: g, unit });
    const it = { grade: g, sem, round: r, unit, concept: v.concept || parent.concept || "", diff: parent.diff || 2, body: v.body, answer: v.answer, criteria: v.criteria || parent.criteria || "",
      source: { type: "ai", ref: (parent.source && parent.source.ref) || "" }, parent: st.preview[i], vtype: type, status: v.verified ? "ok" : "check", check: v.check || "",
      figId: type === "num" && parent.figId ? parent.figId : null, needFig: !!parent.figId, testOnly: true, by: C.S.user.email, at: Date.now() };
    const id = await C.S.store.setX("items", null, it);
    BANK.items[id] = { id, ...it }; st.test[i] = id;
  } catch (e) { C.toast(`${i + 1}번 변형을 만들지 못했어요: ${e.message}`, 4000); }
}
// 같은 회차(없으면 같은 단원) 문항으로 ★ 3 · ★★ 4 · ★★★ 3 맞춰 빈 칸 채우기
function autoFill(g, sem, r, cur, exclude) {
  const out = [...cur], used = new Set([...cur, ...exclude].filter(Boolean));
  const unit = unitOf(g, r, sem);
  const pool = Object.values(BANK.items).filter(it => it.grade === g && it.sem === sem && (it.round === r || it.unit === unit) && !it.testOnly && it.status !== "check" && !used.has(it.id));
  const want = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3];
  const have = out.filter(Boolean).map(id => (BANK.items[id] || {}).diff || 2);
  have.forEach(d => { const k = want.indexOf(d); if (k >= 0) want.splice(k, 1); });
  for (let i = 0; i < 10; i++) {
    if (out[i]) continue;
    const d = want.shift() || 2;
    const c = pool.filter(it => !used.has(it.id)).sort((a, b) => Math.abs((a.diff || 2) - d) - Math.abs((b.diff || 2) - d) || (a.source?.type === "old" ? -1 : 1))[0];
    if (!c) break;
    out[i] = c.id; used.add(c.id);
  }
  // 쉬운 문항부터
  const fixed = out.filter(Boolean).sort((a, b) => (BANK.items[a].diff || 2) - (BANK.items[b].diff || 2));
  return Array.from({ length: 10 }, (_, i) => fixed[i] || null);
}

/* ---------------------------------------------------------------- 문항 고르기 · 고치기 */
function pickItem({ g, sem, r, unit, exclude = [], concept = "" }, onPick) {
  const F = { all: false, q: concept };
  const el = C.sheet(`<div class="grab"></div><h4>문항 고르기<small>중${g} · ${sem}학기 ${r}회 ${esc(unit)}</small></h4>
    <div class="rowx"><input class="input" id="pk-q" type="search" placeholder="개념·본문 검색" value="${esc(F.q)}"><label class="small"><input type="checkbox" id="pk-all"> 다른 회차도 보기</label></div>
    <div class="qlist" id="pk-list" style="max-height:60vh;overflow:auto"></div>
    <div class="acts"><button class="btn" data-close>닫기</button><button class="btn gold" id="pk-new">새 문항 쓰기</button></div>`);
  const ex = new Set(exclude.filter(Boolean));
  const paint = () => {
    const q = F.q.trim();
    const list = Object.values(BANK.items).filter(it => it.grade === g && it.sem === sem && (F.all || it.round === r || it.unit === unit) && !ex.has(it.id) && !it.testOnly && (!q || (it.body || "").includes(q) || (it.concept || "").includes(q)))
      .sort((a, b) => (a.round === r ? 0 : 1) - (b.round === r ? 0 : 1) || (a.diff || 2) - (b.diff || 2)).slice(0, 80);
    C.$("#pk-list", el).innerHTML = list.map(it => `<div class="q"><div class="n small">${it.round || "–"}회</div><div class="qbd"><div class="qb">${bodyHTML(it.body)}</div>${figTag(it)}<div class="meta">${srcChip(it)}${stars(it.diff)}<span class="muted small">${esc(it.concept || "")}</span></div></div><div class="acts"><button class="btn sm fill" data-use="${it.id}">이걸로</button></div></div>`).join("")
      || `<p class="empty-state">조건에 맞는 문항이 없어요. ‘다른 회차도 보기’를 켜거나 새 문항을 써 주세요.</p>`;
    math(el); paintFigs(el);
  };
  paint();
  C.$("#pk-q", el).oninput = e => { F.q = e.target.value; paint(); };
  C.$("#pk-all", el).onchange = e => { F.all = e.target.checked; paint(); };
  C.$("[data-close]", el).onclick = C.closeSheet;
  C.$("#pk-new", el).onclick = () => openItemEditor({ grade: g, sem, round: r, unit, diff: 2, source: { type: "db", ref: "" } }, id => { onPick(id); });
  C.$("#pk-list", el).onclick = e => { const b = e.target.closest("[data-use]"); if (b) { C.closeSheet(); onPick(b.dataset.use); } };
}
export function openItemEditor(it, onSaved) {
  it = it || { diff: 2, source: { type: "db", ref: "" } };
  const isNew = !it.id;
  const el = C.sheet(`<div class="grab"></div><h4>${isNew ? "새 문항" : "문항 고치기"}</h4>
    <div class="row3"><label class="small muted">학년<select class="input" id="e-g">${[1, 2, 3].map(x => `<option ${it.grade === x ? "selected" : ""} value="${x}">중${x}</option>`).join("")}</select></label>
      <label class="small muted">학기<select class="input" id="e-s">${[1, 2].map(x => `<option ${it.sem === x ? "selected" : ""} value="${x}">${x}학기</option>`).join("")}</select></label>
      <label class="small muted">회차<select class="input" id="e-r"><option value="0">미정</option>${Array.from({ length: 10 }, (_, i) => `<option ${it.round === i + 1 ? "selected" : ""} value="${i + 1}">${i + 1}회</option>`).join("")}</select></label>
      <label class="small muted">난이도<select class="input" id="e-d">${[1, 2, 3].map(x => `<option ${(it.diff || 2) === x ? "selected" : ""} value="${x}">${"★".repeat(x)}</option>`).join("")}</select></label></div>
    <label class="small muted">개념<input class="input" id="e-c" value="${esc(it.concept || "")}" placeholder="예: 평행선의 성질"></label>
    <label class="small muted">문항 본문 <span class="muted">· 수식은 \\( \\) 안에 씀. 예: \\(2x+3=7\\)</span><textarea class="input" id="e-b" rows="5">${esc(it.body || "")}</textarea></label>
    <div class="qprev" id="e-pv"></div>
    <div class="rowx"><label class="btn sm">그림 넣기<input type="file" id="e-f" accept="image/*" hidden></label><span class="small muted" id="e-fs">${it.figId ? "그림 있음" : "그림 없음"}</span>${it.figId ? `<button class="btn sm" id="e-fd">그림 빼기</button>` : ""}</div>
    <label class="small muted">정답<input class="input" id="e-a" value="${esc(it.answer || "")}"></label>
    <label class="small muted">채점기준 <span class="muted">· ① … 2점 처럼 단계별로, 합 5점</span><textarea class="input" id="e-k" rows="3">${esc(it.criteria || "")}</textarea></label>
    <div class="row3"><label class="small muted">출처<select class="input" id="e-src">${Object.entries(SRC).map(([k, v]) => `<option value="${k}" ${(it.source || {}).type === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>
      <label class="small muted" style="grid-column:span 3">출처 상세<input class="input" id="e-ref" value="${esc((it.source || {}).ref || "")}" placeholder="예: 천재 p.142 / 2026 2학기 1회 3번 / 파일 이름"></label></div>
    ${it.status === "check" ? `<label class="small"><input type="checkbox" id="e-ok"> 정답을 직접 확인했어요 (검산 확인 표시 없애기)</label>${it.check ? `<p class="small muted">${esc(it.check)}</p>` : ""}` : ""}
    <div class="acts"><button class="btn" data-close>취소</button><button class="btn fill" id="e-sv">저장</button></div>
    ${!isNew ? `<button class="btn sm danger" id="e-del" style="align-self:flex-start">문항 삭제</button>` : ""}`);
  let fig = undefined; // undefined: 그대로, null: 빼기, string: 새 그림
  const pv = () => { C.$("#e-pv", el).innerHTML = bodyHTML(C.$("#e-b", el).value); math(C.$("#e-pv", el)); };
  pv(); C.$("#e-b", el).oninput = pv;
  C.$("#e-f", el).onchange = async e => { const f = e.target.files[0]; if (!f) return; fig = await shrinkBlob(f, 900, 0.8); C.$("#e-fs", el).textContent = "새 그림 넣음"; };
  const fd = C.$("#e-fd", el); if (fd) fd.onclick = () => { fig = null; C.$("#e-fs", el).textContent = "그림 뺌"; };
  C.$("[data-close]", el).onclick = C.closeSheet;
  C.$("#e-sv", el).onclick = async e => {
    const d = { grade: +C.$("#e-g", el).value, sem: +C.$("#e-s", el).value, round: +C.$("#e-r", el).value, diff: +C.$("#e-d", el).value, concept: C.$("#e-c", el).value.trim(),
      body: C.$("#e-b", el).value.trim(), answer: C.$("#e-a", el).value.trim(), criteria: C.$("#e-k", el).value.trim(), source: { type: C.$("#e-src", el).value, ref: C.$("#e-ref", el).value.trim() } };
    d.unit = unitOf(d.grade, d.round, d.sem);
    if (!d.body) { C.toast("문항 본문을 입력해 주세요"); return; }
    const okc = C.$("#e-ok", el); if (okc && okc.checked) d.status = "ok";
    C.busy(e.currentTarget, true);
    try {
      const id = await C.S.store.setX("items", it.id || null, { ...d, by: C.S.user.email, at: Date.now() });
      if (fig !== undefined) {
        if (fig) { await C.S.store.setX("figs", id, { data: fig }, false); d.figId = id; BANK.figs[id] = fig; d.needFig = false; }
        else { d.figId = null; }
        await C.S.store.setX("items", id, { figId: d.figId, needFig: d.needFig || false });
      }
      BANK.items[id] = { ...(BANK.items[id] || {}), ...it, ...d, id };
      C.toast("문항을 저장했어요"); C.closeSheet(); onSaved && onSaved(id);
    } catch (x) { C.toast("저장하지 못했습니다: " + x.message, 4000); C.busy(e.currentTarget, false); }
  };
  const del = C.$("#e-del", el);
  if (del) del.onclick = async () => {
    const inSet = Object.values(BANK.sets).some(s => [...(s.preview || []), ...(s.test || [])].includes(it.id));
    if (inSet) { C.toast("세트에 들어 있는 문항이에요. 세트에서 먼저 빼 주세요.", 3500); return; }
    if (!confirm("이 문항을 삭제할까요?")) return;
    await C.S.store.delX("items", it.id); delete BANK.items[it.id]; C.toast("삭제했어요"); C.closeSheet(); onSaved && onSaved(null);
  };
}

/* ================================================================ Review */
// 취약 개념 계산 → 10문항 배분 → 문제은행에서 고르기
export async function buildReview(sid, r) {
  const s = C.stu(sid), g = s.grade, sem = TERM.sem, unit = unitOf(g, r);
  const set = setOf(sem, g, r);
  const loss = {}; const add = (c, v, why) => { if (v <= 0) return; const k = c || unit; (loss[k] = loss[k] || { concept: k, lost: 0, zero: 0, why: [] }); loss[k].lost += v; if (why) loss[k].why.push(why); };
  // 테스트: 시험지 분석이 있으면 문항별, 없으면 총점만
  const an = await C.S.store.getAnalysis(sid, r).catch(() => null);
  const conceptOfTest = no => { const id = (set.test || [])[no - 1]; const it = id && BANK.items[id]; if (it && it.concept) return it.concept; const old = Object.values(BANK.items).find(x => x.source && x.source.type === "old" && x.grade === g && x.sem === sem && x.round === r && x.no === no); return old && old.concept || `${unit}`; };
  if (an && an.confirmed !== false && an.items) an.items.forEach(it => { const lost = 5 - (+it.score || 0); add(conceptOfTest(it.no), lost, `테스트 ${it.no}번${it.error_type ? " · " + it.error_type : ""}`); if (lost >= 5) loss[conceptOfTest(it.no)].zero++; });
  else { const sc = testScore(sid, r); if (sc != null) add(unit, 50 - sc, `테스트 ${fmt(sc)}점`); }
  // Preview 오답은 절반 무게로
  const pr = res(sid, r, "preview");
  if (pr && pr.marks) pr.marks.forEach((m, i) => { if (m == null) return; const it = BANK.items[(set.preview || [])[i]] || {}; add(it.concept || unit, (5 - m) / 2, m < 5 ? `Preview ${i + 1}번` : ""); });
  const weak = Object.values(loss).sort((a, b) => b.lost - a.lost);
  // 배분: 0점 문항이 있으면 3, 3점 이상 잃으면 2, 그 밖 1 (개념당 최대 4, 합 9 이내)
  const plan = []; let left = 9;
  for (const w of weak) { if (left <= 0) break; const n = Math.min(left, 4, w.zero ? 3 + (w.zero > 1 ? 1 : 0) : w.lost >= 3 ? 2 : w.lost >= 1 ? 1 : 0); if (n > 0) { plan.push({ concept: w.concept, n, why: w.why.slice(0, 3).join(", "), kind: "weak" }); left -= n; } }
  const total = plan.reduce((a, p) => a + p.n, 0);
  if (!total) plan.push({ concept: unit, n: 10, why: "만점 · 심화", kind: "deep" });
  else {
    const nxt = r < 10 ? 1 : 0;
    if (nxt) plan.push({ concept: unitOf(g, r + 1), n: 1, why: "다음 회차 맛보기", kind: "next" });
    const rest = 10 - plan.reduce((a, p) => a + p.n, 0);
    if (rest > 0) plan.push({ concept: unit, n: rest, why: "한 단계 위 문항", kind: "up" });
  }
  // 문항 고르기
  const used = new Set([...(set.preview || []), ...(set.test || [])].filter(Boolean));
  Object.values(RES.reviews).filter(v => v.sid === sid).forEach(v => (v.items || []).forEach(id => id && used.add(id)));
  const items = [];
  for (const p of plan) {
    const rr = p.kind === "next" ? r + 1 : r;
    let pool = Object.values(BANK.items).filter(it => it.grade === g && it.sem === sem && !it.testOnly && it.status !== "check" && !used.has(it.id) && (it.round === rr || it.unit === unitOf(g, rr)));
    const byC = pool.filter(it => it.concept && (it.concept === p.concept || it.concept.includes(p.concept) || p.concept.includes(it.concept)));
    // 취약 개념 자리는 같은 개념 문항만 (없으면 비워 두고 AI 변형으로 채운다), 나머지 자리는 같은 회차 아무 문항
    pool = p.kind === "weak" ? byC : [...byC, ...pool.filter(it => !byC.includes(it))];
    pool.sort((a, b) => p.kind === "up" || p.kind === "deep" ? (b.diff || 2) - (a.diff || 2) : (a.diff || 2) - (b.diff || 2));
    for (let k = 0; k < p.n; k++) { const it = pool.find(x => !used.has(x.id)); if (it) used.add(it.id); items.push(it ? it.id : null); }
  }
  return { sid, grade: g, term: termKey(), round: r, items: items.slice(0, 10), plan, weak: weak.slice(0, 6).map(w => ({ concept: w.concept, lost: Math.round(w.lost * 10) / 10 })), issued: false, by: C.S.user.email, at: Date.now() };
}
async function saveReview(doc) {
  const key = `${doc.sid}_${doc.term}_${doc.round}`;
  RES.reviews[key] = { id: key, ...doc };
  await C.S.store.setX("reviews", key, doc, false);
}
export async function viewReviewList(g = 0, r = 0) {
  const { S, main } = C;
  g = g || (S.gr && S.gr.g) || 1; r = r || curRound(g);
  main.innerHTML = `<p class="muted">불러오는 중…</p>`;
  await ensureBank(S.store).catch(() => {});
  const list = active().filter(s => s.grade === g).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const rowOf = s => {
    const v = rv(s.id, r), sc = testScore(s.id, r);
    const st = v ? (v.issued ? `<span class="stt ok">발급</span>` : `<span class="stt draft">구성됨 · 발급 전</span>`) : sc == null ? `<span class="stt none">테스트 전</span>` : `<span class="stt none">구성 전</span>`;
    const wk = v && v.weak ? v.weak.slice(0, 3).map(w => esc(w.concept)).join(" · ") : "";
    return `<tr><td><label><input type="checkbox" data-sel="${s.id}" ${v && v.issued ? "" : ""}> <b>${esc(s.name)}</b></label></td><td class="num">${sc == null ? "–" : fmt(sc)}</td><td>${st}</td><td class="small">${wk}</td><td><a class="btn sm" href="#/rv/${s.id}/${r}">열기</a></td></tr>`;
  };
  main.innerHTML = `<div class="page-head"><h1>Review</h1><span class="sp"></span><span class="muted small">${termLabel()}</span></div>
    <div class="list-tools"><div class="chips">${[1, 2, 3].map(x => `<a class="chipa" href="#/review/${x}/${curRound(x)}" aria-pressed="${x === g}">중${x}</a>`).join("")}
      <select class="input sm" id="rsel">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${i + 1 === r ? "selected" : ""}>${i + 1}회 · ${esc(unitOf(g, i + 1))}</option>`).join("")}</select></div></div>
    <div class="card note-card"><p>테스트 점수와 시험지 분석(문항별 점수 · 감점 원인), Preview 오답으로 학생마다 10문항을 골라요. <b>0점 문항 → 같은 개념 3문항</b>, 부분 점수 → 1~2문항, 남는 자리는 다음 회차 맛보기와 한 단계 위 문항이에요.</p>
      <div class="rowx"><button class="btn fill" id="auto">테스트 끝난 학생 모두 자동 구성</button><button class="btn" id="issue">선택한 학생 발급</button><button class="btn" id="print">선택한 학생 학습지 인쇄</button></div></div>
    <div class="tblwrap"><table class="mtab"><thead><tr><th><label><input type="checkbox" id="selall"> 학생</label></th><th class="num">테스트</th><th>상태</th><th>취약 개념</th><th></th></tr></thead><tbody>${list.map(rowOf).join("") || `<tr><td colspan="5" class="empty-state">학생이 없습니다.</td></tr>`}</tbody></table></div>`;
  C.$("#rsel").onchange = e => location.hash = `#/review/${g}/${e.target.value}`;
  C.$("#selall").onchange = e => C.$$("[data-sel]").forEach(c => c.checked = e.target.checked);
  const sel = () => C.$$("[data-sel]").filter(c => c.checked).map(c => c.dataset.sel);
  C.$("#auto").onclick = async e => {
    const todo = list.filter(s => testScore(s.id, r) != null && !(rv(s.id, r) || {}).issued);
    if (!todo.length) { C.toast("구성할 학생이 없어요 (테스트 채점이 끝나고 아직 발급 전인 학생)"); return; }
    C.busy(e.currentTarget, true, "구성 중");
    let short = 0;
    for (const s of todo) { const d = await buildReview(s.id, r); short += d.items.filter(x => !x).length; await saveReview(d); }
    C.busy(e.currentTarget, false);
    C.toast(`${todo.length}명 구성했어요${short ? ` · 은행에 문항이 모자라 빈 칸 ${short}개 (학생 화면에서 AI 변형으로 채울 수 있어요)` : ""}`, 4500);
    viewReviewList(g, r);
  };
  C.$("#issue").onclick = async () => {
    const ids = sel().filter(id => rv(id, r)); if (!ids.length) { C.toast("구성된 학생을 골라 주세요"); return; }
    for (const id of ids) { const v = rv(id, r); await saveReview({ ...v, issued: true, issuedAt: Date.now() }); }
    C.toast(`${ids.length}명 발급했어요`); viewReviewList(g, r);
  };
  C.$("#print").onclick = () => {
    const ids = sel().filter(id => rv(id, r)); if (!ids.length) { C.toast("구성된 학생을 골라 주세요"); return; }
    printSheets(ids.map(id => reviewPage(id, r)));
  };
}
function reviewPage(sid, r) {
  const s = C.stu(sid), v = rv(sid, r);
  return { title: `Review · ${unitOf(s.grade, r)}`, sub: `중${s.grade} · ${TERM.sem}학기 · ${r}회 · 테스트 결과에 맞춘 10문항`, name: s.name, ids: (v.items || []).filter(Boolean), focus: (v.plan || []).map(p => `${p.concept} ${p.n}문항`) };
}
export async function viewReviewOne(sid, r) {
  const { S, main } = C;
  main.innerHTML = `<p class="muted">불러오는 중…</p>`;
  await ensureBank(S.store).catch(() => {});
  const s = C.stu(sid); if (!s) { location.hash = "#/review"; return; }
  let v = rv(sid, r);
  const paint = () => {
    const sc = testScore(sid, r), pr = stScore(sid, r, "preview");
    const cols = ["a1", "a2", "a3", "a4", "a5", "a6"];
    let k = 0; const slots = [];
    if (v) v.plan.forEach((p, pi) => { for (let j = 0; j < p.n; j++) slots.push({ p, cls: p.kind === "weak" ? cols[pi % 4] : "", idx: k++ }); });
    main.innerHTML = `<div class="stu-head"><a class="back" href="#/review/${s.grade}/${r}" aria-label="Review 목록으로">‹</a><div style="flex:1;min-width:0"><h1>${esc(s.name)} <small class="muted">중${s.grade} · ${r}회 ${esc(unitOf(s.grade, r))}</small></h1></div>
      ${v && v.issued ? `<span class="stt ok">발급됨</span>` : ""}</div>
      <div class="set-cols">
        <section class="card"><h2>결과</h2><div class="sum num"><div>Preview<b>${pr == null ? "–" : fmt(pr)}</b></div><div>테스트<b>${sc == null ? "–" : fmt(sc)}</b></div><div>Review<b>${stScore(sid, r, "review") == null ? "–" : fmt(stScore(sid, r, "review"))}</b></div></div>
          ${v && v.weak && v.weak.length ? `<h3 class="h3">취약 개념 (잃은 점수)</h3><div class="weak">${v.weak.map(w => `<div class="wk"><span>${esc(w.concept)}</span><span class="bar"><span style="width:${Math.min(100, w.lost * 20)}%"></span></span><b class="num">−${fmt(w.lost)}</b></div>`).join("")}</div>` : ""}
          ${v ? `<h3 class="h3">배분</h3><div class="alloc">${slots.map(x => `<div class="${x.cls}"><b>${x.idx + 1}</b>${esc(x.p.concept)}</div>`).join("")}</div><p class="small muted">${v.plan.map(p => `${esc(p.concept)} ${p.n} — ${esc(p.why)}`).join("<br>")}</p>` : `<p class="muted">아직 구성하지 않았어요.</p>`}
          <div class="rowx"><button class="btn ${v ? "" : "fill"}" id="build">${v ? "다시 구성" : "자동 구성"}</button>${v ? `<button class="btn fill" id="issue">${v.issued ? "발급 취소" : "발급"}</button><button class="btn" id="print" ${filled(v.items) ? "" : "disabled"}>학습지 인쇄</button><button class="btn" id="pkey" ${filled(v.items) ? "" : "disabled"}>정답</button>${!v.issued && v.items.some(x => !x) ? `<button class="btn gold" id="ai-all">빈 칸 AI 변형으로 채우기</button>` : ""}` : ""}</div></section>
        <section class="card"><h2>Review 10문항</h2><div class="qlist">${v ? slots.map(x => { const id = v.items[x.idx], it = id && BANK.items[id];
          return it ? `<div class="q"><div class="n">${x.idx + 1}</div><div class="qbd"><div class="qb">${bodyHTML(it.body)}</div>${figTag(it)}<div class="meta">${srcChip(it)}${stars(it.diff)}<span class="muted small">${esc(it.concept || "")}</span></div></div><div class="acts">${v.issued ? "" : `<button class="btn sm" data-swap="${x.idx}">바꾸기</button>`}</div></div>`
            : `<div class="q empty"><div class="n">${x.idx + 1}</div><div class="qbd muted">은행에 맞는 문항이 없어요 · ${esc(x.p.concept)}</div><div class="acts">${v.issued ? "" : `<button class="btn sm" data-swap="${x.idx}">고르기</button><button class="btn sm gold" data-ai="${x.idx}">AI 변형</button>`}</div></div>`; }).join("") : ""}</div></section>
      </div>`;
    math(main); paintFigs(main);
  };
  paint();
  const slotPlan = () => { const a = []; v.plan.forEach(p => { for (let j = 0; j < p.n; j++) a.push(p); }); return a; };
  // 은행에 맞는 문항이 없으면, 같은 개념의 Preview·테스트 문항을 숫자 변형해 채운다 (서버가 따로 다시 풀어 검산)
  async function fillAI(i) {
    const p = slotPlan()[i], set = setOf(TERM.sem, s.grade, r);
    const base = [...(set.preview || []), ...(set.test || [])].map(id => BANK.items[id]).find(it => it && it.concept === p.concept && !it.testOnly)
      || [...(set.preview || []), ...(set.test || [])].map(id => BANK.items[id]).find(it => it && it.concept === p.concept)
      || BANK.items[(set.preview || []).find(Boolean)] || Object.values(BANK.items).find(it => it.grade === s.grade && it.sem === TERM.sem && it.round === r);
    if (!base) { C.toast("변형할 원본 문항이 없어요. 먼저 문제은행에 문항을 넣어 주세요.", 3500); return false; }
    try {
      const x = await requestVariant({ store: S.store, item: { ...base, hasFigure: !!base.figId }, type: "num", grade: s.grade, unit: unitOf(s.grade, r) });
      const it = { grade: s.grade, sem: TERM.sem, round: r, unit: unitOf(s.grade, r), concept: x.concept || base.concept || p.concept, diff: base.diff || 2, body: x.body, answer: x.answer, criteria: x.criteria || base.criteria || "", source: { type: "ai", ref: (base.source || {}).ref || "" }, parent: base.id, vtype: "num", status: x.verified ? "ok" : "check", check: x.check || "", figId: base.figId || null, needFig: !!base.figId, by: S.user.email, at: Date.now() };
      const id = await S.store.setX("items", null, it); BANK.items[id] = { id, ...it };
      const items = [...v.items]; items[i] = id; v = { ...v, items }; await saveReview(v); return true;
    } catch (x) { C.toast("만들지 못했어요: " + x.message, 4000); return false; }
  }
  main.onclick = async e => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.id === "build") { if (v && v.issued) { C.toast("발급을 먼저 취소해 주세요"); return; } C.busy(b, true, "구성 중"); v = await buildReview(sid, r); await saveReview(v); C.toast("구성했어요"); return paint(); }
    if (b.id === "issue") { v = { ...v, issued: !v.issued, issuedAt: Date.now() }; await saveReview(v); C.toast(v.issued ? "발급했어요" : "발급을 취소했어요"); return paint(); }
    if (b.id === "print") return printSheets([reviewPage(sid, r)]);
    if (b.id === "pkey") return printKey({ title: `${s.name} Review 정답 · 채점기준`, sub: `중${s.grade} · ${r}회`, ids: v.items.filter(Boolean) });
    if (b.dataset.swap != null) {
      const i = +b.dataset.swap, slot = []; v.plan.forEach(p => { for (let j = 0; j < p.n; j++) slot.push(p); });
      const p = slot[i];
      return pickItem({ g: s.grade, sem: TERM.sem, r: p.kind === "next" ? r + 1 : r, unit: unitOf(s.grade, p.kind === "next" ? r + 1 : r), exclude: v.items, concept: p.kind === "weak" ? p.concept : "" }, async id => { const items = [...v.items]; items[i] = id; v = { ...v, items }; await saveReview(v); paint(); });
    }
    if (b.dataset.ai != null) { C.busy(b, true, "만드는 중"); const ok = await fillAI(+b.dataset.ai); if (!ok) C.busy(b, false); else paint(); return; }
    if (b.id === "ai-all") {
      const empt = v.items.map((x, i) => x ? -1 : i).filter(i => i >= 0);
      C.busy(b, true, "만드는 중");
      for (const [n, i] of empt.entries()) { b.innerHTML = `<span class="spinner"></span> ${n + 1}/${empt.length}`; await fillAI(i); }
      return paint();
    }
  };
}

/* ================================================================ 문제은행 */
export async function viewBank() {
  const { S, main } = C;
  const F = S.bf = S.bf || { g: 0, sem: 0, r: 0, src: "", d: 0, q: "", page: 0 };
  main.innerHTML = `<div class="page-head"><h1>문제은행</h1></div><p class="muted">불러오는 중…</p>`;
  await ensureBank(S.store).catch(e => C.toast("문제은행을 불러오지 못했어요: " + e.message, 4000));
  const all = Object.values(BANK.items);
  const cnt = t => all.filter(it => (it.source || {}).type === t).length;
  const paint = () => {
    const q = F.q.trim();
    const list = all.filter(it => (!F.g || it.grade === F.g) && (!F.sem || it.sem === F.sem) && (!F.r || it.round === F.r) && (!F.src || (it.source || {}).type === F.src) && (!F.d || it.diff === F.d) && (!q || (it.body || "").includes(q) || (it.concept || "").includes(q) || ((it.source || {}).ref || "").includes(q)))
      .sort((a, b) => (a.grade - b.grade) || (a.sem - b.sem) || ((a.round || 99) - (b.round || 99)) || (a.diff || 2) - (b.diff || 2));
    const per = 40, pages = Math.max(1, Math.ceil(list.length / per)); F.page = Math.min(F.page, pages - 1);
    const sel = (id, opts, v) => `<select class="input sm" id="${id}">${opts.map(([val, t]) => `<option value="${val}" ${String(v) === String(val) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
    main.innerHTML = `<div class="page-head"><h1>문제은행</h1><span class="sp"></span><button class="btn sm" id="imp">PDF · 사진에서 가져오기</button><button class="btn sm fill" id="new">새 문항</button></div>
      <div class="src4">${[["textbook", "교과서"], ["db", "내 문제 DB"], ["old", "기존 수행"], ["ai", "AI 변형"]].map(([k, n]) => `<button class="srcb" data-src="${k}" aria-pressed="${F.src === k}"><b class="num">${cnt(k).toLocaleString()}</b><small>${n}</small></button>`).join("")}</div>
      <div class="list-tools bankf">${sel("f-g", [[0, "전 학년"], [1, "중1"], [2, "중2"], [3, "중3"]], F.g)}${sel("f-s", [[0, "전 학기"], [1, "1학기"], [2, "2학기"]], F.sem)}${sel("f-r", [[0, "전 회차"], ...Array.from({ length: 10 }, (_, i) => [i + 1, `${i + 1}회`])], F.r)}${sel("f-d", [[0, "전 난이도"], [1, "★"], [2, "★★"], [3, "★★★"]], F.d)}
        <input class="input sm" id="f-q" type="search" placeholder="개념·본문·출처 검색" value="${esc(F.q)}"><span class="small muted num">${list.length.toLocaleString()}문항</span></div>
      <div class="qlist">${list.slice(F.page * per, F.page * per + per).map(it => `<div class="q"><div class="n small">${it.grade ? `중${it.grade}` : ""}<br>${it.sem ? it.sem + "-" : ""}${it.round || "–"}</div><div class="qbd"><div class="qb">${bodyHTML(it.body)}</div>${figTag(it)}
        <div class="meta">${srcChip(it)}${stars(it.diff)}<span class="muted small">${esc(it.concept || "")}</span>${it.testOnly ? `<span class="chip">테스트 전용</span>` : ""}${it.status === "check" ? `<span class="chip c-warn">검산 확인 필요</span>` : ""}${it.status === "draft" ? `<span class="chip c-warn">확인 전</span>` : ""}</div>
        ${it.answer ? `<div class="qans small"><b>정답</b> ${bodyHTML(it.answer)}</div>` : ""}</div><div class="acts"><button class="btn sm" data-edit="${it.id}">고치기</button></div></div>`).join("") || `<p class="empty-state">문항이 없어요. ‘PDF · 사진에서 가져오기’로 교과서 · 내 문제 · 기존 수행평가 자료를 넣어 주세요.</p>`}</div>
      ${pages > 1 ? `<div class="rowx pager"><button class="btn sm" id="pv" ${F.page ? "" : "disabled"}>이전</button><span class="small num">${F.page + 1} / ${pages}</span><button class="btn sm" id="nx" ${F.page < pages - 1 ? "" : "disabled"}>다음</button></div>` : ""}`;
    math(main); paintFigs(main);
    const re = () => { F.page = 0; paint(); };
    C.$("#f-g").onchange = e => { F.g = +e.target.value; re(); };
    C.$("#f-s").onchange = e => { F.sem = +e.target.value; re(); };
    C.$("#f-r").onchange = e => { F.r = +e.target.value; re(); };
    C.$("#f-d").onchange = e => { F.d = +e.target.value; re(); };
    C.$("#f-q").onchange = e => { F.q = e.target.value; re(); };
  };
  paint();
  main.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.src) { F.src = F.src === b.dataset.src ? "" : b.dataset.src; F.page = 0; return paint(); }
    if (b.dataset.edit) return openItemEditor(BANK.items[b.dataset.edit], () => viewBank());
    if (b.id === "new") return openItemEditor({ grade: F.g || 1, sem: F.sem || TERM.sem, round: F.r || 0, diff: 2, source: { type: F.src || "db", ref: "" } }, () => viewBank());
    if (b.id === "imp") return openImport();
    if (b.id === "pv") { F.page--; return paint(); }
    if (b.id === "nx") { F.page++; return paint(); }
  };
}

// PDF · 사진 → 쪽 이미지 → 분석 서버가 문항 · 정답 · 채점기준 · 그림 위치 초안 → 확인 후 저장
function openImport() {
  const I = { pages: [], drafts: [], busy: false };
  const el = C.sheet(`<div class="grab"></div><h4>PDF · 사진에서 문항 가져오기</h4>
    <p class="small muted">교과서 · 내 문제 DB(MYBOX · 내 PC 폴더) · 기존 수행평가 PDF를 올리면 AI가 문항을 하나씩 나눠 초안을 만들어요. 확인하고 고친 뒤 저장하면 문제은행에 들어가요. 한 번에 20쪽까지가 편해요. HWP는 PDF로 저장해서 올려 주세요.</p>
    <div class="row3"><label class="small muted">학년<select class="input" id="i-g">${[1, 2, 3].map(x => `<option value="${x}">중${x}</option>`).join("")}</select></label>
      <label class="small muted">학기<select class="input" id="i-s">${[1, 2].map(x => `<option value="${x}" ${x === TERM.sem ? "selected" : ""}>${x}학기</option>`).join("")}</select></label>
      <label class="small muted">회차<select class="input" id="i-r"><option value="0">AI가 추정</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}회</option>`).join("")}</select></label>
      <label class="small muted">출처<select class="input" id="i-src">${Object.entries(SRC).filter(([k]) => k !== "ai").map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join("")}</select></label></div>
    <label class="small muted">출처 상세 (파일 이름 · 교재 이름)<input class="input" id="i-ref" placeholder="예: 중2 천재 교과서 / 2026 2학기 수행 3회"></label>
    <div class="rowx"><label class="btn fill">파일 고르기<input type="file" id="i-f" accept="application/pdf,image/*" multiple hidden></label><span class="small muted" id="i-st"></span></div>
    <div class="qlist" id="i-list" style="max-height:52vh;overflow:auto"></div>
    <div class="acts"><button class="btn" data-close>닫기</button><button class="btn fill" id="i-save" disabled>골라서 저장</button></div>`);
  const st = t => C.$("#i-st", el).textContent = t;
  C.$("[data-close]", el).onclick = C.closeSheet;
  C.$("#i-f", el).onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    const g = +C.$("#i-g", el).value, sem = +C.$("#i-s", el).value;
    st("쪽 나누는 중…");
    const blobs = await filesToPageBlobs(files, (n, t) => st(`쪽 나누는 중 ${n}/${t}`));
    I.pages = blobs; I.drafts = [];
    for (let i = 0; i < blobs.length; i += 2) {
      st(`문항 읽는 중 ${Math.min(blobs.length, i + 2)}/${blobs.length}쪽`);
      const imgs = await Promise.all(blobs.slice(i, i + 2).map(b => shrinkBlob(b, 1600, 0.72)));
      try {
        const got = await requestExtract({ store: C.S.store, images: imgs, grade: g, sem, hint: C.$("#i-ref", el).value });
        got.forEach(it => I.drafts.push({ ...it, page: i + it.page, use: true }));
      } catch (x) { C.toast(`${i + 1}쪽을 읽지 못했어요: ${x.message}`, 4000); }
      paint();
    }
    st(`${blobs.length}쪽에서 ${I.drafts.length}문항을 찾았어요. 확인하고 저장해 주세요.`);
  };
  const paint = () => {
    C.$("#i-list", el).innerHTML = I.drafts.map((d, i) => `<div class="q"><div class="n"><input type="checkbox" data-u="${i}" ${d.use ? "checked" : ""} aria-label="저장할 문항"></div><div class="qbd"><div class="qb">${bodyHTML(d.body)}</div>
      <div class="meta"><span class="small muted">${d.page + 1}쪽</span>${stars(d.diff)}<span class="muted small">${esc(d.concept || "")}</span>${d.round ? `<span class="small muted">${d.round}회 추정</span>` : ""}${d.figure ? `<span class="chip">그림 포함</span>` : ""}</div>
      ${d.answer ? `<div class="qans small"><b>정답</b> ${bodyHTML(d.answer)}</div>` : ""}</div></div>`).join("");
    math(C.$("#i-list", el));
    C.$("#i-save", el).disabled = !I.drafts.some(d => d.use);
  };
  C.$("#i-list", el).onchange = e => { const c = e.target.closest("[data-u]"); if (c) { I.drafts[+c.dataset.u].use = c.checked; C.$("#i-save", el).disabled = !I.drafts.some(d => d.use); } };
  C.$("#i-save", el).onclick = async e => {
    const g = +C.$("#i-g", el).value, sem = +C.$("#i-s", el).value, r0 = +C.$("#i-r", el).value, src = C.$("#i-src", el).value, ref = C.$("#i-ref", el).value.trim();
    C.busy(e.currentTarget, true, "저장 중"); let n = 0;
    for (const d of I.drafts.filter(x => x.use)) {
      const round = r0 || (+d.round || 0);
      const it = { grade: g, sem, round, unit: unitOf(g, round, sem), concept: d.concept || "", diff: Math.max(1, Math.min(3, +d.diff || 2)), body: d.body || "", answer: d.answer || "", criteria: d.criteria || "",
        source: { type: src, ref: ref ? `${ref} p.${d.page + 1}` : `p.${d.page + 1}` }, status: "ok", by: C.S.user.email, at: Date.now() };
      const id = await C.S.store.setX("items", null, it);
      if (d.figure && I.pages[d.page]) {
        try { const fig = await cropFigure(I.pages[d.page], d.figure); if (fig) { await C.S.store.setX("figs", id, { data: fig }, false); it.figId = id; BANK.figs[id] = fig; await C.S.store.setX("items", id, { figId: id }); } } catch (x) { /* 그림은 나중에 넣을 수 있다 */ }
      }
      BANK.items[id] = { id, ...it }; n++;
    }
    C.toast(`${n}문항을 문제은행에 넣었어요`); C.closeSheet(); viewBank();
  };
}
async function cropFigure(blob, box) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((ok, no) => { const x = new Image(); x.onload = () => ok(x); x.onerror = no; x.src = url; });
    const [x0, y0, x1, y1] = box.map(v => Math.max(0, Math.min(1000, +v || 0)));
    if (x1 - x0 < 20 || y1 - y0 < 20) return null;
    const W = im.naturalWidth, H = im.naturalHeight, sx = x0 / 1000 * W, sy = y0 / 1000 * H, sw = (x1 - x0) / 1000 * W, sh = (y1 - y0) / 1000 * H;
    const k = Math.min(1, 900 / Math.max(sw, sh)), c = document.createElement("canvas");
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

/* ================================================================ 학습지 인쇄 (A4, 오른쪽 위 이름 칸) */
async function prepItems(ids) {
  return Promise.all(ids.map(async id => { const it = BANK.items[id] || {}; return { ...it, fig: it.figId ? await getFigure(C.S.store, it.figId) : null }; }));
}
async function printHost(html) {
  document.getElementById("print-host")?.remove();
  const host = document.createElement("div"); host.id = "print-host"; host.className = "ws-host"; host.innerHTML = html;
  document.body.appendChild(host); math(host);
  await Promise.all([...host.querySelectorAll("img")].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); host.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 60);
}
// pages: [{title, sub, name?, ids, focus?}] → 학생 · 세트마다 10문항을 6 + 4 로 두 쪽에
export async function printSheets(pages) {
  const out = [];
  for (const p of pages) {
    const items = await prepItems(p.ids);
    const chunks = [items.slice(0, 6), items.slice(6, 10)].filter(c => c.length);
    chunks.forEach((ch, ci) => out.push(`<section class="ws-page">
      <header class="ws-h"><div><img src="img/logo-black.png" alt="수학도서관"><div class="ws-t">${esc(p.title)}<small>${esc(p.sub)}</small></div></div>
        <table class="ws-name"><tr><th>이름</th><td class="nm">${esc(p.name || "")}</td></tr><tr><th>날짜</th><td></td></tr><tr><th>점수</th><td class="num">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ ${items.length * 5}</td></tr></table></header>
      ${ci === 0 && p.focus && p.focus.length ? `<div class="ws-focus"><b>이번에 다지는 부분</b>${p.focus.map(f => `<span>${esc(f)}</span>`).join("")}</div>` : ""}
      <div class="ws-grid">${ch.map((it, k) => { const no = ci * 6 + k + 1; return `<div class="ws-q"><div class="ws-qh"><b>${no}</b>${it.concept ? `<span class="ws-tag">${esc(it.concept)}</span>` : ""}<span class="ws-pts">5점</span></div><div class="ws-body">${bodyHTML(it.body)}</div>${it.fig ? `<img class="ws-fig" src="${it.fig}" alt="">` : ""}<div class="ws-ans">풀이</div></div>`; }).join("")}</div>
      <footer class="ws-f"><span>수학도서관 · 수행평가 · 서술형 프로그램</span><span>${ci + 1} / ${chunks.length}</span></footer></section>`));
  }
  if (!out.length) { C.toast("인쇄할 문항이 없어요"); return; }
  printHost(out.join(""));
}
export async function printKey({ title, sub, ids }) {
  const items = await prepItems(ids);
  printHost(`<section class="ws-page"><header class="ws-h"><div><img src="img/logo-black.png" alt="수학도서관"><div class="ws-t">${esc(title)}<small>${esc(sub)} · 선생님용</small></div></div></header>
    <table class="ws-key"><thead><tr><th>번호</th><th>정답</th><th>채점기준 (5점)</th></tr></thead><tbody>${items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${bodyHTML(it.answer)}</td><td>${bodyHTML(it.criteria)}</td></tr>`).join("")}</tbody></table>
    <footer class="ws-f"><span>수학도서관 · 수행평가 · 서술형 프로그램</span><span>정답 · 채점기준</span></footer></section>`);
}
