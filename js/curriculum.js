// 학기·회차 단원표와 '지금 진행 중인 학기' 설정
// 2학기 단원은 2026년에 쓴 수행평가 구성 그대로, 1학기는 2022 개정 교육과정 순서로 만든 단원표
import { UNITS as U2, UNIT_LINES as L2 } from "./rubric.js?v=10";

export const UNITS_BY_SEM = {
  1: {
    1: ["소인수분해", "최대공약수와 최소공배수", "정수와 유리수, 수의 대소", "정수와 유리수의 덧셈·뺄셈", "정수와 유리수의 곱셈·나눗셈",
        "문자의 사용과 식의 계산", "일차방정식의 풀이", "일차방정식의 활용", "좌표평면과 그래프", "정비례와 반비례"],
    2: ["유리수와 순환소수", "지수법칙과 단항식의 계산", "다항식의 계산", "일차부등식의 풀이", "일차부등식의 활용",
        "연립일차방정식의 풀이", "연립일차방정식의 활용", "일차함수와 그 그래프", "일차함수의 그래프의 성질과 식", "일차함수와 일차방정식의 관계"],
    3: ["제곱근과 그 성질", "무리수와 실수", "근호를 포함한 식의 계산", "다항식의 곱셈", "인수분해",
        "이차방정식의 풀이", "이차방정식의 활용", "이차함수 y=ax²의 그래프", "y=a(x−p)²+q의 그래프", "y=ax²+bx+c의 그래프"]
  },
  2: U2
};
// 화면용 줄바꿈 (긴 이름만)
const brk = s => s.length <= 6 ? s : s.replace(/(와|과|의) /, "$1\n").replace(/, /, ",\n");
export const LINES_BY_SEM = {
  1: Object.fromEntries(Object.entries(UNITS_BY_SEM[1]).map(([g, a]) => [g, a.map(brk)])),
  2: L2
};

export const STAGES = [
  { key: "preview", name: "Preview", step: 1, desc: "테스트 전 미리 보기" },
  { key: "test", name: "테스트", step: 2, desc: "실전 10문항" },
  { key: "review", name: "Review", step: 3, desc: "취약 부분 맞춤 10문항" }
];
export const stageName = k => (STAGES.find(s => s.key === k) || {}).name || k;

// 지금 진행 중인 학기. 테스트 기록(기존 점수 입력·시험지 분석·리포트)은 이 학기에 쌓인다.
// 2026년 2학기 테스트는 예전 채점기준표(rubric.js)를 그대로 쓴다.
export const TERM = { year: 2026, sem: 2 };
export function setTerm(t) { if (t && t.year && t.sem) { TERM.year = +t.year; TERM.sem = +t.sem; } }
export const termKey = (t = TERM) => `${t.year}-${t.sem}`;
export const termLabel = (t = TERM) => `${t.year}년 ${t.sem}학기`;
export const isLegacyTerm = (t = TERM) => t.year === 2026 && t.sem === 2;

export const unitsOf = (g, sem = TERM.sem) => (UNITS_BY_SEM[sem] || {})[g] || [];
export const unitOf = (g, r, sem = TERM.sem) => unitsOf(g, sem)[r - 1] || "";
export const unitLinesOf = (g, sem = TERM.sem) => (LINES_BY_SEM[sem] || {})[g] || unitsOf(g, sem);

// 세트(문항 묶음) 문서 키: 학기·학년·회차 (해마다 다시 쓸 수 있는 콘텐츠)
export const setKey = (sem, g, r) => `${sem}-${g}-${r}`;
// 학생 결과 문서 키
export const resultKey = (sid, t, r, stage) => `${sid}_${t.year}-${t.sem}-${r}-${stage}`;
