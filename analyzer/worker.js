// 수행평가 시험지 분석 서버 (Cloudflare Worker)
// 필요한 설정 (Cloudflare 대시보드 > Worker > 설정 > 변수 및 비밀):
//   ANTHROPIC_API_KEY  (비밀)  Anthropic 콘솔에서 발급한 키
//   FIREBASE_PROJECT_ID        Firebase 프로젝트 ID
//   ALLOWED_ORIGINS            앱 주소, 예: https://hongs-sudo.github.io
//   OWNER_EMAILS               원장 이메일 (쉼표로 여러 개)
//   MODEL (선택)               기본 claude-sonnet-5-5
//   ID_MODEL (선택)            일괄 올리기 쪽 읽기용 모델, 기본은 MODEL과 같음

const ERROR_TYPES = ["개념 이해", "조건 해석", "계산 실수", "풀이 과정 서술", "미응답"];

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = { "Access-Control-Allow-Origin": okOrigin ? origin : allowed[0] || "", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return json({ ok: true, service: "suhaeng-analyzer" });
    // 분석 서버가 실제로 어느 지역에서 돌고 있는지 확인 (접속 지점 / 실행 지점)
    if (req.method === "GET" && url.pathname === "/where") {
      let run = "?";
      try { const t = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace")).text(); run = (t.match(/colo=(\w+)/) || [])[1] || "?"; } catch (e) { /* 무시 */ }
      const blocked = ["HKG", "MFM"].includes(run);
      return json({ 접속지점: req.cf?.colo || "?", 실행지점: run, 판정: blocked ? "AI 요청이 막히는 지역에서 실행 중 — 위치 설정 필요" : "정상 지역에서 실행 중" });
    }
    if (req.method !== "POST") return json({ error: "지원하지 않는 요청입니다." }, 405);
    if (!okOrigin) return json({ error: "허용되지 않은 주소에서 온 요청입니다. ALLOWED_ORIGINS 설정을 확인해 주세요." }, 403);

    // 1) 로그인한 선생님인지 확인
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
    let user;
    try { user = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID); }
    catch (e) { return json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." }, 401); }
    if (!(await isTeacher(user, token, env))) return json({ error: "등록된 선생님만 분석을 쓸 수 있습니다." }, 403);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "분석 서버에 API 키가 설정되지 않았습니다." }, 500);

    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }
    try {
      if (url.pathname === "/analyze") return json(await analyze(body, env));
      if (url.pathname === "/comment") return json(await comment(body, env));
      if (url.pathname === "/identify") return json(await identify(body, env));
      if (url.pathname === "/extract") return json(await extract(body, env));
      if (url.pathname === "/variant") return json(await variant(body, env));
      return json({ error: "알 수 없는 주소입니다." }, 404);
    } catch (e) {
      return json({ error: e.message || "분석 중 오류가 났습니다." }, 502);
    }
  }
};

/* ---------------- Firebase ID 토큰 확인 ---------------- */
let jwksCache = { at: 0, keys: [] };
async function getKeys() {
  if (Date.now() - jwksCache.at < 3600e3 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  const j = await r.json(); jwksCache = { at: Date.now(), keys: j.keys || [] }; return jwksCache.keys;
}
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
async function verifyFirebaseToken(token, projectId) {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  const jwk = (await getKeys()).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== "RS256") throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  const now = Date.now() / 1000;
  if (!ok || payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` || payload.exp < now || !payload.email || payload.email_verified !== true) throw new Error("invalid");
  return { email: String(payload.email).toLowerCase(), uid: payload.sub };
}
async function isTeacher(user, token, env) {
  const owners = (env.OWNER_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (owners.includes(user.email)) return true;
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/teachers/${encodeURIComponent(user.email)}`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return false;
  const d = await r.json();
  return d.fields?.active?.booleanValue === true;
}

/* ---------------- Claude 호출 ---------------- */
async function claude(env, payload, toolName, model) {
  // 최신 모델은 도구 강제 호출(tool_choice: tool)을 지원하지 않으므로 auto + 지시문으로 호출을 유도하고,
  // 도구를 쓰지 않고 글로 답하면 그 안의 JSON을 꺼내 쓴다. 그래도 없으면 한 번 다시 요청한다.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: model || env.MODEL || "claude-sonnet-5-5", tool_choice: { type: "auto" }, ...payload })
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = j.error?.message || String(r.status);
      if (r.status === 403 && /not allowed/i.test(msg))
        throw new Error("AI 회사가 분석 서버의 실행 지역에서 온 요청을 막았어요. 분석 서버 위치 설정(placement)을 확인해 주세요. (" + msg + ")");
      throw new Error("AI 응답 오류: " + msg);
    }
    const tool = (j.content || []).find(c => c.type === "tool_use" && c.name === toolName);
    if (tool) return { ...tool.input, model: j.model };
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return { ...JSON.parse(m[0]), model: j.model }; } catch (e) { /* 다시 시도 */ } }
  }
  throw new Error("AI가 결과를 정해진 형식으로 돌려주지 않았습니다. 잠시 후 다시 시도해 주세요.");
}

const GRADE_TOOL = {
  name: "record_grading",
  description: "학생 답안지를 채점기준에 따라 판독한 문항별 결과를 기록한다.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array", minItems: 10, maxItems: 10,
        items: {
          type: "object",
          properties: {
            no: { type: "integer", description: "문항 번호 1~10" },
            score: { type: "number", description: "문항 점수 0~5, 0.5 단위. steps의 got 합과 같아야 함" },
            steps: {
              type: "array", description: "채점기준의 단계(①②③…)별 배점과 받은 점수. 기준에 단계가 없으면 스스로 2~3단계로 나눔(합 5점)",
              items: { type: "object", properties: { desc: { type: "string" }, max: { type: "number" }, got: { type: "number" } }, required: ["desc", "max", "got"] }
            },
            error_type: { type: "string", enum: ["", ...ERROR_TYPES], description: "감점이 있을 때 가장 큰 원인. 만점이면 빈 문자열" },
            memo: { type: "string", description: "감점 이유를 선생님이 보기 쉽게 40자 이내 한국어로. 만점이면 빈 문자열" },
            legibility: { type: "string", enum: ["clear", "unclear"], description: "답안 판독이 어려웠으면 unclear" }
          },
          required: ["no", "score", "steps", "error_type", "memo", "legibility"]
        }
      },
      overall: { type: "string", description: "이 시험지 전체에서 보이는 강점과 약점 한두 문장 (선생님용)" }
    },
    required: ["items", "overall"]
  }
};

async function analyze(b, env) {
  const imgs = Array.isArray(b.images) ? b.images.slice(0, 6) : [];
  if (!imgs.length) throw new Error("시험지 이미지가 없습니다.");
  const rubric = (b.rubric || []).map(it => `[${String(it.no).padStart(2, "0")}번] 정답·핵심 결론: ${it.answer}\n채점 기준(5점 만점): ${it.criteria}`).join("\n\n");
  const text = `중학교 ${b.grade}학년 ${b.sem || 2}학기 수학 수행평가·서술형 ${b.round}회 '${b.unit}' 시험지입니다. 10문항, 문항당 5점, 총 50점.
첨부한 이미지는 학생이 푼 답안지(${imgs.length}장)이며 선생님의 채점 표시(빨간 펜 ○, ×, 점수)가 있을 수 있습니다.
${b.entered != null ? `선생님이 입력한 이 시험 총점은 ${b.entered}점입니다.` : ""}

[채점 원칙]
1) 정답·해설의 풀이 흐름을 기준으로 핵심 개념·식 세우기·계산·결론을 분리해 배점한다.
2) 수학적으로 같은 의미의 다른 올바른 풀이도 같은 점수를 준다.
3) 서술을 요구한 문항에서 최종 답만 맞고 근거가 없으면 과정·근거 점수는 주지 않는다.
4) 올바른 식을 세운 뒤 단순 계산 실수만 있으면 계산·결론 점수만 감점한다.
5) 단위·각도 기호 등 답의 의미에 필요한 표기가 빠지면 해당 단계에서 0.5점 감점할 수 있다.

[판독 방법]
- 문항마다 선생님의 채점 표시와 점수가 보이면 그 점수를 문항 점수로 쓰고, 채점기준의 어느 단계에서 감점됐는지 답안을 보고 설명한다.
- 채점 표시가 없으면 채점기준에 따라 직접 채점한다.
- steps는 아래 채점기준의 단계와 배점을 그대로 쓰고(desc는 짧게), got은 0.5점 단위로 적는다. 문항 score = got의 합.
- 답안이 비어 있으면 0점, error_type "미응답".
- error_type은 개념 이해(성질·공식을 잘못 앎) / 조건 해석(문제 조건을 놓치거나 잘못 읽음) / 계산 실수 / 풀이 과정 서술(근거·과정 문장 부족) / 미응답 중 하나.
- 이미지에서 알아볼 수 없는 부분은 추측하지 말고 legibility를 unclear로 표시한다.

[채점기준표 ${b.round}회]
${rubric}

반드시 record_grading 도구를 한 번 호출해 10문항 결과를 모두 기록하세요. 도구 밖에 다른 설명은 쓰지 마세요.`;
  const content = [...imgs.map(d => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: d } })), { type: "text", text }];
  return claude(env, { max_tokens: 8000, tools: [GRADE_TOOL], messages: [{ role: "user", content }] }, "record_grading");
}

const COMMENT_TOOL = {
  name: "write_comment",
  description: "부모님께 보내는 수행평가 리포트의 선생님 종합 의견",
  input_schema: {
    type: "object",
    properties: {
      strengths: { type: "string", description: "잘하고 있는 점, 100자 이내" },
      improve: { type: "string", description: "보완할 점, 100자 이내" },
      plan: { type: "string", description: "다음 학습 계획, 100자 이내" }
    },
    required: ["strengths", "improve", "plan"]
  }
};
async function comment(b, env) {
  const s = b.summary || {};
  const text = `수학학원 선생님이 학부모님께 보내는 수행평가·서술형 프로그램 리포트의 '선생님 종합 의견' 초안을 써 주세요.
- 존댓말, 따뜻하지만 과장 없이, 데이터에 있는 사실만. 각 칸 100자 이내, 2문장 정도.
- 학생 이름 대신 '○○이는' 같은 호칭은 쓰지 말고 주어를 생략해도 됩니다.
- 점수(50점 만점), 단원명, 감점 원인(오류 유형)을 근거로 구체적으로.
- 다음 학습 계획에는 토요일 개별 피드백 시간 활용을 자연스럽게 넣을 수 있습니다.

[데이터]
${JSON.stringify(s)}

반드시 write_comment 도구를 한 번 호출해 세 칸을 기록하세요.`;
  return claude(env, { max_tokens: 1500, tools: [COMMENT_TOOL], messages: [{ role: "user", content: text }] }, "write_comment");
}

/* ---------------- 일괄 올리기: 쪽마다 학생·회차 읽기 ---------------- */
const ID_TOOL = {
  name: "record_pages",
  description: "스캔한 시험지 쪽마다 읽은 학생과 회차 정보를 기록한다.",
  input_schema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "이미지 번호 (P1, P2 …의 숫자)" },
            blank: { type: "boolean", description: "빈 쪽이거나 시험지가 아닌 쪽이면 true" },
            name_read: { type: "string", description: "쪽에 손으로 쓴 학생 이름을 보이는 그대로. 없으면 빈 문자열" },
            student_id: { type: "string", description: "명단에서 확실히 일치하는 학생의 id. 확실하지 않으면 빈 문자열" },
            candidates: { type: "array", items: { type: "string" }, description: "확실하지 않을 때 가능성 있는 학생 id 최대 3개" },
            grade: { type: "integer", description: "머리글의 학년 (예: [중1-2 …] → 1). 모르면 0" },
            round: { type: "integer", description: "머리글의 회차 (예: 4회 → 4). 모르면 0" },
            first_item: { type: "integer", description: "이 쪽에서 가장 작은 문항 번호. 모르면 0" }
          },
          required: ["index", "blank", "name_read", "student_id", "candidates", "grade", "round", "first_item"]
        }
      }
    },
    required: ["pages"]
  }
};
async function identify(b, env) {
  const imgs = Array.isArray(b.images) ? b.images.slice(0, 10) : [];
  if (!imgs.length) throw new Error("쪽 이미지가 없습니다.");
  const roster = (b.roster || []).slice(0, 400).map(s => `${s.id}: ${s.name} (${s.school || ""}, 중${s.grade})`).join("\n");
  const content = [];
  imgs.forEach((d, i) => { content.push({ type: "text", text: `P${i + 1}` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: d } }); });
  content.push({ type: "text", text: `위 이미지 P1~P${imgs.length}는 학원 수학 수행평가·서술형 시험지를 여러 학생분 한꺼번에 스캔한 것의 일부입니다 (순서대로).
쪽마다 다음을 읽으세요.
- 학생이 손으로 쓴 이름: 보통 오른쪽 위 '이름' 칸에 있지만, 다른 위치에 있을 수도 있습니다.
- 인쇄된 머리글: 예) "[중1-2 수행평가/서술형 대비] 4회 작도와 합동(2)" → grade 1, round 4.
- 그 쪽에 보이는 가장 작은 문항 번호 (예: 01, 1번 → 1).
읽은 이름을 아래 학생 명단과 맞춰 student_id를 정하세요. 머리글의 학년과 같은 학년 학생을 우선으로 봅니다. 글씨가 흐리거나 비슷한 이름이 여럿이면 student_id는 비우고 candidates에 후보를 넣으세요. 추측으로 확정하지 마세요.
이름이 없는 쪽은 name_read와 student_id를 비워 두세요(앞 쪽에 이어지는 쪽일 수 있음).
${b.grade ? `참고: 이번 파일은 중${b.grade} 시험지입니다.` : ""}${b.round ? ` 참고: 이번 파일은 ${b.round}회 시험지입니다.` : ""}

[학생 명단 id: 이름 (학교, 학년)]
${roster}

반드시 record_pages 도구를 한 번 호출해 모든 쪽(P1~P${imgs.length})을 기록하세요.` });
  return claude(env, { max_tokens: 4000, tools: [ID_TOOL], messages: [{ role: "user", content }] }, "record_pages", env.ID_MODEL || env.MODEL);
}

/* ---------------- 문제은행: PDF·사진 쪽에서 문항 뽑기 ---------------- */
const MATH_RULE = `수식 표기: 모든 수식·변수·숫자식은 \\( \\) 로 감싼 LaTeX로 쓴다. 예) \\(2x+3=7\\), \\(\\angle x=65^\\circ\\), \\(\\overline{AB}\\), \\(\\frac{1}{2}\\). 문장은 한국어 그대로.`;
const EXTRACT_TOOL = {
  name: "record_items",
  description: "쪽 이미지에서 찾은 수학 문항을 하나씩 기록한다.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            page: { type: "integer", description: "문항이 있는 이미지 번호 (P1 → 1)" },
            body: { type: "string", description: "문항 본문 전체. 보기·조건·소문항 (1)(2) 포함. 그림 안의 글자는 쓰지 않음" },
            answer: { type: "string", description: "정답. 쪽에 정답·해설이 없으면 직접 풀어서 쓰고, 확실하지 않으면 빈 문자열" },
            criteria: { type: "string", description: "단계별 채점기준. '① … 2점\\n② … 2점\\n③ … 1점' 처럼 합 5점" },
            concept: { type: "string", description: "핵심 개념 (짧게, 예: 평행선의 성질)" },
            diff: { type: "integer", enum: [1, 2, 3], description: "난이도 1 기본 · 2 보통 · 3 어려움" },
            round: { type: "integer", description: "아래 단원표에서 이 문항이 속하는 회차 번호. 모르면 0" },
            figure: { type: ["array", "null"], items: { type: "number" }, description: "문항에 그림·그래프·표가 있으면 그 영역 [x0,y0,x1,y1] (쪽 전체를 0~1000으로 본 좌표). 없으면 null" }
          },
          required: ["page", "body", "answer", "criteria", "concept", "diff", "round", "figure"]
        }
      }
    },
    required: ["items"]
  }
};
async function extract(b, env) {
  const imgs = Array.isArray(b.images) ? b.images.slice(0, 4) : [];
  if (!imgs.length) throw new Error("쪽 이미지가 없습니다.");
  const units = Array.isArray(b.units) ? b.units : [];
  const content = [];
  imgs.forEach((d, i) => { content.push({ type: "text", text: `P${i + 1}` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: d } }); });
  content.push({ type: "text", text: `위 이미지는 중학교 ${b.grade}학년 ${b.sem}학기 수학 자료(교과서 · 문제집 · 수행평가 대비 학습지)의 쪽입니다.${b.hint ? ` 자료 이름: ${b.hint}.` : ""}
문제은행에 넣을 수 있도록 쪽 안의 '문항'을 하나씩 나눠 기록하세요.
- 개념 설명, 목차, 정답표만 있는 부분은 문항이 아닙니다. 예제·유제·연습문제·서술형 문항만 기록합니다.
- 소문항 (1)(2)가 있는 문항은 하나의 문항으로 기록합니다.
- ${MATH_RULE}
- 서술형 수행평가용이므로 채점기준은 풀이 단계별로 합 5점이 되게 만듭니다. 쪽에 채점기준이 있으면 그대로 따릅니다.
- 정답은 반드시 직접 풀어 확인합니다.
${units.length ? `[단원표 (회차: 단원)]\n${units.map((u, i) => `${i + 1}: ${u}`).join("\n")}` : ""}

반드시 record_items 도구를 한 번 호출해 모든 문항을 기록하세요. 문항이 없으면 빈 배열로 호출하세요.` });
  return claude(env, { max_tokens: 12000, tools: [EXTRACT_TOOL], messages: [{ role: "user", content }] }, "record_items");
}

/* ---------------- 변형 문항 만들기 + 따로 다시 풀어 정답 검산 ---------------- */
const VARIANT_TOOL = {
  name: "record_variant",
  description: "원래 문항을 바꾼 새 문항과 정답 · 채점기준을 기록한다.",
  input_schema: {
    type: "object",
    properties: {
      body: { type: "string" }, answer: { type: "string" },
      criteria: { type: "string", description: "단계별 채점기준, 합 5점 ('① … 2점' 형식, 줄바꿈으로 구분)" },
      concept: { type: "string" }
    },
    required: ["body", "answer", "criteria", "concept"]
  }
};
const SOLVE_TOOL = {
  name: "record_answer",
  description: "문항을 풀어 최종 답을 기록한다.",
  input_schema: { type: "object", properties: { answer: { type: "string" }, solvable: { type: "boolean", description: "주어진 정보만으로 답이 하나로 정해지면 true" } }, required: ["answer", "solvable"] }
};
const JUDGE_TOOL = {
  name: "record_judgement",
  description: "두 답이 수학적으로 같은지 판정한다.",
  input_schema: { type: "object", properties: { same: { type: "boolean" }, note: { type: "string" } }, required: ["same", "note"] }
};
async function variant(b, env) {
  const it = b.item || {};
  if (!it.body) throw new Error("원래 문항이 없습니다.");
  const how = b.type === "content"
    ? "내용 변형: 같은 개념 · 같은 난이도를 묻되 상황 · 묻는 방식 · 조건을 바꾼 새 문항을 만든다. 숫자만 바꾸는 것은 안 된다."
    : "숫자 변형: 문항의 구조와 묻는 것은 그대로 두고 수치만 바꾼다. 답이 깔끔한 수(정수나 간단한 분수)가 되게 고른다.";
  const text = `중학교 ${b.grade}학년 수학 서술형 수행평가 '${b.unit || ""}' 단원 문항을 바탕으로 새 문항을 하나 만드세요.
${how}
${it.hasFigure ? "원래 문항에는 그림이 있습니다. 새 문항은 그림 없이도 풀 수 있게 조건을 글로 모두 쓰고, 꼭 그림이 필요하면 그림에 들어갈 내용을 [그림: …]으로 적으세요." : ""}
- ${MATH_RULE}
- 채점기준은 풀이 단계별로 합 5점.
- 정답은 직접 풀어 확인한 값이어야 합니다.

[원래 문항]
${it.body}
[원래 정답] ${it.answer || "(없음)"}
[원래 채점기준]
${it.criteria || "(없음)"}

반드시 record_variant 도구를 한 번 호출하세요.`;
  const v = await claude(env, { max_tokens: 3000, tools: [VARIANT_TOOL], messages: [{ role: "user", content: text }] }, "record_variant");
  // 검산: 정답을 보여 주지 않고 새 문항만 따로 풀게 한 뒤 두 답이 같은지 비교
  let verified = false, check = "";
  try {
    const s = await claude(env, { max_tokens: 2000, tools: [SOLVE_TOOL], messages: [{ role: "user", content: `다음 중학교 수학 문항을 풀어 최종 답만 기록하세요. 풀이는 머릿속으로 하고 답만 간단히.\n\n${v.body}\n\n반드시 record_answer 도구를 한 번 호출하세요.` }] }, "record_answer");
    if (s.solvable === false) check = "다시 풀어 보니 조건이 부족해 답이 하나로 정해지지 않아요.";
    else {
      const j = await claude(env, { max_tokens: 800, tools: [JUDGE_TOOL], messages: [{ role: "user", content: `두 답이 수학적으로 같은 답인지 판정하세요. 표기 차이(단위 생략, 순서, 동치식)는 같은 것으로 봅니다.\nA: ${v.answer}\nB: ${s.answer}\n반드시 record_judgement 도구를 호출하세요.` }] }, "record_judgement");
      verified = !!j.same; check = verified ? "따로 다시 풀어 같은 답을 확인했어요." : `다시 푼 답이 달라요: ${s.answer} (${j.note || ""})`;
    }
  } catch (e) { check = "검산하지 못했어요: " + e.message; }
  return { body: v.body, answer: v.answer, criteria: v.criteria, concept: v.concept, verified, check, model: v.model };
}
