// ===================================================================================
// [히든 키] 전체 내보내기 비밀 키
// -----------------------------------------------------------------------------------
// 여기에는 키 원문이 아니라 SHA-256 해시(지문)만 저장한다.
// 코드를 열어봐도 키 자체는 알 수 없다.
//
// ★ 키 바꾸는 법 (꼭 기본 키에서 바꿔서 쓰세요!):
//   1) 터미널에서:  node scripts/make-hidden-key.mjs 새키
//   2) 출력된 해시값을 아래 HIDDEN_KEY_HASH에 붙여넣기
//   3) 배포하면 끝
// ===================================================================================
export const HIDDEN_KEY_HASH = '4bc7352b40467e6333de62dafee073a7bae5dbd1bb792c949b7fe7235f3e7726';

// 입력한 키가 맞는지 확인 (브라우저 내장 암호화 사용, https에서만 동작)
export async function verifyHiddenKey(input) {
    const data = new TextEncoder().encode(String(input ?? '').trim());
    const buf = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === HIDDEN_KEY_HASH;
}
