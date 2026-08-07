// [히든 키] 새 키의 해시값을 만드는 도구
// 사용법:  node scripts/make-hidden-key.mjs 원하는키
// 출력된 해시를 src/lib/secret.js 의 HIDDEN_KEY_HASH 에 붙여넣으면 된다.
import { createHash } from 'node:crypto';

const key = process.argv[2];
if (!key) {
    console.log('사용법: node scripts/make-hidden-key.mjs 원하는키');
    console.log('예시:   node scripts/make-hidden-key.mjs 1592');
    process.exit(1);
}
console.log(createHash('sha256').update(String(key).trim()).digest('hex'));
