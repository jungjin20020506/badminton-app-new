import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// 앱과 완전히 동일한 엔진으로 가상의 하루를 돌리는 두 시뮬레이터를 테스트로 편입한다.
// 가중치(matching.js 의 W 객체)를 건드리면 반드시 이 테스트가 지켜본다.
const root = path.resolve(__dirname, '..');
const run = (script) => execFileSync(process.execPath, [path.join(root, 'scripts', script)], { encoding: 'utf-8', timeout: 120000 });

describe('매칭 시뮬레이터', () => {
    it('simulate-matching.mjs — 기능 검증 전부 통과', () => {
        const out = run('simulate-matching.mjs');
        expect(out).toContain('모든 검증 통과');
        expect(out).not.toMatch(/❌/);
    });

    it('stress-test-matching.mjs — 36 시나리오 / 237 검증 전부 통과', () => {
        const out = run('stress-test-matching.mjs');
        expect(out).toMatch(/모두 통과/);
        expect(out).not.toMatch(/❌/);
    });
});
