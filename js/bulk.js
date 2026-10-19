// 시험지 일괄 올리기: 여러 학생 시험지를 한 파일로 올려 학생·회차별로 나누고 차례로 분석
import { UNITS } from "./rubric.js?v=6";
import { filesToPageBlobs, blobToDataURL, shrinkBlob, requestIdentify, requestAnalysis } from "./analyze.js?v=6";
import { esc, fmt } from "./report.js?v=6";

const B = { pages: [], thumbs: [], reads: [], groups: [], grade: 0, round: 0, fileName: "", running: null };
const ID_BATCH = 8, ID_PARALLEL = 2, AN_PARALLEL = 2, MAX_PAGES = 6;

export async function viewBulk(ctx) {
  const { S, main, $, toast } = ctx;
  const jobs = (await S.store.listJobs().catch(() => [])).sort((a, b) => (b.at || 0) - (a.at || 0));
  const open = jobs.filter(j => (j.items || []).some(i => i.status !== "done"));
  main.innerHTML = `<div class="stu-head"><a class="back" href="#/" aria-label="입력으로">‹</a><div style="flex:1;min-width:0"><h1>시험지 일괄 올리기</h1>
      <div class="meta">여러 학생 시험지를 한 파일로 스캔해 올리면 학생·회차별로 나눠 차례로 분석합니다</div></div></div>
    <div class="bulk">
      ${open.length ? `<section class="card bk"><h2>진행 중인 작업</h2>${open.map(j => { const d = (j.items || []).filter(i => i.status === "done").length; return `<div class="bk-row"><span><b>${esc(j.fileName || "일괄 작업")}</b> <span class="small muted">${new Date(j.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${esc(String(j.byName || ""))}</span><br><span class="small num">${d} / ${(j.items || []).length}건 완료</span></span><span class="row"><button class="btn sm fill" data-resume="${j.id}">이어서 진행</button><button class="btn sm" data-drop="${j.id}">목록에서 지우기</button></span></div>`; }).join("")}</section>` : ""}
      <section class="card bk" id="s1"></section>
      <section class="card bk" id="s2" hidden></section>
      <section class="card bk" id="s3" hidden></section>
      <section class="card bk" id="s4"></section>
    </div>`;
  main.onclick = async e => {
    const r = e.target.closest("[data-resume]"); if (r) { const j = jobs.find(x => x.id === r.dataset.resume); if (j) runJob(ctx, j); }
    const d = e.target.closest("[data-drop]"); if (d && confirm("이 작업을 목록에서 지울까요? 이미 끝난 분석 결과는 남습니다.")) { await S.store.deleteJob(d.dataset.drop); viewBulk(ctx); }
  };
  paintStep1(ctx); paintPending(ctx);
  if (S.jumpPending) { S.jumpPending = false; setTimeout(() => $("#s4")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); }
  if (B.groups.length && !B.running) paintGroups(ctx);
  if (B.running) paintRun(ctx, B.running);
}

/* ---------------- 1. 파일 올리기와 쪽 읽기 ---------------- */
function paintStep1(ctx) {
  const { $, S } = ctx;
  $("#s1").innerHTML = `<h2><span class="n">1</span>스캔 파일 올리기</h2>
    <label class="drop" id="bdrop"><input type="file" id="bfile" accept="application/pdf,image/*" multiple hidden>
      <b>PDF 또는 사진 여러 장 선택</b><span>${B.fileName ? `선택됨: ${esc(B.fileName)} · ${B.pages.length}쪽` : "학생마다 시험지를 순서대로 겹쳐 한꺼번에 스캔한 파일"}</span></label>
    <div class="row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <select id="bgrade" aria-label="학년"><option value="0">학년 자동 인식</option>${[1, 2, 3].map(g => `<option value="${g}" ${B.grade === g ? "selected" : ""}>중${g}만</option>`).join("")}</select>
      <select id="bround" aria-label="회차"><option value="0">회차 자동 인식</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${B.round === i + 1 ? "selected" : ""}>${i + 1}회만</option>`).join("")}</select>
      <button class="btn fill" id="bgo" ${B.pages.length ? "" : "disabled"}>쪽 나누기 시작</button>
      <span class="small muted" id="bmsg"></span></div>
    <p class="small muted" style="margin:0">컬러 200dpi로 스캔하고, 시험지 오른쪽 위 이름 칸에 학생 이름이 보이게 해 주세요. 한 번에 최대 400쪽. 쪽이 많으면 PC에서 하는 것이 빠릅니다.</p>`;
  $("#bgrade").onchange = e => B.grade = +e.target.value;
  $("#bround").onchange = e => B.round = +e.target.value;
  $("#bfile").onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    B.pages = []; B.thumbs = []; B.reads = []; B.groups = []; $("#s2").hidden = true;
    B.fileName = files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}개`;
    $("#bgo").disabled = true;
    try {
      B.pages = await filesToPageBlobs(files, (n, t) => $("#bmsg").textContent = `쪽 준비 중 ${n} / ${t}`);
      B.thumbs = await Promise.all(B.pages.map(b => shrinkBlob(b, 220, 0.6)));
    } catch (x) { ctx.toast("파일을 읽지 못했습니다: " + x.message, 5000); }
    paintStep1(ctx);
  };
  $("#bgo").onclick = () => identifyAll(ctx);
}

async function identifyAll(ctx) {
  const { S, $, toast } = ctx;
  const roster = S.students.filter(s => s.status !== "퇴원").map(s => ({ id: s.id, name: s.name, school: s.school, grade: s.grade }));
  const n = B.pages.length, batches = [];
  for (let i = 0; i < n; i += ID_BATCH) batches.push(i);
  B.reads = new Array(n);
  let done = 0, failed = 0, lastErr = "";
  $("#bgo").disabled = true;
  const worker = async () => {
    while (batches.length) {
      const off = batches.shift();
      const imgs = await Promise.all(B.pages.slice(off, off + ID_BATCH).map(b => shrinkBlob(b, 1200, 0.62)));
      try {
        const res = await requestIdentify({ store: S.store, images: imgs, roster, grade: B.grade, round: B.round, offset: off });
        res.forEach(p => { if (p.index >= off && p.index < off + imgs.length) B.reads[p.index] = p; });
      } catch (x) { failed++; lastErr = x.message; toast(x.message, 4000); }
      done += imgs.length; $("#bmsg").textContent = `쪽 읽는 중 ${Math.min(done, n)} / ${n}`;
    }
  };
  await Promise.all(Array.from({ length: ID_PARALLEL }, worker));
  for (let i = 0; i < n; i++) if (!B.reads[i]) B.reads[i] = { index: i, blank: false, name_read: "", student_id: "", candidates: [], grade: 0, round: 0, first_item: 0, failed: true };
  B.groups = buildGroups(ctx, B.reads);
  $("#bmsg").textContent = failed ? `일부 쪽을 읽지 못했어요 (${failed}묶음). 표에서 직접 골라 주세요. 원인: ${lastErr}` : `${n}쪽을 읽었어요.`;
  $("#bgo").disabled = false;
  paintGroups(ctx);
}

/* ---------------- 2. 묶음 만들기·확인 ---------------- */
function buildGroups(ctx, reads) {
  const { S } = ctx;
  const ids = new Set(S.students.map(s => s.id));
  const groups = []; let cur = null;
  for (const p of reads) {
    const sid = ids.has(p.student_id) ? p.student_id : "";
    const r = B.round || (p.round >= 1 && p.round <= 10 ? p.round : 0);
    if (p.blank) { groups.push(newGroup([p.index], { blank: true })); cur = null; continue; }
    const starts = !cur || cur.blank
      || (sid && cur.sid && sid !== cur.sid)
      || (r && cur.round && r !== cur.round)
      || (p.first_item === 1 && cur.hasFirst);
    if (starts) { cur = newGroup([]); groups.push(cur); }
    cur.pages.push(p.index);
    if (!cur.sid && sid) cur.sid = sid;
    if (!cur.round && r) cur.round = r;
    if (!cur.grade && p.grade) cur.grade = p.grade;
    if (p.name_read) cur.names.push(p.name_read);
    (p.candidates || []).forEach(c => ids.has(c) && !cur.cands.includes(c) && cur.cands.push(c));
    if (p.first_item === 1) cur.hasFirst = true;
  }
  return groups;
}
function newGroup(pages, extra = {}) { return { pages, sid: "", round: 0, grade: 0, names: [], cands: [], hasFirst: false, blank: false, skip: false, include: false, ...extra }; }

function groupState(ctx, g) {
  const { S, recs } = ctx;
  if (g.blank || g.skip) return { k: "skip", t: g.blank ? "빈 쪽 · 건너뜀" : "건너뜀" };
  const st = S.students.find(s => s.id === g.sid);
  if (!st) return { k: "warn", t: g.cands.length ? "학생을 골라 주세요" : "학생을 찾지 못했어요" };
  if (!g.round) return { k: "warn", t: "회차를 골라 주세요" };
  if (g.grade && st.grade !== g.grade) return { k: "warn", t: `머리글은 중${g.grade}, 학생은 중${st.grade}` };
  const x = recs(g.sid)[g.round];
  if (x && x.analyzed && !g.include) return { k: "skip", t: "이미 분석·확인됨 · 건너뜀", exists: true };
  if (g.pages.length > MAX_PAGES) return { k: "ok", t: `처음 ${MAX_PAGES}쪽만 분석` };
  return { k: "ok", t: x && typeof x.score === "number" && !x.aiScore ? "준비됨" : "점수 없음 → AI 점수로 채움(확인 필요)" };
}
const runnable = (ctx, g) => { const s = groupState(ctx, g); return s.k === "ok"; };

function paintGroups(ctx) {
  const { S, $, $$, recs } = ctx;
  const el = $("#s2"); el.hidden = false;
  const states = B.groups.map(g => groupState(ctx, g));
  const nOk = states.filter(s => s.k === "ok").length, nWarn = states.filter(s => s.k === "warn").length, nSkip = states.filter(s => s.k === "skip").length;
  const name = id => { const s = S.students.find(x => x.id === id); return s ? `${s.name} (${s.school} 중${s.grade})` : ""; };
  const studentOptions = g => {
    const pool = S.students.filter(s => s.status !== "퇴원" && (!g.grade || s.grade === g.grade)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return `<option value="">— 학생 선택 —</option>${g.cands.length ? `<optgroup label="후보">${g.cands.map(c => `<option value="${c}" ${g.sid === c ? "selected" : ""}>${esc(name(c))}</option>`).join("")}</optgroup>` : ""}
      <optgroup label="${g.grade ? "중" + g.grade : "전체"} 학생">${pool.filter(s => !g.cands.includes(s.id)).map(s => `<option value="${s.id}" ${g.sid === s.id ? "selected" : ""}>${esc(name(s.id))}</option>`).join("")}</optgroup>
      ${g.grade ? `<optgroup label="다른 학년">${S.students.filter(s => s.grade !== g.grade && s.status !== "퇴원").map(s => `<option value="${s.id}" ${g.sid === s.id ? "selected" : ""}>${esc(name(s.id))}</option>`).join("")}</optgroup>` : ""}`;
  };
  el.innerHTML = `<h2><span class="n">2</span>나누기 확인</h2>
    <div class="row" style="display:flex;flex-wrap:wrap;gap:6px"><span class="pill good">분석할 묶음 ${nOk}건</span>${nWarn ? `<span class="pill gold">확인 필요 ${nWarn}건</span>` : ""}${nSkip ? `<span class="pill">건너뜀 ${nSkip}건</span>` : ""}<span class="pill">${B.pages.length}쪽 → ${B.groups.length}묶음</span></div>
    <p class="small muted" style="margin:0">노란 줄만 학생·회차를 골라 주면 됩니다. 쪽이 잘못 묶였으면 '나누기'나 '앞과 합치기'를 쓰세요. 미리보기를 누르면 크게 보여요.</p>
    <div class="tblwrap"><table class="bk-tbl num"><thead><tr><th>쪽</th><th>미리보기</th><th>시험지에서 읽은 이름</th><th>학생</th><th>회차</th><th>앱 점수</th><th>상태</th><th></th></tr></thead><tbody>
    ${B.groups.map((g, i) => {
      const s = states[i], x = g.sid && g.round ? recs(g.sid)[g.round] : null;
      const pr = g.pages.length > 1 ? `${g.pages[0] + 1}–${g.pages[g.pages.length - 1] + 1}` : `${g.pages[0] + 1}`;
      return `<tr class="${s.k}" data-g="${i}"><td>${pr}</td>
        <td><span class="bk-th">${g.pages.slice(0, 3).map(p => `<img src="${B.thumbs[p] || ""}" alt="${p + 1}쪽" data-pg="${p}">`).join("")}${g.pages.length > 3 ? `<small>+${g.pages.length - 3}</small>` : ""}</span></td>
        <td>${esc([...new Set(g.names)].join(", ") || "(이름 없음)")}${g.grade ? `<small class="muted" style="display:block">머리글 중${g.grade}${g.round ? ` · ${g.round}회` : ""}</small>` : ""}</td>
        <td>${g.blank ? "–" : `<select class="input bk-sel" data-sid="${i}" aria-label="학생">${studentOptions(g)}</select>`}</td>
        <td>${g.blank ? "–" : `<select class="input bk-sel" data-rd="${i}" aria-label="회차"><option value="0">—</option>${Array.from({ length: 10 }, (_, k) => `<option value="${k + 1}" ${g.round === k + 1 ? "selected" : ""}>${k + 1}회</option>`).join("")}</select>`}</td>
        <td>${x ? (typeof x.score === "number" ? fmt(x.score) + (x.aiScore ? " (AI)" : "") : x.status) : (g.sid && g.round ? "없음" : "")}</td>
        <td><span class="st ${s.k}">${esc(s.t)}</span>${s.exists ? `<label class="small" style="display:block"><input type="checkbox" data-inc="${i}"> 다시 분석</label>` : ""}</td>
        <td class="bk-act">${i > 0 && !g.blank ? `<button class="btn sm" data-merge="${i}">앞과 합치기</button>` : ""}${g.pages.length > 1 ? `<button class="btn sm" data-split="${i}">나누기</button>` : ""}${!g.blank ? `<button class="btn sm" data-skip="${i}">${g.skip ? "되살리기" : "건너뛰기"}</button>` : ""}</td></tr>
        ${g.splitOpen ? `<tr class="bk-split"><td colspan="8">어느 쪽부터 새 묶음으로 나눌까요? ${g.pages.slice(1).map(p => `<button class="btn sm" data-cut="${i}:${p}">${p + 1}쪽부터</button>`).join(" ")}</td></tr>` : ""}`;
    }).join("")}</tbody></table></div>
    <div class="row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><button class="btn fill" id="bstart" ${nOk ? "" : "disabled"}>확정하고 분석 시작 (${nOk}건)</button><span class="small muted">결과는 '확인 전'으로 들어가고, 선생님이 확인해야 리포트에 반영됩니다.</span></div>`;
  el.onchange = e => {
    const t = e.target;
    if (t.dataset.sid != null) { const g = B.groups[+t.dataset.sid]; g.sid = t.value; const st = S.students.find(s => s.id === g.sid); if (st && !g.grade) g.grade = st.grade; }
    if (t.dataset.rd != null) B.groups[+t.dataset.rd].round = +t.value;
    if (t.dataset.inc != null) B.groups[+t.dataset.inc].include = t.checked;
    paintGroups(ctx);
  };
  el.onclick = e => {
    const b = e.target.closest("button, img[data-pg]"); if (!b) return;
    if (b.dataset.pg != null) { const lb = document.createElement("div"); lb.className = "lightbox"; const url = URL.createObjectURL(B.pages[+b.dataset.pg]); lb.innerHTML = `<img src="${url}" alt="">`; lb.onclick = () => { URL.revokeObjectURL(url); lb.remove(); }; document.body.appendChild(lb); return; }
    if (b.dataset.merge) { const i = +b.dataset.merge, a = B.groups[i - 1], g = B.groups[i]; if (a.blank) { a.blank = false; } a.pages.push(...g.pages); a.names.push(...g.names); g.cands.forEach(c => !a.cands.includes(c) && a.cands.push(c)); if (!a.sid) a.sid = g.sid; if (!a.round) a.round = g.round; B.groups.splice(i, 1); }
    if (b.dataset.split) { const g = B.groups[+b.dataset.split]; g.splitOpen = !g.splitOpen; }
    if (b.dataset.cut) { const [i, p] = b.dataset.cut.split(":").map(Number), g = B.groups[i], at = g.pages.indexOf(p); const ng = newGroup(g.pages.slice(at), { round: g.round, grade: g.grade }); g.pages = g.pages.slice(0, at); g.splitOpen = false; B.groups.splice(i + 1, 0, ng); }
    if (b.dataset.skip) { const g = B.groups[+b.dataset.skip]; g.skip = !g.skip; }
    if (b.id === "bstart") return startJob(ctx, b);
    paintGroups(ctx);
  };
}

/* ---------------- 3. 스캔 저장 → 차례로 분석 ---------------- */
async function startJob(ctx, btn) {
  const { S, toast, newToken } = ctx;
  const todo = B.groups.filter(g => runnable(ctx, g));
  if (!todo.length) return;
  ctx.busy(btn, true, "스캔 저장 중");
  const job = { id: newToken(12), at: Date.now(), by: S.user.email, byName: S.user.name || "", fileName: B.fileName, status: "running",
    items: todo.map(g => ({ sid: g.sid, round: g.round, grade: (S.students.find(s => s.id === g.sid) || {}).grade || g.grade, pages: Math.min(MAX_PAGES, g.pages.length), status: "upload" })) };
  const cache = {};
  try {
    await S.store.saveJob(job.id, job);
    for (let i = 0; i < todo.length; i++) {
      const g = todo[i], it = job.items[i];
      const urls = await Promise.all(g.pages.slice(0, MAX_PAGES).map(p => blobToDataURL(B.pages[p])));
      await S.store.saveScans(it.sid, it.round, urls);
      cache[`${it.sid}_${it.round}`] = urls; it.status = "queued";
      btn.innerHTML = `<span class="spinner"></span> 스캔 저장 중 ${i + 1} / ${todo.length}`;
    }
    await S.store.saveJob(job.id, { items: job.items });
  } catch (x) { toast("스캔을 저장하지 못했습니다: " + x.message, 6000); ctx.busy(btn, false); return; }
  B.groups = []; ctx.$("#s2").hidden = true;
  runJob(ctx, job, cache);
}

async function runJob(ctx, job, cache = {}) {
  const { S, toast, recs, today } = ctx;
  if (B.running && B.running.id !== job.id) { toast("다른 작업이 진행 중이에요. 끝난 뒤에 이어서 진행해 주세요.", 4000); return; }
  B.running = job;
  paintRun(ctx, job);
  const queue = job.items.filter(it => it.status !== "done");
  queue.forEach(it => it.status = "queued");
  const save = () => S.store.saveJob(job.id, { items: job.items }).catch(() => {});
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      it.status = "running"; paintRun(ctx, job);
      try {
        const images = cache[`${it.sid}_${it.round}`] || await S.store.getScans(it.sid, it.round);
        if (!images.length) throw new Error("저장된 스캔이 없어요");
        const cur = recs(it.sid)[it.round];
        const entered = cur && typeof cur.score === "number" && !cur.aiScore ? cur.score : null;
        const res = await requestAnalysis({ store: S.store, grade: it.grade, round: it.round, images, entered });
        await S.store.saveAnalysis(it.sid, it.round, { ...res, entered, confirmed: false, pending: true, by: S.user.email, at: Date.now(), source: "bulk", jobId: job.id });
        const rec = entered != null
          ? { ...cur, pending: true }
          : { date: cur?.date || today(), status: "응시", score: res.total, aiScore: true, pending: true, guess: false, analyzed: false };
        await S.store.saveRound(it.sid, it.round, rec, S.user.email);
        S.records[it.sid] = { ...recs(it.sid), [it.round]: { ...rec, by: S.user.email, at: Date.now() } };
        it.status = "done"; it.total = res.total; it.diff = entered != null ? res.total - entered : null; delete it.error;
      } catch (x) { it.status = "error"; it.error = x.message; }
      await save(); paintRun(ctx, job);
    }
  };
  await Promise.all(Array.from({ length: AN_PARALLEL }, worker));
  const errs = job.items.filter(i => i.status === "error").length;
  job.status = errs ? "partial" : "done";
  await S.store.saveJob(job.id, { status: job.status });
  B.running = null; paintRun(ctx, job, true); paintPending(ctx);
  toast(errs ? `분석을 마쳤어요. ${errs}건은 실패해서 '이어서 진행'으로 다시 시도할 수 있어요.` : "일괄 분석을 마쳤어요. 확인 대기 목록에서 확인해 주세요.", 5000);
}

function paintRun(ctx, job, finished = false) {
  const { $, S } = ctx;
  const el = $("#s3"); if (!el) return; el.hidden = false;
  const n = job.items.length, d = job.items.filter(i => i.status === "done").length;
  const nm = id => (S.students.find(s => s.id === id) || {}).name || "?";
  el.innerHTML = `<h2><span class="n">3</span>분석 ${finished ? "결과" : "진행"}</h2>
    <div class="bk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${d}"><span style="width:${n ? d / n * 100 : 0}%"></span></div>
    <p class="small muted num" style="margin:0">${d} / ${n}건 완료${finished ? "" : ` · 남은 시간 약 ${Math.max(1, Math.ceil((n - d) * 35 / AN_PARALLEL / 60))}분 · 화면을 닫아도 다음에 '이어서 진행'할 수 있어요`}</p>
    <div class="bk-prog num">${job.items.map(it => `<a href="#/a/${it.sid}/${it.round}" class="${it.status}"${it.status === "error" && it.error ? ` title="${esc(it.error)}"` : ""}><span>${esc(nm(it.sid))} ${it.round}회</span><span>${it.status === "done" ? (it.diff == null ? `AI ${fmt(it.total)}점` : Math.abs(it.diff) < 0.01 ? "일치" : `${it.diff > 0 ? "+" : ""}${fmt(it.diff)}점 차이`) : it.status === "running" ? '<span class="spinner"></span>' : it.status === "error" ? "실패" : "대기"}</span></a>`).join("")}</div>
    ${(() => { const e = job.items.find(i => i.status === "error" && i.error); return e ? `<p class="bk-err">실패 원인: ${esc(e.error)}</p>` : ""; })()}`;
}

/* ---------------- 확인 대기 목록 ---------------- */
function paintPending(ctx) {
  const { S, $, recs } = ctx;
  const el = $("#s4"); if (!el) return;
  const mine = S.filter.mine;
  const rows = [];
  S.students.forEach(s => { if (mine && s.teacher !== S.user.name) return; Object.entries(recs(s.id)).forEach(([r, x]) => { if (x && x.pending) rows.push({ s, r: +r, x }); }); });
  rows.sort((a, b) => a.s.grade - b.s.grade || a.s.name.localeCompare(b.s.name, "ko") || a.r - b.r);
  el.innerHTML = `<h2>확인 대기 <span class="pill gold num">${rows.length}</span></h2>
    <p class="small muted" style="margin:0">${mine ? "내 학생" : "전체 학생"} 중 분석이 끝나고 선생님 확인을 기다리는 시험지입니다. 눌러서 확인하고 저장하세요.</p>
    ${rows.length ? `<div class="bk-prog num">${rows.map(({ s, r, x }) => `<a href="#/a/${s.id}/${r}"><span>${esc(s.name)} <small class="muted">중${s.grade} ${r}회 ${esc(UNITS[s.grade][r - 1])}</small></span><span>${x.aiScore ? `AI ${fmt(x.score)}점` : `${fmt(x.score)}점`}</span></a>`).join("")}</div>` : `<p class="empty-state" style="padding:12px">확인을 기다리는 시험지가 없어요.</p>`}`;
}
