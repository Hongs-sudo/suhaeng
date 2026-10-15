// ===== 설정 파일: 설치 안내서의 순서대로 아래 값만 채우면 됩니다 =====
window.APP_CONFIG = {
  // Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 에서 복사. 비워 두면 '데모 모드'로 열립니다.
  firebase: {
    apiKey: "AIzaSyBDAqrnCpQ7dif-mqI4UMFapYB5t75f6nU",
    authDomain: "sudo-suhaeng.firebaseapp.com",
    projectId: "sudo-suhaeng",
    appId: "1:341601067162:web:01c808e43b2d45c506bf23"
  },
  // Cloudflare 분석 서버 주소 (예: https://suhaeng-analyzer.내계정.workers.dev). 비워 두면 데모 분석.
  workerUrl: "https://suhaeng-analyzer.ilmvm66.workers.dev",
  // 원장님 계정: 항상 관리자. firestore.rules 의 이메일과 같아야 합니다.
  ownerEmails: ["ilmvm66@gmail.com"],
  programId: "suhaeng",
  programName: "수행평가·서술형 프로그램",
  contact: "010.3358.9007 (02.2651.7750)",
  year: 2026
};
