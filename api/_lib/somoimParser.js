// ===================================================================================
// 소모임(somoim.co.kr) 정모 참석자 파서
// -----------------------------------------------------------------------------------
// 소모임 모임 페이지에 `RSC: 1` 헤더를 붙여 GET 요청하면, 화면에는 인원수만 보이는
// 정모 참석자의 실명·별칭·고유ID(mid)가 로그인 없이 내려온다. (공식 API가 아니라
// 웹 렌더링용 내부 데이터이므로, 웹 개편 시 구조가 바뀌어 파싱이 멈출 수 있다.)
//
// ⚠️ 안전 원칙: 파싱에 실패하면 절대 "빈 명단"을 돌려주지 않는다.
//    반드시 오류코드를 던져서 호출 측이 "동기화 실패" 안내를 띄우게 한다.
// ===================================================================================

export const DEFAULT_GID = 'c3cbbda8-1005-11ee-81f5-0a9eb1ac7ddb1';

export class SomoimError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'SomoimError';
        this.code = code;
    }
}

// 응답 본문에서 startIdx 위치의 여는 괄호부터 짝이 맞는 닫는 괄호까지 잘라낸다.
// (JSON.parse 가능한 조각을 안전하게 추출 — 문자열 내부의 괄호/따옴표는 무시)
function extractBalanced(src, startIdx) {
    const open = src[startIdx];
    const close = open === '[' ? ']' : '}';
    let depth = 0, inStr = false, esc = false;
    for (let i = startIdx; i < src.length; i++) {
        const ch = src[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return src.slice(startIdx, i + 1);
        }
    }
    return null;
}

// "필드명":"문자열" / "필드명":숫자 를 개별 추출 (그룹 객체 전체 파싱보다 구조 변화에 강함)
function extractStringField(src, field) {
    const m = src.match(new RegExp(`"${field}":("(?:[^"\\\\]|\\\\.)*")`));
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
}
function extractNumberField(src, field) {
    const m = src.match(new RegExp(`"${field}":(-?\\d+)`));
    return m ? Number(m[1]) : null;
}

/**
 * RSC 응답 본문을 파싱해 멤버 전원 + 정모(최대 4개) 정보를 돌려준다.
 * @param {string} raw - RSC:1 응답 본문
 * @returns {{ members: Array, events: Array }}
 * @throws {SomoimError} PARSE_MEMBERS_NOT_FOUND | PARSE_MEMBERS_INVALID | PARSE_EVENTS_NOT_FOUND
 */
export function parseSomoimPage(raw) {
    if (typeof raw !== 'string' || raw.length < 100) {
        throw new SomoimError('PARSE_EMPTY_RESPONSE', '소모임 응답이 비어 있습니다.');
    }

    // 1) 멤버 배열
    const marker = '"members":';
    const mIdx = raw.indexOf(marker + '[');
    if (mIdx < 0) {
        throw new SomoimError('PARSE_MEMBERS_NOT_FOUND', '소모임 응답에서 멤버 목록을 찾지 못했습니다. (사이트 구조 변경 가능성)');
    }
    const arrStr = extractBalanced(raw, mIdx + marker.length);
    let rawMembers;
    try {
        rawMembers = JSON.parse(arrStr);
    } catch {
        throw new SomoimError('PARSE_MEMBERS_INVALID', '멤버 목록 파싱에 실패했습니다. (사이트 구조 변경 가능성)');
    }
    if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
        throw new SomoimError('PARSE_MEMBERS_EMPTY', '멤버 목록이 비어 있습니다. 동기화를 중단합니다.');
    }

    const members = rawMembers
        .filter(m => m && typeof m.mid === 'string' && typeof m.mn === 'string' && m.mn.trim() !== '')
        .map(m => ({
            mid: m.mid,
            name: m.mn.trim(),
            nick: typeof m.key === 'string' ? m.key : '',
            banned: m.ban === 'Y',
            // attend[0] = 1차 정모(ijo) ... attend[3] = 4차 정모(ijo4)
            attend: [m.ijo === 'Y', m.ijo2 === 'Y', m.ijo3 === 'Y', m.ijo4 === 'Y'],
        }));
    if (members.length === 0) {
        throw new SomoimError('PARSE_MEMBERS_INVALID', '멤버 데이터 형식이 예상과 다릅니다. (사이트 구조 변경 가능성)');
    }

    // 2) 정모(이벤트) 정보 — en/e_d/e_t/el/emm (1차), en2/... (2차) ...
    //    미사용 슬롯은 en="none", e_d=0 으로 내려온다.
    if (extractNumberField(raw, 'e_d') === null) {
        throw new SomoimError('PARSE_EVENTS_NOT_FOUND', '정모 정보를 찾지 못했습니다. (사이트 구조 변경 가능성)');
    }
    const events = [];
    for (let n = 1; n <= 4; n++) {
        const sfx = n === 1 ? '' : String(n);
        const name = extractStringField(raw, 'en' + sfx);
        const date = extractNumberField(raw, 'e_d' + sfx);
        if (!name || name === 'none' || !date || date <= 0) continue;
        events.push({
            slot: n, // members[].attend[slot-1] 과 대응
            name,
            date, // YYYYMMDD 숫자
            time: extractNumberField(raw, 'e_t' + sfx) || 0, // HHMM 숫자
            place: extractStringField(raw, 'el' + sfx) || '',
            capacity: extractNumberField(raw, 'emm' + sfx) || 0,
        });
    }

    return { members, events };
}

/**
 * 소모임 페이지를 가져와 파싱까지 수행한다. (서버 측 전용 — 브라우저에서는 CORS로 불가)
 * @throws {SomoimError} FETCH_FAILED | HTTP_<status> | 파싱 오류 코드
 */
export async function fetchAndParseSomoim(gid = DEFAULT_GID) {
    // gid 형식 검증 (외부 입력으로 임의 URL 조회(SSRF)되는 것 방지)
    if (!/^[0-9a-f-]{30,60}$/i.test(gid)) {
        throw new SomoimError('INVALID_GID', '모임 ID 형식이 올바르지 않습니다.');
    }
    let res;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        res = await fetch(`https://www.somoim.co.kr/${gid}`, {
            headers: { 'RSC': '1' },
            signal: controller.signal,
        });
        clearTimeout(timer);
    } catch (e) {
        throw new SomoimError('FETCH_FAILED', `소모임 서버에 접속하지 못했습니다. (${e.name === 'AbortError' ? '시간 초과' : e.message})`);
    }
    if (!res.ok) {
        throw new SomoimError(`HTTP_${res.status}`, `소모임 서버가 오류를 반환했습니다. (HTTP ${res.status})`);
    }
    const raw = await res.text();
    return parseSomoimPage(raw);
}
