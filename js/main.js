// 수행평가·서술형 프로그램 관리 앱
import { createStore, DEMO, newToken } from "./store.js";
import { UNITS } from "./rubric.js";
import { rubricFor, filesToJpegs, requestAnalysis, requestComment, ERROR_TYPES } from "./analyze.js";
import { buildReport, renderReport, reportToBlob, classAverages, takenRounds, PARTS, esc, fmt, unitBr } from "./report.js";
import { parseWorkbook } from "./excel-import.js";

const CFG = window.APP_CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $("#main");
const S = { store: null, user: null, students: [], records: {}, teachers: [], filter: { mine: null, grade: 0, q: "" }, ov: { grade: 1, teacher: "", status: "재원" }, pending: null };

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const shiftDay = (ymd, n) => { const d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const md = d => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "";
const isAdmin = () => S.user && S.user.role === "admin";
const stu = id => S.students.find(s => s.id === id);
const recs = id => S.records[id] || {};
const scored = x => x && typeof x.score === "number" && x.status !== "결시";

function toast(msg, ms = 2400) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms);
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn._t = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${label || ""}`; }
  else { btn.disabled = false; if (btn._t) btn.innerHTML = btn._t; }
}
function nextRound(id) { const r = recs(id); for (let i = 1; i <= 10; i++) if (!r[i]) return i; return null; }
function lastAt(id) { return Math.max(0, ...Object.values(recs(id)).map(x => x.at || 0)); }

/* ================================================================ 시작 */
async function boot() {
  try { S.store = await createStore(); }
  catch (e) { main.innerHTML = `<div class="empty-state">앱을 시작하지 못했습니다. 인터넷 연결을 확인해 주세요.<br><small>${esc(e.message)}</small></div>`; return; }
  S.store.onAuth(async u => {
    S.user = u;
    if (!u) return renderLogin();
    if (!u.registered) return renderNotRegistered();
    await loadAll();
    renderChrome();
    route();
  });
}
async function loadAll() {
  const [st, rc, th] = await Promise.all([S.store.listStudents(), S.store.listRecords(), S.store.listTeachers().catch(() => [])]);
  S.students = st.sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, "ko"));
  S.records = rc; S.teachers = th;
  if (S.filter.mine == null) S.filter.mine = !isAdmin() && S.students.some(s => s.teacher === S.user.name);
}
window.addEventListener("hashchange", () => S.user && S.user.registered && route());

const NAV = [
  ["#/", "입력", '<path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'],
  ["#/overview", "현황", '<path d="M4 5h16v14H4zM4 10h16M10 10v9" fill="none" stroke="currentColor" stroke-width="1.8"/>'],
  ["#/reports", "리포트", '<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'],
  ["#/admin", "관리", '<circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6" fill="none" stroke="currentColor" stroke-width="1.8"/>']
];
function renderChrome() {
  const nav = NAV.filter(n => n[0] !== "#/admin" || isAdmin());
  $("#topnav").innerHTML = nav.map(n => `<a href="${n[0]}">${n[1]}</a>`).join("");
  $("#botnav").style.setProperty("--n", nav.length);
  $("#botnav").innerHTML = nav.map(n => `<a href="${n[0]}"><svg viewBox="0 0 24 24" aria-hidden="true">${n[2]}</svg>${n[1]}</a>`).join("");
  $("#who").innerHTML = `${DEMO ? '<span class="demo-flag">데모</span>' : ""}<span>${esc(S.user.name || S.user.email)}</span><button id="logout">로그아웃</button>`;
  $("#logout").onclick = () => S.store.signOut();
  $("#topbar").hidden = false; $("#botnav").hidden = false;
}
function markNav(h) {
  const base = h.startsWith("#/s/") || h.startsWith("#/a/") || h === "#/" || h === "" ? "#/" : h.startsWith("#/r/") ? "#/reports" : h.split("?")[0];
  $$("#topnav a, #botnav a").forEach(a => a.getAttribute("href") === base ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
}
function route() {
  const h = location.hash || "#/";
  markNav(h); closeSheet(); window.scrollTo(0, 0);
  const p = h.slice(2).split("/");
  if (p[0] === "s" && stu(p[1])) return viewStudent(p[1], p[2] ? +p[2] : null);
  if (p[0] === "a" && stu(p[1])) return viewAnalysis(p[1], +p[2]);
  if (p[0] === "overview") return viewOverview();
  if (p[0] === "reports") return viewReports();
  if (p[0] === "r" && stu(p[1])) return viewReport(p[1], +(p[2] ?? 1));
  if (p[0] === "admin" && isAdmin()) return viewAdmin();
  return viewList();
}

/* ================================================================ 로그인 */
function renderLogin() {
  $("#topbar").hidden = true; $("#botnav").hidden = true;
  main.innerHTML = `<div class="login"><div class="box">
    <img src="img/logo.png" alt="수학도서관">
    <h1>${esc(CFG.programName)}</h1>
    <p class="muted">선생님 구글 계정으로 로그인해 주세요.</p>
    <button class="gbtn" id="g"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>${DEMO ? "데모로 둘러보기" : "Google 계정으로 로그인"}</button>
    ${DEMO ? `<p class="small muted">아직 Firebase가 연결되지 않아 데모 모드로 열립니다. 예시 학생으로 모든 기능을 써 볼 수 있고, 입력한 내용은 이 브라우저에만 저장됩니다.</p>` : ""}
    <p class="small" id="lerr" style="color:var(--bad)"></p>
  </div></div>`;
  $("#g").onclick = async e => { busy(e.currentTarget, true, "로그인 중"); try { await S.store.signIn(); } catch (x) { $("#lerr").textContent = "로그인하지 못했습니다: " + (x.code || x.message); busy(e.currentTarget, false); } };
}
function renderNotRegistered() {
  $("#topbar").hidden = true; $("#botnav").hidden = true;
  main.innerHTML = `<div class="login"><div class="box"><img src="img/logo.png" alt="수학도서관">
    <h1>등록되지 않은 계정입니다</h1>
    <p class="muted">${esc(S.user.email)} 계정은 아직 선생님으로 등록되지 않았습니다. 원장님께 등록을 요청해 주세요.</p>
    <button class="btn" id="out">다른 계정으로 로그인</button></div></div>`;
  $("#out").onclick = () => S.store.signOut();
}

/* ================================================================ 학생 목록 (입력 시작) */
function viewList() {
  const f = S.filter;
  const q = f.q.trim();
  let list = S.students.filter(s => (!f.mine || s.teacher === S.user.name) && (!f.grade || s.grade === f.grade) && (!q || s.name.includes(q) || (s.school || "").includes(q)));
  list.sort((a, b) => (a.status !== "재원") - (b.status !== "재원") || lastAt(b.id) - lastAt(a.id) || a.name.localeCompare(b.name, "ko"));
  main.innerHTML = `<div class="page-head"><h1>점수 입력</h1><span class="sp"></span><span class="muted small">${list.length}명</span></div>
    <div class="list-tools">
      <input class="input" id="q" type="search" placeholder="학생 이름·학교 검색" value="${esc(f.q)}" aria-label="학생 검색" autocomplete="off">
      <div class="chips" id="fchips">
        <button data-mine="1" aria-pressed="${!!f.mine}">내 학생</button><button data-mine="0" aria-pressed="${!f.mine}">전체</button>
        ${[0, 1, 2, 3].map(g => `<button data-g="${g}" aria-pressed="${f.grade === g}">${g ? "중" + g : "전 학년"}</button>`).join("")}
      </div>
    </div>
    <div class="stu-list">${list.map(stuCard).join("") || `<div class="empty-state">${f.mine ? "담당 학생이 없습니다. '전체'를 눌러 보세요." : "학생이 없습니다. 관리 화면에서 엑셀을 가져오거나 학생을 추가해 주세요."}</div>`}</div>`;
  const qi = $("#q");
  qi.oninput = () => { f.q = qi.value; const pos = qi.selectionStart; viewList(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  $("#fchips").onclick = e => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.mine) f.mine = b.dataset.mine === "1"; if (b.dataset.g) f.grade = +b.dataset.g; viewList(); };
}
function stuCard(s) {
  const r = recs(s.id), nx = nextRound(s.id), n = Object.values(r).filter(scored).length;
  return `<a class="stu ${s.status !== "재원" ? "off" : ""}" href="#/s/${s.id}">
    <span class="r1"><b>${esc(s.name)} <small>${esc(s.school)} · 중${s.grade}${s.teacher ? " · " + esc(s.teacher) : ""}</small></b><small class="num">${s.status !== "재원" ? `<span class="pill">${s.status}</span>` : `${n}/10`}</small></span>
    <span class="dots">${Array.from({ length: 10 }, (_, k) => { const x = r[k + 1]; return `<i class="${x && x.analyzed ? "an" : scored(x) ? "on" : ""}"></i>`; }).join("")}</span>
    <span class="next">${nx == null ? "10회 모두 기록됨" : `다음 빈 회차: ${nx}회 ${esc(UNITS[s.grade][nx - 1])}`}</span></a>`;
}

/* ================================================================ 학생 상세 + 입력 시트 */
function viewStudent(id, openRound) {
  const s = stu(id), r = recs(id), g = s.grade;
  const v = Object.values(r).filter(scored).map(x => x.score);
  const t = takenRounds(r), nx = nextRound(id);
  main.innerHTML = `<div class="narrow" style="max-width:900px">
    <div class="stu-head"><a class="back" href="#/" aria-label="목록으로">‹</a>
      <div style="flex:1;min-width:0"><h1>${esc(s.name)}</h1><div class="meta">${esc(s.school)} · 중${g} · 담당 ${esc(s.teacher || "미지정")}${s.status !== "재원" ? ` · <span class="pill bad">${s.status}</span>` : ""}</div></div>
      <button class="btn sm" id="edit-stu">정보 수정</button></div>
    <div class="sum num"><div>응시<b>${v.length}/10</b></div><div>평균<b>${v.length ? fmt(v.reduce((a, b) => a + b, 0) / v.length) : "–"}</b></div><div>최근 응시<b>${t.length ? t[t.length - 1].round + "회" : "–"}</b></div></div>
    <div class="rounds">${UNITS[g].map((u, i) => {
      const k = i + 1, x = r[k];
      const cls = !x && k === nx ? "todo" : !x ? "empty" : "";
      const right = !x ? (k === nx ? `<span class="sc">+ 입력</span>` : "") : x.status === "결시" ? `<span class="pill">결시</span>` : x.status === "채점불가" ? `<span class="pill">채점불가</span>` : `<span class="sc num">${fmt(x.score)}${x.analyzed ? '<small style="color:var(--gold)">분석 완료</small>' : ""}</span>`;
      const sub = x ? `<small class="num">${md(x.date)}${x.guess ? ' · <span style="color:var(--warn)">회차 확인 필요</span>' : ""}</small>` : "";
      return `<button class="rnd ${cls}" data-r="${k}"><span class="no">${k}회</span><span class="u">${unitBr(g, k)}${sub}</span>${right}</button>`;
    }).join("")}</div>
    <div class="stu-actions"><a class="btn" href="#/r/${id}/1">리포트 보기</a></div>
    <p class="small muted">회차는 순서와 상관없이 아무 칸이나 눌러 입력할 수 있습니다. 리포트는 응시한 날짜 순서대로 5회씩 묶습니다.</p></div>`;
  $(".rounds").onclick = e => { const b = e.target.closest(".rnd"); if (b) openInput(id, +b.dataset.r); };
  $("#edit-stu").onclick = () => openStudentForm(s);
  if (openRound) openInput(id, openRound);
}

function closeSheet() { $("#sheet-host").innerHTML = ""; document.body.style.overflow = ""; }
function sheet(html) {
  $("#sheet-host").innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.style.overflow = "hidden";
  $("#sheet-host .scrim").onclick = closeSheet;
  return $("#sheet-host .sheet");
}

function openInput(id, k) {
  const s = stu(id), x = recs(id)[k];
  const st = { val: x && typeof x.score === "number" ? String(x.score) : "", date: x?.date || today(), status: x?.status || "응시" };
  const el = sheet(`<div class="grab"></div>
    <h4>${k}회 · ${esc(UNITS[s.grade][k - 1])}<small>${esc(s.name)}</small></h4>
    <div class="sdate" id="sd"></div>
    <div class="disp num"><b id="dv"></b><span>/ 50</span></div>
    <div class="err-msg" id="em"></div>
    <div class="pad num" id="pad">${["1", "2", "3", "4", "5", "6", "7", "8", "9", ".5", "0", "⌫"].map(c => `<button type="button" data-k="${c}" aria-label="${c === "⌫" ? "지우기" : c}">${c}</button>`).join("")}</div>
    <div class="chips" id="stc">${["응시", "결시", "채점불가"].map(c => `<button type="button" data-s="${c}">${c}</button>`).join("")}</div>
    <div class="acts"><button class="btn" id="sv-scan">저장 + 시험지 올리기</button><button class="btn fill" id="sv">저장</button></div>
    <div class="row">${x ? `<button class="btn sm danger" id="del">기록 지우기</button>` : ""}${x && x.analyzed ? `<a class="btn sm gold" href="#/a/${id}/${k}">분석 결과 보기</a>` : ""}<span class="small muted" style="margin-left:auto">${x && x.by ? `마지막 저장 ${esc(String(x.by).split("@")[0])}` : ""}</span></div>
    <input type="file" id="scanf" accept="image/*,application/pdf" multiple hidden>`);
  const paint = () => {
    const t = today(), y = shiftDay(t, -1), other = st.date !== t && st.date !== y;
    $("#sd", el).innerHTML = `<button type="button" data-d="${t}" aria-pressed="${st.date === t}">오늘 ${md(t)}</button><button type="button" data-d="${y}" aria-pressed="${st.date === y}">어제 ${md(y)}</button><label aria-pressed="${other}">${other ? md(st.date) : "날짜 선택"}<input type="date" id="dpick" value="${st.date}" aria-label="날짜 선택"></label>`;
    const n = parseFloat(st.val), bad = st.status === "응시" && st.val !== "" && (isNaN(n) || n > 50);
    $("#dv", el).textContent = st.status === "응시" ? (st.val || "0") : st.status;
    $("#em", el).textContent = bad ? "50점 이하로 입력해 주세요" : "";
    $$("#stc button", el).forEach(b => b.setAttribute("aria-pressed", b.dataset.s === st.status));
    $("#pad", el).style.opacity = st.status === "응시" ? 1 : .35;
    $("#dpick", el).onchange = e => { if (e.target.value) { st.date = e.target.value; paint(); } };
  };
  paint();
  $("#sd", el).onclick = e => { const b = e.target.closest("button"); if (b) { st.date = b.dataset.d; paint(); } };
  $("#stc", el).onclick = e => { const b = e.target.closest("button"); if (b) { st.status = b.dataset.s; paint(); } };
  $("#pad", el).onclick = e => {
    const b = e.target.closest("button"); if (!b || st.status !== "응시") return; const c = b.dataset.k;
    if (c === "⌫") st.val = st.val.slice(0, -1);
    else if (c === ".5") { if (st.val && !st.val.includes(".")) st.val += ".5"; }
    else if (!st.val.includes(".") && st.val.length < 2) st.val = (st.val === "0" ? "" : st.val) + c;
    paint();
  };
  const save = async () => {
    const n = parseFloat(st.val);
    if (st.status === "응시" && (st.val === "" || isNaN(n) || n < 0 || n > 50)) { $("#em", el).textContent = "점수를 0~50 사이로 입력해 주세요"; return false; }
    const rec = { date: st.date, status: st.status, score: st.status === "응시" ? n : null, guess: false, analyzed: !!(x && x.analyzed) };
    try {
      await S.store.saveRound(id, k, rec, S.user.email);
      S.records[id] = { ...recs(id), [k]: { ...rec, by: S.user.email, at: Date.now() } };
      return true;
    } catch (e) { toast("저장하지 못했습니다: " + e.message, 4000); return false; }
  };
  $("#sv", el).onclick = async e => { busy(e.currentTarget, true); if (await save()) { toast(`${k}회 ${st.status === "응시" ? fmt(parseFloat(st.val)) + "점" : st.status} 저장했어요`); closeSheet(); viewStudent(id); } else busy(e.currentTarget, false); };
  // 파일 선택 창은 버튼을 누른 순간에 열어야 휴대폰에서 막히지 않는다
  $("#sv-scan", el).onclick = () => {
    const n = parseFloat(st.val);
    if (st.status === "응시" && (st.val === "" || isNaN(n) || n > 50)) { $("#em", el).textContent = "점수를 먼저 입력해 주세요"; return; }
    $("#scanf", el).click();
  };
  $("#scanf", el).onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    if (await save()) { S.pending = { id, k, files }; closeSheet(); location.hash = `#/a/${id}/${k}`; }
  };
  const del = $("#del", el);
  if (del) del.onclick = async () => {
    if (!confirm(`${k}회 기록을 지울까요?`)) return;
    await S.store.saveRound(id, k, null, S.user.email);
    const r = { ...recs(id) }; delete r[k]; S.records[id] = r;
    toast(`${k}회 기록을 지웠어요`); closeSheet(); viewStudent(id);
  };
}

function teacherNames() {
  const set = new Set(S.teachers.filter(t => t.active !== false).map(t => t.name).filter(Boolean));
  S.students.forEach(s => s.teacher && set.add(s.teacher));
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}
function openStudentForm(s) {
  const isNew = !s;
  s = s || { name: "", school: "", grade: 1, teacher: S.user.role !== "admin" ? S.user.name : "", status: "재원" };
  const el = sheet(`<div class="grab"></div><h4>${isNew ? "학생 추가" : "학생 정보 수정"}</h4>
    <label class="small muted">이름<input class="input" id="f-n" value="${esc(s.name)}"></label>
    <label class="small muted">학교<input class="input" id="f-s" value="${esc(s.school)}" placeholder="예: 월촌"></label>
    <div class="row"><label class="small muted" style="flex:1">학년<select class="input" id="f-g">${[1, 2, 3].map(g => `<option value="${g}" ${s.grade === g ? "selected" : ""}>중${g}</option>`).join("")}</select></label>
    <label class="small muted" style="flex:1">상태<select class="input" id="f-st">${["재원", "휴원", "퇴원"].map(v => `<option ${s.status === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
    <label class="small muted">담당 선생님<input class="input" id="f-t" list="tlist" value="${esc(s.teacher || "")}"><datalist id="tlist">${teacherNames().map(n => `<option value="${esc(n)}">`).join("")}</datalist></label>
    <div class="acts"><button class="btn" data-close>취소</button><button class="btn fill" id="f-sv">저장</button></div>
    ${!isNew && isAdmin() ? `<button class="btn sm danger" id="f-del" style="align-self:flex-start">학생 삭제</button>` : ""}`);
  $("[data-close]", el).onclick = closeSheet;
  $("#f-sv", el).onclick = async e => {
    const d = { name: $("#f-n", el).value.trim(), school: $("#f-s", el).value.trim(), grade: +$("#f-g", el).value, teacher: $("#f-t", el).value.trim(), status: $("#f-st", el).value };
    if (!d.name) { toast("이름을 입력해 주세요"); return; }
    busy(e.currentTarget, true);
    const nid = await S.store.saveStudent(isNew ? d : { id: s.id, ...d });
    if (isNew) S.students.push({ id: nid, ...d }); else Object.assign(stu(s.id), d);
    toast("저장했어요"); closeSheet(); isNew ? (location.hash = `#/s/${nid}`) : route();
  };
  const del = $("#f-del", el);
  if (del) del.onclick = async () => {
    if (!confirm(`${s.name} 학생과 회차 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await S.store.deleteStudent(s.id); S.students = S.students.filter(x => x.id !== s.id);
    toast("삭제했어요"); closeSheet(); location.hash = "#/";
  };
}

/* ================================================================ 시험지 분석 */
async function viewAnalysis(id, k) {
  const s = stu(id), g = s.grade, x = recs(id)[k];
  const unit = UNITS[g][k - 1];
  const A = { images: [], result: null, saved: null, edit: false };
  main.innerHTML = `<div class="stu-head"><a class="back" href="#/s/${id}" aria-label="학생으로">‹</a>
      <div style="flex:1;min-width:0"><h1>${k}회 ${esc(unit)}</h1><div class="meta">${esc(s.name)} · ${esc(s.school)} 중${g} · 입력 점수 <b class="num">${scored(x) ? fmt(x.score) : "없음"}</b></div></div></div>
    <div class="ana">
      <div>
        <div class="drop" id="drop"><b>채점된 시험지 올리기</b><span>사진·스캔(PDF)을 여러 장 올릴 수 있어요</span>
          <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><label class="btn sm">사진 찍기<input type="file" accept="image/*" capture="environment" hidden id="cam"></label><label class="btn sm">파일 선택<input type="file" accept="image/*,application/pdf" multiple hidden id="pick"></label></div></div>
        <div class="thumbs" id="thumbs"></div>
        <button class="btn fill" id="go" style="width:100%;margin-top:12px" disabled>분석 시작</button>
        <div class="card ref"><b>분석 기준</b><span>중등 ${g}-2 채점기준표 · ${k}회 ${esc(unit)} 01~10번 (문항당 5점, 부분점수)</span><span>판독한 점수는 선생님이 확인 버튼을 눌러야 리포트에 반영됩니다. 점수 칸은 입력한 점수가 기준이고, 차이가 나면 알려 드립니다.</span></div>
      </div>
      <section class="card" id="res" style="min-width:0"><div class="empty-state">시험지를 올리고 '분석 시작'을 누르면 문항별 결과가 여기에 나옵니다.</div></section>
    </div>`;
  const paintThumbs = () => {
    $("#thumbs").innerHTML = A.images.map((u, i) => `<div style="position:relative"><img src="${u}" alt="${i + 1}쪽" data-i="${i}">${A.result && A.saved && !A.edit ? "" : `<button class="btn sm" data-rm="${i}" style="position:absolute;top:4px;right:4px;padding:0 7px;background:var(--surface)" aria-label="${i + 1}쪽 빼기">×</button>`}</div>`).join("");
    $("#go").disabled = !A.images.length;
    $("#go").textContent = A.saved ? "다시 분석" : "분석 시작";
  };
  const add = async files => {
    const b = $("#go"); busy(b, true, "사진 준비 중");
    try { A.images = [...A.images, ...await filesToJpegs(files)].slice(0, 6); }
    catch (e) { toast("파일을 읽지 못했습니다: " + e.message, 4000); }
    busy(b, false); paintThumbs();
  };
  $("#cam").onchange = e => add([...e.target.files]);
  $("#pick").onchange = e => add([...e.target.files]);
  const dz = $("#drop");
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); add([...e.dataTransfer.files]); };
  $("#thumbs").onclick = e => {
    const rm = e.target.closest("[data-rm]"); if (rm) { A.images.splice(+rm.dataset.rm, 1); paintThumbs(); return; }
    const im = e.target.closest("img"); if (im) { const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${im.src}" alt="">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); }
  };
  $("#go").onclick = async e => {
    busy(e.currentTarget, true, "분석 중 (20~40초)");
    try {
      A.result = await requestAnalysis({ store: S.store, grade: g, round: k, images: A.images, entered: scored(x) ? x.score : null });
      A.edit = true; paintResult();
    } catch (err) { toast(err.message, 5000); }
    busy(e.currentTarget, false); paintThumbs();
  };

  const rubric = rubricFor(g, k);
  function paintResult() {
    const R = A.result, ed = A.edit;
    R.items.forEach(it => { if (it.steps && it.steps.length) it.score = it.steps.reduce((a, st) => a + (+st.got || 0), 0); });
    R.total = R.items.reduce((a, it) => a + it.score, 0);
    const ent = scored(x) ? x.score : null, diff = ent == null ? null : R.total - ent;
    $("#res").innerHTML = `<div class="check"><b>판독 합계 <span class="num">${fmt(R.total)}</span> / 입력 점수 <span class="num">${ent == null ? "없음" : fmt(ent)}</span></b>
        ${diff == null ? "" : Math.abs(diff) < 0.01 ? '<span class="ok">일치</span>' : `<span class="diff">${diff > 0 ? "+" : ""}${fmt(diff)}점 차이</span><span class="small muted">입력 점수가 기준입니다. 필요하면 문항 점수를 고치거나 회차 점수를 수정하세요.</span>`}
        <span style="margin-left:auto">${A.saved && !ed ? `<span class="pill good">확인 완료</span>` : `<span class="pill gold">확인 전</span>`}</span></div>
      ${R.overall ? `<div class="overall">${esc(R.overall)}</div>` : ""}
      <ul class="items">${R.items.map((it, i) => {
        const rb = rubric[i] || {}, c = it.score === 5 ? "o" : it.score === 0 ? "x" : "p";
        return `<li class="item ${ed && it.score < 5 ? "open" : ""}" data-i="${i}"><button class="hd" type="button" aria-expanded="${ed && it.score < 5}"><span>${String(it.no).padStart(2, "0")}번</span><span class="num"><b>${fmt(it.score)}</b> / 5</span><span class="mk ${c}">${c === "o" ? "○" : c === "x" ? "×" : "△"}</span><span>${it.error_type && it.score < 5 ? `<span class="etag">${esc(it.error_type)}</span>` : ""}<span class="memo">${esc(it.memo || (it.score === 5 ? "채점기준 전 단계 충족" : ""))}</span>${it.unclear ? '<span class="unclear">글씨 판독 어려움</span>' : ""}</span><span class="chev">›</span></button>
          <div class="body"><div class="ans">정답: ${esc(rb.answer || "")}</div>
            <table>${it.steps.map((st, j) => { const kk = st.got >= st.max ? "k-y" : st.got <= 0 ? "k-n" : "k-h"; return `<tr><td class="g ${kk}">${kk === "k-y" ? "✓" : kk === "k-n" ? "✗" : "△"}</td><td>${esc(st.desc)}</td><td class="p num ${kk}">${ed ? `<input class="got num" type="number" step="0.5" min="0" max="${st.max}" value="${st.got}" data-i="${i}" data-j="${j}" aria-label="${it.no}번 ${j + 1}단계 점수">` : fmt(st.got)} / ${fmt(st.max)}</td></tr>`; }).join("")}</table>
            ${ed ? `<div class="edit"><select class="input" data-et="${i}" aria-label="오류 유형"><option value="">오류 유형 없음</option>${ERROR_TYPES.map(t => `<option ${it.error_type === t ? "selected" : ""}>${t}</option>`).join("")}</select><input class="input" data-memo="${i}" value="${esc(it.memo)}" placeholder="메모 (부모님 리포트에는 나가지 않아요)"></div>` : ""}
          </div></li>`;
      }).join("")}</ul>
      <div class="ana-foot">${ed ? `<button class="btn fill" id="confirm">확인하고 저장</button>${A.saved ? `<button class="btn" id="cancel">취소</button>` : ""}` : `<button class="btn" id="redit">판독 수정</button>`}<span class="small muted">${A.saved && A.saved.by ? `확인: ${esc(String(A.saved.by).split("@")[0])}` : ""}</span></div>`;
  }
  $("#res").addEventListener("click", e => {
    const h = e.target.closest(".hd"); if (h) { const li = h.parentElement; li.classList.toggle("open"); h.setAttribute("aria-expanded", li.classList.contains("open")); return; }
    if (e.target.id === "redit") { A.edit = true; paintResult(); paintThumbs(); }
    if (e.target.id === "cancel") { A.result = JSON.parse(JSON.stringify(A.saved)); A.edit = false; paintResult(); paintThumbs(); }
    if (e.target.id === "confirm") confirmSave(e.target);
  });
  $("#res").addEventListener("change", e => {
    const t = e.target, R = A.result; if (!R) return;
    if (t.classList.contains("got")) { const st = R.items[+t.dataset.i].steps[+t.dataset.j]; st.got = Math.max(0, Math.min(st.max, Math.round((+t.value || 0) * 2) / 2)); const open = $$(".item.open").map(l => l.dataset.i); paintResult(); open.forEach(i => $(`.item[data-i="${i}"]`)?.classList.add("open")); }
    if (t.dataset.et != null) R.items[+t.dataset.et].error_type = t.value;
    if (t.dataset.memo != null) R.items[+t.dataset.memo].memo = t.value;
  });
  async function confirmSave(btn) {
    busy(btn, true, "저장 중");
    try {
      const a = { ...A.result, entered: scored(x) ? x.score : null, confirmed: true, by: S.user.email, at: Date.now() };
      await S.store.saveAnalysis(id, k, a);
      if (A.images.length && (!A.saved || A.imagesChanged !== false)) await S.store.saveScans(id, k, A.images);
      const rec = { ...(recs(id)[k] || { date: today(), status: "응시", score: null }), analyzed: true };
      await S.store.saveRound(id, k, rec, S.user.email);
      S.records[id] = { ...recs(id), [k]: { ...rec, by: S.user.email, at: Date.now() } };
      A.saved = JSON.parse(JSON.stringify(a)); A.edit = false; paintResult(); paintThumbs();
      toast("분석 결과를 저장했어요. 리포트에 반영됩니다.");
    } catch (e) { toast("저장하지 못했습니다: " + e.message, 5000); busy(btn, false); }
  }

  // 기존 결과·스캔 불러오기, 또는 입력 화면에서 넘어온 사진
  const [saved, scans] = await Promise.all([S.store.getAnalysis(id, k), S.store.getScans(id, k).catch(() => [])]);
  if (saved) { A.saved = saved; A.result = JSON.parse(JSON.stringify(saved)); A.images = scans; paintResult(); }
  if (S.pending && S.pending.id === id && S.pending.k === k) { const f = S.pending.files; S.pending = null; A.images = []; await add(f); if (!saved) $("#go").click(); }
  paintThumbs();
}

/* ================================================================ 전체 현황 */
function viewOverview() {
  const o = S.ov, g = o.grade;
  if (o.teacher === "" && !isAdmin() && S.students.some(s => s.teacher === S.user.name)) o.teacher = S.user.name;
  const list = S.students.filter(s => s.grade === g && (!o.teacher || s.teacher === o.teacher) && (o.status === "전체" || s.status === "재원"));
  const cs = Array(11).fill(0), cn = Array(11).fill(0);
  const rows = list.map(s => {
    const r = recs(s.id), v = [];
    const cells = Array.from({ length: 10 }, (_, i) => {
      const k = i + 1, x = r[k];
      if (!x) return `<td class="c" data-s="${s.id}" data-r="${k}"></td>`;
      if (!scored(x)) return `<td class="c st" data-s="${s.id}" data-r="${k}">${x.status}</td>`;
      v.push(x.score); cs[k] += x.score; cn[k]++;
      return `<td class="c ${x.score >= 40 ? "hi" : x.score < 25 ? "lo" : ""} ${x.analyzed ? "an" : ""} ${x.guess ? "gs" : ""}" data-s="${s.id}" data-r="${k}" title="${md(x.date)}">${fmt(x.score)}</td>`;
    }).join("");
    return `<tr class="${s.status !== "재원" ? "off" : ""}"><td class="n"><a href="#/s/${s.id}">${esc(s.name)}<small>${esc(s.school)}</small></a></td><td>${esc(s.teacher || "")}</td>${cells}<td><b>${v.length ? fmt(v.reduce((a, b) => a + b, 0) / v.length) : ""}</b></td><td class="num">${v.length}</td></tr>`;
  }).join("");
  main.innerHTML = `<div class="page-head"><h1>전체 현황</h1><span class="sp"></span>
      <button class="btn sm" id="xls">엑셀 내려받기</button>${isAdmin() ? `<button class="btn sm" id="add-stu">학생 추가</button>` : ""}</div>
    <div class="ov-tools">
      <div class="chips" id="gch">${[1, 2, 3].map(x => `<button data-g="${x}" aria-pressed="${g === x}">중${x}</button>`).join("")}</div>
      <select id="tsel" aria-label="담당 선생님"><option value="">전체 담당</option>${teacherNames().map(n => `<option ${o.teacher === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <select id="ssel" aria-label="재원 상태"><option value="재원" ${o.status === "재원" ? "selected" : ""}>재원생만</option><option value="전체" ${o.status === "전체" ? "selected" : ""}>휴원·퇴원 포함</option></select>
      <span class="small muted">${list.length}명</span>
    </div>
    <div class="tblwrap"><table class="ov num"><thead><tr><th style="text-align:left">학생</th><th>담당</th>${UNITS[g].map((u, i) => `<th><b>${i + 1}회</b>${unitBr(g, i + 1)}</th>`).join("")}<th>평균</th><th>응시</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="14" class="empty-state">해당하는 학생이 없습니다.</td></tr>`}</tbody>
      <tfoot><tr><td class="n">회차 평균</td><td></td>${cs.slice(1).map((c, i) => `<td>${cn[i + 1] ? fmt(c / cn[i + 1]) : ""}</td>`).join("")}<td></td><td></td></tr></tfoot></table></div>
    <div class="legend"><span>칸을 누르면 바로 입력·수정</span><span><span style="color:var(--good)">■</span> 40점 이상</span><span><span style="color:var(--bad)">■</span> 25점 미만</span><span><span style="color:var(--gold)">●</span> 시험지 분석 완료</span><span><span style="color:var(--warn)">┅</span> 엑셀에서 회차를 추정한 칸 (확인 필요)</span><span>회차 평균은 응시한 학생만으로 계산</span></div>`;
  $("#gch").onclick = e => { const b = e.target.closest("button"); if (b) { o.grade = +b.dataset.g; viewOverview(); } };
  $("#tsel").onchange = e => { o.teacher = e.target.value; viewOverview(); };
  $("#ssel").onchange = e => { o.status = e.target.value; viewOverview(); };
  $("tbody").onclick = e => { const c = e.target.closest("td.c"); if (c) location.hash = `#/s/${c.dataset.s}/${c.dataset.r}`; };
  $("#xls").onclick = () => downloadExcel(g, list);
  const ad = $("#add-stu"); if (ad) ad.onclick = () => openStudentForm(null);
}

let xlsxReady = null;
function loadXLSX() {
  if (!xlsxReady) xlsxReady = new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error("엑셀 도구를 불러오지 못했습니다")); document.head.appendChild(s); });
  return xlsxReady;
}
async function downloadExcel(g, list) {
  const XLSX = await loadXLSX();
  const head = ["학생", "학교", "학년", "담당", "상태"]; UNITS[g].forEach((u, i) => head.push(`${i + 1}회 날짜`, `${i + 1}회 ${u}`)); head.push("평균", "응시");
  const aoa = [head];
  list.forEach(s => {
    const r = recs(s.id), row = [s.name, s.school, s.grade, s.teacher, s.status], v = [];
    for (let k = 1; k <= 10; k++) { const x = r[k]; row.push(x?.date || "", x ? (scored(x) ? x.score : x.status) : ""); if (scored(x)) v.push(x.score); }
    row.push(v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : "", v.length); aoa.push(row);
  });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `중${g}`);
  XLSX.writeFile(wb, `수행평가_중${g}_${today()}.xlsx`);
}

/* ================================================================ 리포트 목록 */
function viewReports() {
  const f = S.filter;
  const list = S.students.filter(s => (!f.mine || s.teacher === S.user.name) && (!f.grade || s.grade === f.grade) && s.status === "재원");
  main.innerHTML = `<div class="page-head"><h1>부모님 리포트</h1></div>
    <div class="list-tools"><div class="chips" id="fchips"><button data-mine="1" aria-pressed="${!!f.mine}">내 학생</button><button data-mine="0" aria-pressed="${!f.mine}">전체</button>${[0, 1, 2, 3].map(g => `<button data-g="${g}" aria-pressed="${f.grade === g}">${g ? "중" + g : "전 학년"}</button>`).join("")}</div>
    <p class="small muted" style="margin:0">리포트는 응시한 날짜 순서대로 묶습니다. 1차 = 처음 응시한 5회, 2차 = 그다음 5회. 회차 번호 순서와 달라도 괜찮습니다.</p></div>
    <div class="rp-list">${list.map(s => {
      const t = takenRounds(recs(s.id)), an = t.filter(x => x.analyzed).length;
      return `<div class="card rp-row"><div><b>${esc(s.name)}</b> <span class="small muted">${esc(s.school)} · 중${s.grade} · ${esc(s.teacher || "")}</span><div class="small muted">응시 ${t.length}회 · 시험지 분석 ${an}회</div></div>
        <div class="btns"><a class="btn sm ${t.length >= 5 ? "fill" : ""}" href="#/r/${s.id}/1" ${t.length ? "" : 'aria-disabled="true" style="opacity:.4;pointer-events:none"'}>1차</a><a class="btn sm ${t.length >= 10 ? "fill" : ""}" href="#/r/${s.id}/2" ${t.length > 5 ? "" : 'aria-disabled="true" style="opacity:.4;pointer-events:none"'}>2차</a></div></div>`;
    }).join("") || `<div class="empty-state">해당하는 학생이 없습니다.</div>`}</div>`;
  $("#fchips").onclick = e => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.mine) f.mine = b.dataset.mine === "1"; if (b.dataset.g) f.grade = +b.dataset.g; viewReports(); };
}

/* ================================================================ 리포트 만들기 */
const reportBase = () => location.href.split("#")[0].replace(/index\.html$/, "").replace(/[^/]*$/, "");
async function viewReport(id, part) {
  const s = stu(id);
  main.innerHTML = `<div class="empty-state"><span class="spinner"></span> 리포트를 준비하고 있어요</div>`;
  const key = `${id}_${part}`;
  const [analyses, draft] = await Promise.all([S.store.listAnalyses(id), S.store.getDraft(key)]);
  const avgs = classAverages(S.students, S.records);
  const D = { comments: { strengths: "", improve: "", plan: "", ...(draft?.comments || {}) }, token: draft?.token || null };
  const build = () => buildReport({ student: s, rounds: recs(id), analyses, avgs, part, comments: D.comments, cfg: CFG });
  let data = build();
  const t = takenRounds(recs(id));
  const canShare = !!(navigator.canShare && navigator.share);
  main.innerHTML = `<div class="stu-head"><a class="back" href="#/reports" aria-label="리포트 목록">‹</a><div style="flex:1;min-width:0"><h1>${esc(s.name)} 리포트</h1><div class="meta">${esc(s.school)} · 중${s.grade} · 응시 ${t.length}회</div></div></div>
    <div class="rp-layout">
      <div class="preview" id="pv"><div class="scale" id="sc"></div></div>
      <div class="rp-side">
        <div class="card"><h3>리포트 범위</h3><div class="chips" id="parts">${[1, 2, 0].map(p => `<button data-p="${p}" aria-pressed="${p === part}">${p === 0 ? "전체" : p + "차"}</button>`).join("")}</div>
          <p class="small muted" style="margin:8px 0 0">${esc(PARTS[part])} · 이번 리포트 회차: ${data.rows.map(r => r.round + "회").join(", ") || "없음"}</p></div>
        <div class="card"><h3>선생님 종합 의견</h3>
          <button class="btn sm gold" id="ai">점수·분석으로 초안 만들기</button>
          <label for="c1">잘하고 있어요</label><textarea class="input" id="c1">${esc(D.comments.strengths)}</textarea>
          <label for="c2">보완할 점</label><textarea class="input" id="c2">${esc(D.comments.improve)}</textarea>
          <label for="c3">다음 학습 계획</label><textarea class="input" id="c3">${esc(D.comments.plan)}</textarea>
          <button class="btn sm" id="savec" style="margin-top:8px">의견 저장</button></div>
        <div class="card"><h3>보내기</h3><div class="rp-btns">
          <button class="btn fill" id="copy">이미지 복사</button><button class="btn" id="dl">이미지 저장</button>
          ${canShare ? `<button class="btn" id="share" style="grid-column:span 2">카톡·문자로 이미지 보내기</button>` : ""}
          <button class="btn gold" id="link" style="grid-column:span 2">공유 링크 만들기</button></div>
          <div id="urlbox" style="margin-top:8px"></div>
          <p class="small muted" style="margin:8px 0 0">공유 링크는 로그인 없이 이 리포트만 열리며 휴대폰 화면에 맞춰 보입니다. 내용을 고친 뒤에는 링크를 다시 만들어야 반영됩니다(주소는 그대로).</p></div>
      </div></div>`;
  const paint = () => {
    data = build();
    $("#sc").innerHTML = renderReport(data);
    const w = $("#pv").clientWidth - 28, k = Math.min(1, w / 794);
    $("#sc").style.transform = `scale(${k})`;
    $("#pv").style.height = ($("#sc").offsetHeight * k + 28) + "px";
  };
  paint(); window.onresize = () => document.body.contains($("#sc")) && paint();
  const readC = () => { D.comments = { strengths: $("#c1").value.trim(), improve: $("#c2").value.trim(), plan: $("#c3").value.trim() }; };
  ["#c1", "#c2", "#c3"].forEach(sel => $(sel).oninput = () => { readC(); paint(); });
  $("#parts").onclick = e => { const b = e.target.closest("button"); if (b) location.hash = `#/r/${id}/${b.dataset.p}`; };
  $("#savec").onclick = async e => { readC(); busy(e.currentTarget, true); await S.store.saveDraft(key, { comments: D.comments, by: S.user.email, at: Date.now() }); busy(e.currentTarget, false); toast("의견을 저장했어요"); };
  $("#ai").onclick = async e => {
    if ((D.comments.strengths || D.comments.improve || D.comments.plan) && !confirm("지금 적힌 의견을 초안으로 바꿀까요?")) return;
    busy(e.currentTarget, true, "초안 만드는 중");
    try {
      const best = data.rows.reduce((a, r) => !a || r.score > a.score ? r : a, null);
      const summary = { grade: s.grade, part, rows: data.rows.map(r => ({ round: r.round, unit: r.unit, score: r.score, classAvg: r.classAvg == null ? null : Math.round(r.classAvg * 10) / 10, items: r.items, errors: r.errs })), avg: data.kpi.avg, classAvg: data.kpi.cavg, errors: data.errors, best: best?.score, bestUnit: best?.unit, topError: data.errors[0]?.[0] || "" };
      const c = await requestComment({ store: S.store, summary });
      $("#c1").value = c.strengths || ""; $("#c2").value = c.improve || ""; $("#c3").value = c.plan || "";
      readC(); paint(); toast("초안을 넣었어요. 읽어 보고 고친 뒤 저장해 주세요.", 3500);
    } catch (x) { toast(x.message, 5000); }
    busy(e.currentTarget, false);
  };
  const fname = () => `${s.name}_수행평가_${part === 0 ? "전체" : part + "차"}리포트.png`;
  const makeBlob = async btn => { busy(btn, true, "이미지 만드는 중"); try { readC(); return await reportToBlob(build()); } finally { busy(btn, false); } };
  $("#copy").onclick = async e => {
    const btn = e.currentTarget;
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error("이 브라우저는 이미지 복사를 지원하지 않아요. '이미지 저장'을 써 주세요.");
      busy(btn, true, "이미지 만드는 중");
      // 사파리는 클릭 직후에 clipboard.write를 불러야 하므로 Promise를 그대로 넘긴다
      await navigator.clipboard.write([new ClipboardItem({ "image/png": reportToBlob((readC(), build())) })]);
      toast("이미지를 복사했어요. 카톡 대화창에 붙여넣기 하세요.");
    } catch (x) { toast(x.message || "복사하지 못했어요. '이미지 저장'을 써 주세요.", 4500); }
    busy(btn, false);
  };
  $("#dl").onclick = async e => { const b = await makeBlob(e.currentTarget); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = fname(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const sh = $("#share");
  if (sh) sh.onclick = async e => {
    try { const b = await makeBlob(e.currentTarget); const file = new File([b], fname(), { type: "image/png" }); if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: `${s.name} 수행평가 리포트` }); else toast("이 휴대폰은 이미지 공유를 지원하지 않아요. '이미지 저장'을 써 주세요.", 4000); }
    catch (x) { if (x.name !== "AbortError") toast(x.message, 4000); }
  };
  const showUrl = u => { $("#urlbox").innerHTML = `<div class="share-url">${esc(u)}</div><div class="row" style="display:flex;gap:6px;margin-top:6px"><button class="btn sm" id="cpu">링크 복사</button><a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">열어 보기</a></div>`; $("#cpu").onclick = () => navigator.clipboard.writeText(u).then(() => toast("링크를 복사했어요"), () => toast("복사하지 못했어요. 주소를 길게 눌러 복사해 주세요.")); };
  const linkUrl = tk => `${reportBase()}report.html?id=${tk}`;
  if (D.token) showUrl(linkUrl(D.token));
  $("#link").onclick = async e => {
    readC(); busy(e.currentTarget, true, "링크 만드는 중");
    try {
      const tk = D.token || newToken();
      await S.store.saveReport(tk, { ...build(), sid: id, by: S.user.email });
      await S.store.saveDraft(key, { comments: D.comments, token: tk, by: S.user.email, at: Date.now() });
      D.token = tk; showUrl(linkUrl(tk));
      try { await navigator.clipboard.writeText(linkUrl(tk)); toast("링크를 만들고 복사했어요"); } catch (x) { toast("링크를 만들었어요"); }
    } catch (x) { toast("링크를 만들지 못했습니다: " + x.message, 5000); }
    busy(e.currentTarget, false);
  };
}

/* ================================================================ 관리 */
async function viewAdmin() {
  S.teachers = await S.store.listTeachers().catch(() => S.teachers);
  const scanCount = await S.store.countScans().catch(() => "?");
  main.innerHTML = `<div class="page-head"><h1>관리</h1></div><div class="admin">
    <section class="card"><h2>선생님 등록</h2>
      <p class="small muted" style="margin:0">명단 파일(엑셀·CSV)을 올리거나 "이름, 이메일"을 한 줄에 한 명씩 붙여넣은 뒤, 등록할 선생님만 골라 주세요. 이름은 학생 명단의 '담당' 이름과 같게 적어야 '내 학생'이 연결됩니다.</p>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn sm">명단 파일 올리기<input type="file" id="tfile" accept=".xlsx,.xls,.csv,.txt" hidden></label></div>
      <textarea class="input" id="tpaste" placeholder="김소연, kim@gmail.com&#10;예윤지, ye@gmail.com"></textarea>
      <button class="btn sm" id="tparse">명단 보기</button>
      <div id="tcand"></div>
      <h2 style="margin-top:6px">등록된 선생님</h2>
      <div class="scroll"><table><thead><tr><th>이름</th><th>이메일</th><th>권한</th><th></th></tr></thead><tbody id="tlist"></tbody></table></div>
    </section>
    <section class="card"><h2>엑셀에서 가져오기</h2>
      <p class="small muted" style="margin:0">'수행평가_중1·중2·중3' 시트의 학생과 점수를 가져옵니다. 이미 있는 학생(이름·학교·학년이 같음)은 앱에 없는 회차만 채웁니다. 얼리어답터 시트는 읽지 않습니다.</p>
      <label class="btn sm" style="align-self:flex-start">엑셀 파일 선택<input type="file" id="xfile" accept=".xlsx,.xls" hidden></label>
      <div id="xprev"></div>
    </section>
    <section class="card"><h2>학생</h2>
      <p class="small muted" style="margin:0">학생 ${S.students.length}명 · 재원 ${S.students.filter(s => s.status === "재원").length}명. 학생 정보 수정·삭제는 학생 화면의 '정보 수정'에서 합니다.</p>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="addst">학생 추가</button><button class="btn sm" id="backup">백업 파일 내려받기</button></div>
    </section>
    <section class="card"><h2>학기 정리</h2>
      <p class="small muted" style="margin:0">보관 중인 시험지 스캔 <b class="num">${scanCount}</b>장. 학기가 끝나면 스캔 원본만 일괄 삭제합니다. 점수와 분석 결과, 리포트는 남습니다.</p>
      <input class="input" id="delconf" placeholder="삭제하려면 '스캔 삭제'라고 입력" aria-label="삭제 확인">
      <button class="btn sm danger" id="delscan" disabled style="align-self:flex-start">스캔 원본 모두 삭제</button>
      ${DEMO ? `<button class="btn sm" id="reset" style="align-self:flex-start">데모 데이터 처음으로</button>` : ""}
    </section></div>`;
  paintTeachers();
  // 선생님 명단
  let cands = [];
  const showCands = () => {
    const known = new Set(S.teachers.map(t => t.email));
    $("#tcand").innerHTML = cands.length ? `<table><thead><tr><th><input type="checkbox" id="tall" aria-label="모두 선택"></th><th>이름</th><th>이메일</th><th>권한</th></tr></thead><tbody>${cands.map((c, i) => `<tr><td><input type="checkbox" data-c="${i}" ${known.has(c.email) ? "disabled" : ""} aria-label="${esc(c.name)} 선택"></td><td><input class="input" data-cn="${i}" value="${esc(c.name)}" style="padding:4px 8px"></td><td class="small">${esc(c.email)}${known.has(c.email) ? ' <span class="pill good">등록됨</span>' : ""}</td><td><select data-cr="${i}"><option value="teacher">선생님</option><option value="admin">관리자</option></select></td></tr>`).join("")}</tbody></table>
      <button class="btn fill sm" id="treg" style="margin-top:8px">선택한 선생님 등록</button>` : "";
    if (!cands.length) return;
    $("#tall").onchange = e => $$("#tcand [data-c]:not(:disabled)").forEach(x => x.checked = e.target.checked);
    $("#treg").onclick = async e => {
      const pick = $$("#tcand [data-c]:checked").map(x => +x.dataset.c);
      if (!pick.length) { toast("등록할 선생님을 골라 주세요"); return; }
      busy(e.currentTarget, true);
      for (const i of pick) await S.store.saveTeacher({ name: $(`[data-cn="${i}"]`).value.trim(), email: cands[i].email, role: $(`[data-cr="${i}"]`).value, active: true, addedAt: Date.now(), addedBy: S.user.email });
      S.teachers = await S.store.listTeachers(); toast(`${pick.length}명 등록했어요`); paintTeachers(); showCands();
    };
  };
  const parseLines = text => {
    const out = [], seen = new Set();
    text.split(/\r?\n/).forEach(line => {
      const em = (line.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [])[0]; if (!em) return;
      const e = em.toLowerCase(); if (seen.has(e)) return; seen.add(e);
      const name = line.replace(em, "").split(/[,\t;|]/).map(x => x.trim()).filter(x => x && !/@/.test(x) && !/^\d+$/.test(x))[0] || "";
      out.push({ name: name.replace(/T$|선생님$/, "").trim(), email: e });
    });
    return out;
  };
  $("#tparse").onclick = () => { cands = parseLines($("#tpaste").value); if (!cands.length) toast("이메일이 들어 있는 줄을 찾지 못했어요"); showCands(); };
  $("#tfile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let text = "";
    if (/\.(xlsx|xls)$/i.test(f.name)) { const XLSX = await loadXLSX(); const wb = XLSX.read(await f.arrayBuffer(), { type: "array" }); wb.SheetNames.forEach(n => text += XLSX.utils.sheet_to_csv(wb.Sheets[n]) + "\n"); }
    else text = await f.text();
    cands = parseLines(text); $("#tpaste").value = cands.map(c => `${c.name}, ${c.email}`).join("\n");
    toast(`${cands.length}명을 찾았어요. 등록할 선생님을 골라 주세요.`); showCands();
  };
  // 엑셀 가져오기
  $("#xfile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const XLSX = await loadXLSX();
    const res = parseWorkbook(XLSX.read(await f.arrayBuffer(), { type: "array" }), XLSX, CFG.year || new Date().getFullYear());
    const keyOf = s => `${s.name}|${s.school}|${s.grade}`;
    const exist = new Map(S.students.map(s => [keyOf(s), s]));
    const nNew = res.students.filter(s => !exist.has(keyOf(s))).length;
    const nRec = res.students.reduce((a, s) => a + Object.keys(s.rounds).length, 0);
    $("#xprev").innerHTML = `<p class="small" style="margin:0">읽은 시트: ${res.sheets.join(", ")}<br>학생 <b>${res.students.length}</b>명 (새 학생 ${nNew}명) · 회차 기록 <b>${nRec}</b>건 · 확인 필요 <b>${res.warnings.length}</b>건</p>
      ${res.warnings.length ? `<ul class="warn-list">${res.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <button class="btn fill sm" id="ximp" style="margin-top:8px">가져오기</button>`;
    $("#ximp").onclick = async ev => {
      busy(ev.currentTarget, true, "가져오는 중");
      let addS = 0, addR = 0;
      for (const s of res.students) {
        let ex = exist.get(keyOf(s)), id;
        if (!ex) { const d = { name: s.name, school: s.school, grade: s.grade, teacher: s.teacher, status: s.status }; id = await S.store.saveStudent(d); S.students.push({ id, ...d }); addS++; }
        else { id = ex.id; if (s.status !== "재원" && ex.status === "재원") { await S.store.saveStudent({ id, status: s.status }); ex.status = s.status; } }
        const cur = recs(id), add = {};
        for (const [r, x] of Object.entries(s.rounds)) if (!cur[r]) { add[r] = { date: x.date, score: x.score, status: x.note === "채점불가" ? "채점불가" : "응시", guess: x.guess, analyzed: false, by: "엑셀 가져오기", at: 0 }; addR++; }
        if (Object.keys(add).length) { await S.store.setRounds(id, add); S.records[id] = { ...cur, ...add }; }
      }
      busy(ev.currentTarget, false);
      $("#xprev").innerHTML = `<p class="small" style="color:var(--good)">학생 ${addS}명, 회차 기록 ${addR}건을 가져왔어요. 현황 화면에서 점선 칸(회차 추정)을 확인해 주세요.</p>`;
    };
  };
  $("#addst").onclick = () => openStudentForm(null);
  $("#backup").onclick = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), students: S.students, records: S.records, teachers: S.teachers }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `수행평가_백업_${today()}.json`; a.click();
  };
  $("#delconf").oninput = e => $("#delscan").disabled = e.target.value.trim() !== "스캔 삭제";
  $("#delscan").onclick = async e => { busy(e.currentTarget, true, "삭제 중"); const n = await S.store.deleteAllScans(); toast(`스캔 ${n}장을 삭제했어요`); viewAdmin(); };
  const rs = $("#reset"); if (rs) rs.onclick = () => { S.store.reset(); location.reload(); };
}
function paintTeachers() {
  const owners = (CFG.ownerEmails || []).map(x => x.toLowerCase());
  $("#tlist").innerHTML = S.teachers.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko")).map(t => `<tr><td>${esc(t.name)}</td><td class="small">${esc(t.email)}</td>
    <td><select data-role="${esc(t.email)}" ${owners.includes(t.email) ? "disabled" : ""}><option value="teacher" ${t.role !== "admin" ? "selected" : ""}>선생님</option><option value="admin" ${t.role === "admin" ? "selected" : ""}>관리자</option></select></td>
    <td>${owners.includes(t.email) ? "" : `<button class="btn sm danger" data-del="${esc(t.email)}">해제</button>`}</td></tr>`).join("") || `<tr><td colspan="4" class="muted small">아직 없습니다.</td></tr>`;
  $("#tlist").onchange = async e => { const s = e.target.closest("[data-role]"); if (s) { await S.store.saveTeacher({ email: s.dataset.role, role: s.value }); toast("권한을 바꿨어요"); } };
  $("#tlist").onclick = async e => { const b = e.target.closest("[data-del]"); if (b && confirm(`${b.dataset.del} 계정의 등록을 해제할까요?`)) { await S.store.deleteTeacher(b.dataset.del); S.teachers = S.teachers.filter(t => t.email !== b.dataset.del); paintTeachers(); toast("해제했어요"); } };
}

boot();
