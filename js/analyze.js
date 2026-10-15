// 시험지 스캔 처리 + 분석 서버 호출
import { RUBRIC, UNITS } from "./rubric.js";

export const ERROR_TYPES = ["개념 이해", "조건 해석", "계산 실수", "풀이 과정 서술", "미응답"];

// 채점기준 문장에서 "① … 2점" 단계 나누기
export function parseSteps(criteria) {
  const parts = String(criteria).split(/(?=[①②③④⑤⑥⑦⑧⑨])/).map(s => s.trim()).filter(Boolean);
  const steps = [];
  for (const p of parts) {
    const body = p.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, "");
    const m = body.match(/(\d+(?:\.\d+)?)\s*점/);
    if (!m || /각\s*$/.test(body.slice(0, m.index))) continue;
    let desc = body.slice(0, m.index).replace(/\s+/g, " ").trim().replace(/[,.]$/, "").replace(/면$/, "기");
    steps.push({ desc, max: parseFloat(m[1]) });
  }
  const sum = steps.reduce((a, s) => a + s.max, 0);
  if (!steps.length || Math.abs(sum - 5) > 0.01) return [{ desc: String(criteria).replace(/\s+/g, " ").slice(0, 120), max: 5 }];
  return steps;
}

export function rubricFor(grade, round) {
  const items = (RUBRIC[grade] || {})[round] || [];
  return items.map(it => ({ no: it.no, answer: it.answer, criteria: it.criteria, steps: parseSteps(it.criteria) }));
}

/* ---------- 이미지 준비: 사진·PDF → JPEG(긴 변 1600px) ---------- */
function loadImage(src) {
  return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
}
function toJpeg(source, w, h, max = 1600, q = 0.72) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
let pdfjsReady = null;
function pdfjs() {
  if (!pdfjsReady) pdfjsReady = new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; ok(window.pdfjsLib); };
    s.onerror = no; document.head.appendChild(s);
  });
  return pdfjsReady;
}
export async function filesToJpegs(files) {
  const out = [];
  for (const f of files) {
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
      for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
        const page = await doc.getPage(i);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 1600 / Math.max(vp0.width, vp0.height) });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        out.push(c.toDataURL("image/jpeg", 0.72));
      }
    } else if (/^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name)) {
      const url = URL.createObjectURL(f);
      try { const im = await loadImage(url); out.push(toJpeg(im, im.naturalWidth, im.naturalHeight)); }
      finally { URL.revokeObjectURL(url); }
    }
  }
  return out.slice(0, 6);
}

/* ---------- 분석 서버 호출 ---------- */
export async function requestAnalysis({ store, grade, round, images, entered }) {
  const rubric = rubricFor(grade, round);
  const unit = UNITS[grade][round - 1];
  const cfg = window.APP_CONFIG;
  if (!cfg.workerUrl) {
    await new Promise(r => setTimeout(r, 1200));
    return demoAnalysis(grade, round, entered ?? 35, 7);
  }
  const res = await fetch(cfg.workerUrl.replace(/\/$/, "") + "/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + await store.idToken() },
    body: JSON.stringify({ grade, round, unit, entered, images: images.map(d => d.split(",")[1]), rubric: rubric.map(({ no, answer, criteria, steps }) => ({ no, answer, criteria, steps })) })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `분석 서버 오류 (${res.status})`);
  return normalize(j, rubric);
}

export async function requestComment({ store, summary }) {
  const cfg = window.APP_CONFIG;
  if (!cfg.workerUrl) { await new Promise(r => setTimeout(r, 700)); return demoComment(summary); }
  const res = await fetch(cfg.workerUrl.replace(/\/$/, "") + "/comment", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + await store.idToken() },
    body: JSON.stringify({ summary })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `분석 서버 오류 (${res.status})`);
  return j;
}

// 서버 결과를 화면용으로 정리 (점수는 0.5점 단위, 단계 합 = 문항 점수)
export function normalize(j, rubric) {
  const half = x => Math.max(0, Math.round((+x || 0) * 2) / 2);
  const items = rubric.map(rb => {
    const it = (j.items || []).find(x => +x.no === rb.no) || {};
    let steps = Array.isArray(it.steps) && it.steps.length ? it.steps.map(s => ({ desc: String(s.desc || ""), max: half(s.max), got: Math.min(half(s.got), half(s.max)) })) : rb.steps.map(s => ({ ...s, got: 0 }));
    let score = half(it.score ?? steps.reduce((a, s) => a + s.got, 0));
    score = Math.min(5, score);
    // 단계 점수 합이 문항 점수와 다르면 문항 점수를 기준으로 단계에 앞에서부터 나눠 담는다
    const sum = steps.reduce((a, s) => a + s.got, 0);
    if (Math.abs(sum - score) > 0.01) {
      if (Math.abs(steps.reduce((a, s) => a + s.max, 0) - 5) > 0.01) steps = rb.steps.map(s => ({ ...s, got: 0 }));
      let left = score; steps.forEach(s => { s.got = Math.min(s.max, left); left = Math.max(0, left - s.got); });
    }
    return { no: rb.no, score, steps, error_type: ERROR_TYPES.includes(it.error_type) ? it.error_type : (score < 5 ? "" : ""), memo: String(it.memo || ""), unclear: it.legibility === "unclear" };
  });
  return { items, total: items.reduce((a, x) => a + x.score, 0), overall: String(j.overall || ""), model: j.model || "" };
}

/* ---------- 데모 ---------- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function demoAnalysis(grade, round, target, seed = 1) {
  const rubric = rubricFor(grade, round);
  const r = rng(seed * 97 + round * 13 + grade);
  const items = rubric.map(rb => ({ no: rb.no, steps: rb.steps.map(s => ({ ...s, got: s.max })), error_type: "", memo: "" }));
  let lose = Math.max(0, Math.round((50 - target) * 2) / 2);
  const order = [9, 8, 4, 7, 2, 6, 5, 3, 1, 0];
  const memos = { "풀이 과정 서술": "근거 문장 없이 결론만 씀", "계산 실수": "식은 맞았으나 계산 과정에서 실수", "조건 해석": "문제의 조건 하나를 놓침", "개념 이해": "필요한 성질을 잘못 적용", "미응답": "답안 없음" };
  for (let pass = 0; pass < 4 && lose > 0; pass++) for (const idx of order) {
    if (lose <= 0) break;
    const it = items[idx];
    const take = Math.min(lose, r() < 0.3 ? 5 : Math.ceil(r() * 3) + 0.5 * (r() < 0.5));
    let left = take;
    for (let k = it.steps.length - 1; k >= 0 && left > 0; k--) { const d = Math.min(left, it.steps[k].got); it.steps[k].got -= d; left -= d; }
    lose -= take - left;
    const got = it.steps.reduce((a, s) => a + s.got, 0);
    it.error_type = got === 0 ? "미응답" : ERROR_TYPES[Math.floor(r() * 4)];
    it.memo = memos[it.error_type];
  }
  items.forEach(it => it.score = it.steps.reduce((a, s) => a + s.got, 0));
  return { items, total: items.reduce((a, x) => a + x.score, 0), overall: "데모 분석 결과입니다. 실제 분석 서버를 연결하면 시험지를 읽어 채점기준에 맞춰 판독합니다.", model: "demo" };
}
function demoComment(s) {
  return {
    strengths: `${s.bestUnit} 단원에서 ${s.best}점으로 가장 좋은 결과를 냈습니다. 기본 개념 문항은 안정적으로 해결하고 있습니다.`,
    improve: s.topError ? `감점은 '${s.topError}'에서 가장 많았습니다. 답을 구한 근거를 문장으로 끝까지 쓰는 연습이 필요합니다.` : `점수 변동이 있는 단원을 중심으로 서술 과정을 보완하겠습니다.`,
    plan: `다음 회차에서는 풀이 근거 쓰기를 집중 연습하고, 토요일 피드백에서 틀린 유형을 다시 풀어 보겠습니다.`
  };
}
