import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MATCH_MODE_NORMAL, MATCH_MODE_TEAM, TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../lib/helpers';
import { AUTO_MATCH_SENSITIVITIES, getSensitivity } from '../lib/matching';
import { computeDailySummary, drawSummaryCard } from '../lib/summaryCard';
import { VersionInfo } from './UpdateBanner';
import { ModalShell } from './modals/ModalShell';

// ===================================================================================
// [관리자 설정] 한 화면에서 전부 — 그리고 저장 방식은 하나로 (저장 버튼)
// -----------------------------------------------------------------------------------
// 예전에는 관리자 권한만 "즉시 저장"이고 나머지는 "저장 버튼"이라 헷갈렸다. 이제
//   · 코트 수 · 공지 · 자동매칭 민감도 · 관리자 목록 → 모두 [저장] 버튼으로 한 번에
//   · 바꾼 항목 수를 저장 버튼에 표시, 저장 안 하고 닫으면 확인
//   · 경기 방식 전환(청백전 ↔ 일반)만은 "즉시 적용"이라고 분명히 표시 — 선수 전원을
//     내보내는 파괴적 동작이라 별도 확인창이 있고 설정 저장과 무관하다
// ===================================================================================
const SECTION = 'bg-gray-700 p-3 rounded-lg';

// 작은 입력 부품들은 컴포넌트 밖에 둔다 — 렌더마다 새 컴포넌트 타입이 만들어지면
// 버튼이 매번 다시 마운트되어 포커스가 튀고, 누른 버튼의 DOM 참조가 바로 낡아 버린다.
const SensitivitySelect = ({ value, onChange, label }) => (
    <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={label}>
        {AUTO_MATCH_SENSITIVITIES.map((s) => (
            <button
                key={s.key} type="button" role="radio" aria-checked={value === s.key}
                onClick={() => onChange(s.key)}
                className={`min-h-[40px] rounded-md text-xs font-bold arcade-button transition-colors ${value === s.key ? 'bg-green-500 text-black' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}
            >
                {s.label}
            </button>
        ))}
    </div>
);
const Stepper = ({ value, onChange, min = 1, label }) => (
    <div className="cox-stepper" role="group" aria-label={label}>
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label} 줄이기`}>−</button>
        <span className="val" style={{ minWidth: 44, fontSize: 26 }}>{value}</span>
        <button type="button" onClick={() => onChange(value + 1)} aria-label={`${label} 늘리기`}>+</button>
    </div>
);

export function SettingsModal({
    isAdmin, scheduledCount, courtCount, seasonConfig, adminNames, activePlayers, allPlayers, currentUser, roster,
    onSave, onCancel, setModal, onSystemReset, onClearPlayerHistory, onGenerateRobots, onAdminAddPlayer,
    onSomoimSync, onOpenRoster, somoimSync, matchMode = MATCH_MODE_NORMAL, onSwitchMatchMode, teamScores,
}) {
    const isTeam = matchMode === MATCH_MODE_TEAM;

    // ── 폼 상태 (초기값 스냅샷과 비교해 '바뀐 항목'을 센다) ──
    const initial = useMemo(() => {
        const cfg = seasonConfig.autoMatchConfig || {};
        const sensitivity = cfg.sensitivity || 'normal';
        return {
            scheduled: scheduledCount,
            courts: courtCount,
            announcement: seasonConfig.announcement || '',
            autoMatchConfig: {
                ...cfg, sensitivity,
                perGenderSensitivity: cfg.perGenderSensitivity ?? false,
                maleSensitivity: cfg.maleSensitivity || sensitivity,
                femaleSensitivity: cfg.femaleSensitivity || sensitivity,
                announcementType: seasonConfig.announcementType || 'text',
                announcementPhotoUrl: seasonConfig.announcementPhotoUrl || '',
            },
            adminList: [...adminNames],
        };
    // 모달이 열린 동안 초기값은 고정한다 (다른 관리자의 변경이 내 편집을 덮지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [scheduled, setScheduled] = useState(initial.scheduled);
    const [courts, setCourts] = useState(initial.courts);
    const [announcement, setAnnouncement] = useState(initial.announcement);
    const [autoMatchConfig, setAutoMatchConfig] = useState(initial.autoMatchConfig);
    const [photoFile, setPhotoFile] = useState(null);
    const [adminList, setAdminList] = useState(initial.adminList);
    const [adminInput, setAdminInput] = useState('');
    const [robotMaleCount, setRobotMaleCount] = useState(0);
    const [robotFemaleCount, setRobotFemaleCount] = useState(0);
    const [showDailySummary, setShowDailySummary] = useState(false);
    const [showAddPlayerForm, setShowAddPlayerForm] = useState(false);
    const [newPlayerForm, setNewPlayerForm] = useState({ name: '', level: 'A조', gender: '남', isGuest: false, team: TEAM_BLUE });
    const [showAutoGuide, setShowAutoGuide] = useState(false);
    const [saving, setSaving] = useState(false);

    const rosterNames = useMemo(
        () => Object.values(roster || {}).map((r) => r.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
        [roster]
    );
    const { malePlayerCount, femalePlayerCount } = useMemo(() => {
        const list = Object.values(activePlayers).filter((p) => !p.isResting);
        return { malePlayerCount: list.filter((p) => p.gender === '남').length, femalePlayerCount: list.filter((p) => p.gender === '여').length };
    }, [activePlayers]);

    // ── 바뀐 항목 세기 ──
    const changes = useMemo(() => {
        const list = [];
        if (scheduled !== initial.scheduled) list.push('경기 예정 코트 수');
        if (courts !== initial.courts) list.push('경기 진행 코트 수');
        if (announcement !== initial.announcement) list.push('공지 내용');
        const a = autoMatchConfig, b = initial.autoMatchConfig;
        if (a.announcementType !== b.announcementType) list.push('공지 방식');
        if (photoFile) list.push('공지 사진');
        if (a.sensitivity !== b.sensitivity || a.perGenderSensitivity !== b.perGenderSensitivity || a.maleSensitivity !== b.maleSensitivity || a.femaleSensitivity !== b.femaleSensitivity) list.push('매칭 민감도');
        if (adminList.join('|') !== initial.adminList.join('|')) list.push('관리자 목록');
        return list;
    }, [scheduled, courts, announcement, autoMatchConfig, photoFile, adminList, initial]);
    const dirty = changes.length > 0;

    // ── 관리자 목록 편집 (저장 때 반영) ──
    const handleAddAdmin = () => {
        const name = (adminInput || '').trim();
        if (!name) { setModal({ type: 'alert', data: { title: '안내', body: '관리자 권한을 줄 사람의 이름을 입력해주세요.' } }); return; }
        if (adminList.includes(name)) { setModal({ type: 'alert', data: { title: '안내', body: `${name} 님은 이미 관리자입니다.` } }); return; }
        setAdminList((l) => [...l, name]);
        setAdminInput('');
    };
    const handleRemoveAdmin = (name) => {
        if (adminList.length <= 1) {
            setModal({ type: 'alert', data: { title: '해임할 수 없습니다', body: '관리자는 최소 1명이 있어야 합니다.\n먼저 다른 사람에게 관리자 권한을 준 뒤에 해임해주세요.' } });
            return;
        }
        setAdminList((l) => l.filter((n) => n !== name));
    };
    const removingSelf = !!currentUser && !currentUser.isGhostAdmin && initial.adminList.includes(currentUser.name) && !adminList.includes(currentUser.name);

    // ── 저장 / 닫기 ──
    const doSave = useCallback(async () => {
        setSaving(true);
        try {
            await onSave({ scheduled, courts, announcement, autoMatchConfig: { ...autoMatchConfig, photoFile }, adminNames: adminList });
        } finally { setSaving(false); }
    }, [onSave, scheduled, courts, announcement, autoMatchConfig, photoFile, adminList]);

    const handleSave = () => {
        if (!dirty) { onCancel(); return; }
        if (removingSelf) {
            setModal({ type: 'confirm', data: {
                title: '내 관리자 권한 해임',
                body: `${currentUser.name} 님(나 자신)을 관리자에서 빼고 저장할까요?\n저장하면 설정 창을 포함한 관리자 기능을 더 이상 쓸 수 없습니다.`,
                confirmLabel: '해임하고 저장',
                onConfirm: () => { setModal({ type: null, data: null }); doSave(); },
            } });
            return;
        }
        doSave();
    };
    const handleClose = () => {
        if (!dirty || saving) { onCancel(); return; }
        setModal({ type: 'confirm', data: {
            title: '저장하지 않고 닫을까요?',
            body: `바뀐 항목 ${changes.length}개가 저장되지 않았어요.\n${changes.join(' · ')}`,
            confirmLabel: '닫기', cancelLabel: '계속 편집',
            onConfirm: () => { setModal({ type: null, data: null }); onCancel(); },
        } });
    };

    if (!isAdmin) return null;


    return (
        <ModalShell
            title="설정"
            titleClass="display"
            subtitle={dirty ? `바뀐 항목 ${changes.length}개 — 아래 저장을 눌러야 반영돼요` : '바꾼 뒤 아래 저장을 누르면 모두 한 번에 반영돼요'}
            onClose={handleClose}
            size="lg"
            sheet
            zIndex={50}
            bodyClass="space-y-4"
            footer={(
                <div className="w-full">
                    <div className="flex gap-2" data-tut="set-save">
                        <button type="button" onClick={handleClose} className="cox-btn ghost" disabled={saving}>{dirty ? '취소' : '닫기'}</button>
                        <button type="button" onClick={handleSave} className="cox-btn primary" disabled={saving || !dirty}>
                            {saving ? '저장 중…' : dirty ? `저장 (${changes.length})` : '저장'}
                        </button>
                    </div>
                    <VersionInfo className="mt-3" />
                </div>
            )}
        >
            {/* ── [청백전] 경기 방식 — 즉시 적용 ── */}
            <div className={`p-3 rounded-lg tm-mode-box ${isTeam ? 'team' : ''}`} data-tut="set-mode">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-lg arcade-font" style={{ color: isTeam ? '#93C5FD' : 'var(--text)' }}>⚔️ 경기 방식</h3>
                    <span className={`text-[11px] font-black rounded-full px-2.5 py-1 ${isTeam ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40' : 'bg-gray-600 text-gray-200'}`}>
                        {isTeam ? '청백전 진행 중' : '일반 모드'}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => (isTeam ? onSwitchMatchMode?.(MATCH_MODE_NORMAL) : null)} className={`tm-mode-btn ${!isTeam ? 'on' : ''}`} aria-pressed={!isTeam}>
                        <span className="tm-mode-btn-title">🏸 일반</span>
                        <span className="tm-mode-btn-desc">회원 명단 · 게스트 · 자유 매칭</span>
                    </button>
                    <button type="button" onClick={() => (isTeam ? null : onSwitchMatchMode?.(MATCH_MODE_TEAM))} className={`tm-mode-btn team ${isTeam ? 'on' : ''}`} aria-pressed={isTeam}>
                        <span className="tm-mode-btn-title">⚔️ 청백전</span>
                        <span className="tm-mode-btn-desc">청 vs 백 · 팀 점수판 · 승패 기록</span>
                    </button>
                </div>
                {isTeam && teamScores && (
                    <div className="mt-2 flex items-center justify-center gap-3 text-sm font-black">
                        <span style={{ color: TEAM_META[TEAM_BLUE].text }}>청 {teamScores.blue ?? 0}</span>
                        <span className="text-gray-500">:</span>
                        <span style={{ color: TEAM_META[TEAM_WHITE].text }}>백 {teamScores.white ?? 0}</span>
                    </div>
                )}
                <p className="text-[10px] text-gray-400 mt-2 leading-relaxed text-center">
                    <b className="text-yellow-300">⚡ 즉시 적용</b> — 방식을 바꾸면 <b className="text-red-300">접속 중인 선수 전원이 내보내지고</b> 경기방·점수판이 비워집니다.<br />
                    선수들은 다시 입장해야 합니다. (오늘 경기 기록은 유지 · 아래 저장 버튼과 무관)
                </p>
            </div>

            {/* ── 자동 매칭 ── */}
            <div className={SECTION} data-tut="set-auto">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-lg text-green-400 arcade-font">🤖 콕스타 자동 매칭</h3>
                    <button type="button" onClick={() => setShowAutoGuide(true)} className="flex items-center gap-1 text-xs font-bold bg-green-500/15 text-green-300 border border-green-500/40 rounded-full px-3 min-h-[36px] hover:bg-green-500/25 transition-colors">
                        📖 사용설명서
                    </button>
                </div>
                <div className="bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300 leading-relaxed">
                    메인 화면 <b className="text-green-300">🤖 자동 매칭</b>의 <b className="text-blue-300">👨 남자</b> / <b className="text-pink-300">👩 여자</b> / <b className="text-purple-300">💑 혼복</b> 버튼을 누르면
                    <b className="text-white"> 후보 6개(베스트 2·보통 2·아쉬움 2)</b>가 이유와 함께 표시됩니다. 골라서 탭하면 목록에 들어가요.
                    <br />
                    <span className="text-xs text-gray-400">후보는 <b className="text-gray-200">접속한 전원(경기중 포함)</b>이며, 이미 다음 경기가 잡힌 선수와 휴식 중인 선수는 빠집니다.</span>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-600 space-y-4">
                    <div className="bg-gray-800 p-2 rounded text-center">
                        <p className="text-sm text-gray-400">현재 활성 인원: <span className="text-blue-300 font-bold">남 {malePlayerCount}</span> / <span className="text-pink-300 font-bold">여 {femalePlayerCount}</span> 명</p>
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <p className="font-semibold">매칭 민감도</p>
                            <label className="flex items-center text-xs cursor-pointer text-gray-300 min-h-[36px]">
                                <input type="checkbox" checked={autoMatchConfig.perGenderSensitivity || false} onChange={(e) => setAutoMatchConfig((prev) => ({ ...prev, perGenderSensitivity: e.target.checked }))} className="w-4 h-4 mr-1.5 text-green-400 bg-gray-700 border-gray-600 rounded focus:ring-green-500" />
                                남/여 따로
                            </label>
                        </div>
                        {!autoMatchConfig.perGenderSensitivity ? (
                            <>
                                <SensitivitySelect label="매칭 민감도" value={autoMatchConfig.sensitivity || 'normal'} onChange={(key) => setAutoMatchConfig((prev) => ({ ...prev, sensitivity: key, maleSensitivity: key, femaleSensitivity: key }))} />
                                <p className="text-xs text-green-300/90 mt-2 text-center min-h-[2.5em]">
                                    <span className="font-bold">{getSensitivity(autoMatchConfig.sensitivity || 'normal').label}</span>{' · '}{getSensitivity(autoMatchConfig.sensitivity || 'normal').desc}
                                </p>
                            </>
                        ) : (
                            <div className="space-y-3">
                                <div>
                                    <p className="text-sm text-blue-300 font-semibold mb-1">👨 남자</p>
                                    <SensitivitySelect label="남자 매칭 민감도" value={autoMatchConfig.maleSensitivity || 'normal'} onChange={(key) => setAutoMatchConfig((prev) => ({ ...prev, maleSensitivity: key }))} />
                                </div>
                                <div>
                                    <p className="text-sm text-pink-300 font-semibold mb-1">👩 여자</p>
                                    <SensitivitySelect label="여자 매칭 민감도" value={autoMatchConfig.femaleSensitivity || 'normal'} onChange={(key) => setAutoMatchConfig((prev) => ({ ...prev, femaleSensitivity: key }))} />
                                </div>
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-gray-500 text-center leading-relaxed">
                        민감도는 <b>경기중인 선수를 몇 명까지 미리 예약할지</b>를 정합니다.<br />
                        <b>낮음</b> 0명(만들면 바로 시작) · <b>보통</b> 1명 · <b>높음</b> 2명 · <b>최고</b> 제한 없음<br />
                        많이 넣을수록 <b>공평</b>해지지만 코트가 끝나기를 기다리는 경기가 늘어요. 잘 모르겠으면 <b>보통</b>, 사람이 많은 날은 <b>높음</b>.
                    </p>
                </div>
            </div>

            {/* ── 관리자 권한 (저장 때 반영) ── */}
            <div className={SECTION} data-tut="set-admin">
                <h3 className="font-semibold text-lg text-yellow-400 arcade-font block mb-1">👑 관리자 권한</h3>
                <p className="text-xs text-gray-400 mb-3">
                    이름을 입력하고 <b className="text-yellow-300">추가</b>를 누른 뒤, 목록의 <b className="text-red-300">✕</b>로 뺄 수 있어요. <b className="text-white">아래 저장을 눌러야 반영됩니다.</b>
                </p>
                <div className="flex gap-2">
                    <input
                        type="text" list="admin-name-suggestions" value={adminInput}
                        onChange={(e) => setAdminInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAdmin(); } }}
                        placeholder="이름 입력 (예: 홍길동)"
                        aria-label="관리자로 추가할 이름"
                        className="cox-field flex-1 min-w-0"
                    />
                    <datalist id="admin-name-suggestions">{rosterNames.map((n) => <option key={n} value={n} />)}</datalist>
                    <button type="button" onClick={handleAddAdmin} className="cox-btn primary sm" style={{ flex: '0 0 auto', minHeight: 46 }}>추가</button>
                </div>
                <ul className="mt-3 space-y-1.5" aria-label="관리자 목록">
                    {adminList.map((name) => {
                        const notInRoster = rosterNames.length > 0 && !rosterNames.includes(name);
                        const isSelf = currentUser?.name === name;
                        const isNew = !initial.adminList.includes(name);
                        return (
                            <li key={name} className="flex items-center justify-between bg-gray-800 pl-3 pr-1 py-1 rounded-lg min-h-[44px]">
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className="font-semibold truncate">👑 {name}</span>
                                    {isSelf && <span className="flex-shrink-0 text-[10px] font-bold text-green-300 bg-green-500/15 border border-green-500/40 rounded-full px-2 py-0.5">나</span>}
                                    {isNew && <span className="flex-shrink-0 text-[10px] font-bold text-yellow-300 bg-yellow-500/15 border border-yellow-500/40 rounded-full px-2 py-0.5">저장 전</span>}
                                    {notInRoster && <span className="flex-shrink-0 text-[10px] font-bold text-orange-300 bg-orange-500/15 border border-orange-500/40 rounded-full px-2 py-0.5">명단에 없음</span>}
                                </span>
                                <button type="button" onClick={() => handleRemoveAdmin(name)} aria-label={`${name} 관리자에서 빼기`} className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full text-red-300 hover:bg-red-900/40 font-bold">✕</button>
                            </li>
                        );
                    })}
                </ul>
                <p className="text-xs text-gray-500 mt-2">· 이름은 <b>입장할 때 쓰는 이름</b>과 정확히 같아야 합니다(띄어쓰기 주의).<br />· 관리자는 최소 1명이 필요해서 마지막 한 명은 뺄 수 없습니다.</p>
            </div>

            {/* ── 일반 설정 ── */}
            <div className={SECTION} data-tut="set-general">
                <h3 className="font-semibold mb-3 block text-center">코트 수</h3>
                <div className="flex items-center justify-around">
                    <div className="text-center">
                        <p className="text-sm mb-1">경기 예정</p>
                        <Stepper label="경기 예정 코트 수" value={scheduled} onChange={setScheduled} />
                    </div>
                    <div className="text-center">
                        <p className="text-sm mb-1">경기 진행</p>
                        <Stepper label="경기 진행 코트 수" value={courts} onChange={setCourts} />
                    </div>
                </div>
            </div>

            {/* ── 시즌 공지 ── */}
            <div className={`${SECTION} space-y-3`} data-tut="set-notice">
                <h3 className="font-semibold block text-center border-b border-gray-600 pb-2">시즌 공지 설정</h3>
                <div className="flex flex-wrap justify-center gap-3 mb-2 text-sm" role="radiogroup" aria-label="공지 방식">
                    {[['none', '없음'], ['simple', '일반 텍스트'], ['text', '포스터'], ['photo', '사진 업로드']].map(([value, label]) => (
                        <label key={value} className="flex items-center gap-1.5 cursor-pointer min-h-[36px]">
                            <input type="radio" name="announcementType" value={value} checked={(autoMatchConfig.announcementType || 'text') === value} onChange={(e) => setAutoMatchConfig((prev) => ({ ...prev, announcementType: e.target.value }))} />
                            <span>{label}</span>
                        </label>
                    ))}
                </div>
                {autoMatchConfig.announcementType === 'none' ? (
                    <div className="text-center text-sm text-gray-400 py-3 bg-gray-800 rounded">접속 시 공지사항 창을 띄우지 않고 바로 방으로 입장합니다.</div>
                ) : autoMatchConfig.announcementType === 'photo' ? (
                    <div className="space-y-2">
                        <input type="file" accept="image/*" aria-label="공지 사진 선택" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                            className="w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-yellow-500 file:text-black hover:file:bg-yellow-600" />
                        {photoFile && <p className="text-[10px] text-green-300 text-center">선택됨: {photoFile.name} (저장 시 1600px로 줄여 업로드)</p>}
                        {!photoFile && seasonConfig.announcementPhotoUrl && <p className="text-[10px] text-gray-500 text-center">기존 사진이 등록되어 있습니다. 변경 시 덮어씌워집니다.</p>}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} rows="3" placeholder="공지 내용을 입력하세요" aria-label="공지 내용" className="cox-field" style={{ minHeight: 90 }}></textarea>
                        <p className="text-[10px] text-center text-gray-500">
                            {autoMatchConfig.announcementType === 'simple' ? '입력한 내용이 모달 창에 깔끔한 일반 텍스트 형태로 표시됩니다.' : "입력한 내용이 '사용자 지정 포스터' 디자인에 자동으로 삽입됩니다."}
                        </p>
                    </div>
                )}
            </div>

            {/* ── 소모임 연동 ── */}
            <div className={`${SECTION} space-y-3`} data-tut="set-somoim">
                <h3 className="font-semibold block text-center border-b border-gray-600 pb-2">🏸 소모임 연동</h3>
                <button type="button" onClick={onOpenRoster} className="cox-btn ghost block">👥 선수 정보 관리 (명단)</button>
                <button type="button" onClick={onSomoimSync} className="cox-btn ghost block">🔄 소모임 정모 동기화 (참석자 → 선수카드)</button>
                {somoimSync?.lastResult && (
                    <div className="bg-gray-800 rounded-lg p-2.5 text-xs text-gray-300 space-y-1">
                        <p className="text-gray-400">마지막 동기화: {new Date(somoimSync.lastResult.at).toLocaleString('ko-KR')}{somoimSync.lastResult.trigger === 'auto' ? ' (자동)' : ' (수동)'}</p>
                        {somoimSync.lastResult.noEvent ? <p>당일 정모 없음</p> : (
                            <>
                                <p>생성 {somoimSync.lastResult.created?.length || 0}명 · 재입장 {somoimSync.lastResult.activated?.length || 0}명 · 이미 입장 {somoimSync.lastResult.already?.length || 0}명</p>
                                {somoimSync.lastResult.unmatched?.length > 0 && <p className="text-yellow-400">⚠ 명단 미등록: {somoimSync.lastResult.unmatched.join(', ')}</p>}
                            </>
                        )}
                    </div>
                )}
                {somoimSync?.lastError && (
                    <div className="cox-box danger text-xs">⚠ 마지막 자동 동기화 실패 (오류코드: {somoimSync.lastError.code}) — {new Date(somoimSync.lastError.at).toLocaleString('ko-KR')}</div>
                )}
                <p className="text-[10px] text-gray-500 text-center leading-relaxed">정모가 있는 날 <b>오후 6시</b>에 참석 인원의 선수카드가 자동 생성됩니다.<br />버튼을 누르면 지금 즉시 동기화합니다. (여러 번 눌러도 안전)</p>
            </div>

            {/* ── 하루 요약 카드 ── */}
            <div className={`${SECTION} space-y-2`} data-tut="set-summary">
                <h3 className="font-semibold block text-center border-b border-gray-600 pb-2">📸 오늘의 운동 요약</h3>
                <button type="button" onClick={() => setShowDailySummary(true)} className="cox-btn ghost block">📸 하루 요약 카드 만들기</button>
                <p className="text-[10px] text-gray-500 text-center leading-relaxed">오늘 참석 멤버(게스트 포함)·총 경기 수·1인 평균 경기 수를<br />멋진 카드 한 장으로 만들어 <b>단톡방에 바로 공유</b>합니다.</p>
            </div>

            {/* ── 선수 수동 추가 ── */}
            <div className={`${SECTION} space-y-2`} data-tut="set-addplayer">
                <button type="button" className="flex justify-between items-center w-full min-h-[40px]" onClick={() => setShowAddPlayerForm((v) => !v)} aria-expanded={showAddPlayerForm}>
                    <span className="font-semibold">👤 관리자 선수 임의 추가</span>
                    <span className="text-gray-400" aria-hidden="true">{showAddPlayerForm ? '▲' : '▼'}</span>
                </button>
                {showAddPlayerForm && (
                    <div className="bg-gray-800 p-3 rounded border border-gray-600 mt-2 space-y-3">
                        <input type="text" placeholder="이름" aria-label="이름" value={newPlayerForm.name} onChange={(e) => setNewPlayerForm((prev) => ({ ...prev, name: e.target.value }))} className="cox-field" />
                        <div className={`grid gap-1 ${isTeam ? 'grid-cols-5' : 'grid-cols-4'}`} role="radiogroup" aria-label="급수">
                            {(isTeam ? ['S조', 'A조', 'B조', 'C조', 'D조'] : ['A조', 'B조', 'C조', 'D조']).map((level) => (
                                <button key={level} type="button" role="radio" aria-checked={newPlayerForm.level === level} onClick={() => setNewPlayerForm((prev) => ({ ...prev, level }))}
                                    className={`min-h-[40px] rounded text-xs font-bold transition-colors arcade-button ${newPlayerForm.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}>
                                    {level}
                                </button>
                            ))}
                        </div>
                        <div className="flex justify-around items-center text-sm bg-gray-600 p-2 rounded-md">
                            <label className="flex items-center cursor-pointer min-h-[36px]"><input type="radio" name="newPlayerGender" value="남" checked={newPlayerForm.gender === '남'} onChange={() => setNewPlayerForm((prev) => ({ ...prev, gender: '남' }))} className="mr-1 h-4 w-4" /> 남자</label>
                            <label className="flex items-center cursor-pointer min-h-[36px]"><input type="radio" name="newPlayerGender" value="여" checked={newPlayerForm.gender === '여'} onChange={() => setNewPlayerForm((prev) => ({ ...prev, gender: '여' }))} className="mr-1 h-4 w-4" /> 여자</label>
                            {!isTeam && (
                                <>
                                    <div className="w-px h-4 bg-gray-500"></div>
                                    <label className="flex items-center cursor-pointer min-h-[36px]"><input type="checkbox" checked={newPlayerForm.isGuest} onChange={(e) => setNewPlayerForm((prev) => ({ ...prev, isGuest: e.target.checked }))} className="mr-1 h-4 w-4 rounded" /> 게스트</label>
                                </>
                            )}
                        </div>
                        {isTeam && (
                            <div className="grid grid-cols-2 gap-2">
                                {[TEAM_BLUE, TEAM_WHITE].map((team) => (
                                    <button key={team} type="button" onClick={() => setNewPlayerForm((prev) => ({ ...prev, team }))} className={`tm-team-pick small ${TEAM_META[team].key} ${newPlayerForm.team === team ? 'on' : ''}`} aria-pressed={newPlayerForm.team === team}>
                                        <span className="tm-team-pick-mark">{team}</span>
                                        <span className="tm-team-pick-name">{TEAM_META[team].label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <button type="button" className="cox-btn primary block sm"
                            onClick={() => {
                                onAdminAddPlayer(isTeam ? { ...newPlayerForm, isGuest: false } : { ...newPlayerForm, team: null });
                                setNewPlayerForm({ name: '', level: 'A조', gender: '남', isGuest: false, team: TEAM_BLUE });
                                setShowAddPlayerForm(false);
                            }}>
                            추가하기
                        </button>
                    </div>
                )}
            </div>

            {/* ── 고급 기능 ── */}
            <div className={`${SECTION} space-y-2`} data-tut="set-advanced">
                <h3 className="font-semibold mb-2 block text-center">고급 기능</h3>
                <div className="bg-gray-800 p-2 rounded border border-gray-600 mb-4">
                    <p className="text-sm font-semibold text-center mb-2 text-cyan-400">🤖 테스트 로봇 생성 (개발용)</p>
                    <div className="flex justify-around gap-2 mb-2">
                        <div className="flex-1 text-center">
                            <label className="block text-xs mb-1 text-gray-400" htmlFor="robot-male">👨 남자 수</label>
                            <input id="robot-male" type="number" min="0" value={robotMaleCount} onChange={(e) => setRobotMaleCount(Number(e.target.value))} className="cox-field text-center" />
                        </div>
                        <div className="flex-1 text-center">
                            <label className="block text-xs mb-1 text-gray-400" htmlFor="robot-female">👩 여자 수</label>
                            <input id="robot-female" type="number" min="0" value={robotFemaleCount} onChange={(e) => setRobotFemaleCount(Number(e.target.value))} className="cox-field text-center" />
                        </div>
                    </div>
                    <button type="button" className="cox-btn ghost block sm" disabled={robotMaleCount === 0 && robotFemaleCount === 0}
                        onClick={() => { onGenerateRobots(robotMaleCount, robotFemaleCount); setRobotMaleCount(0); setRobotFemaleCount(0); }}>
                        로봇 생성하기
                    </button>
                </div>
                <button type="button" onClick={onSystemReset} className="cox-btn ghost block" style={{ borderColor: 'rgba(255,196,0,.4)', color: '#FFE08A' }}>모두 대기로 이동</button>
                <button type="button" onClick={onClearPlayerHistory} className="cox-btn ghost block" style={{ borderColor: 'rgba(255,106,82,.45)', color: 'var(--coral)' }}>선수 히스토리 삭제</button>
            </div>

            {showAutoGuide && <AutoMatchGuideModal onClose={() => setShowAutoGuide(false)} />}
            {showDailySummary && <DailySummaryModal allPlayers={allPlayers} onClose={() => setShowDailySummary(false)} />}
        </ModalShell>
    );
}

// [자동매칭] 초보 관리자용 사용설명서 — 짧고 핵심만
function AutoMatchGuideModal({ onClose }) {
    return (
        <ModalShell title="🤖 자동 매칭 사용설명서" titleClass="display" onClose={onClose} size="md" tone="accent" zIndex={60}
            footer={<button type="button" onClick={onClose} className="cox-btn primary">확인했어요</button>}>
            <div className="space-y-4 text-sm">
                <div>
                    <p className="font-bold text-green-300 mb-1">① 자동 매칭이 뭔가요?</p>
                    <p className="text-gray-300 leading-relaxed">대기 중인 선수를 시스템이 알아서 <b>4명</b> 골라 <b>'🤖 자동 매칭'</b> 칸에 올려줍니다. 관리자는 <b>START</b>만 누르면 경기가 시작돼요.</p>
                </div>
                <div>
                    <p className="font-bold text-green-300 mb-1">② 어떤 기준으로 짜나요?</p>
                    <p className="text-gray-300 leading-relaxed"><b>1순위</b> 오늘 만났던 사람과 <b>또 안 묶이게</b><br /><b>2순위</b> <b>오래 기다린</b> 사람 먼저<br /><b>3순위</b> 4명의 <b>급수</b>가 서로 맞게<br /><b>4순위</b> 경기 수 (2경기 차이까지는 괜찮아요)</p>
                </div>
                <div>
                    <p className="font-bold text-green-300 mb-1">③ 만드는 법</p>
                    <p className="text-gray-300 leading-relaxed">메인 화면 '🤖 자동 매칭'의 <b className="text-blue-300">👨 남자</b> / <b className="text-pink-300">👩 여자</b> / <b className="text-purple-300">💑 혼복</b> 매칭 만들기를 누르면 <b>누를 때마다 한 경기</b>가 만들어집니다. 두 경기가 필요하면 두 번 누르면 돼요.<br />혼복은 <b>남2+여2</b>를 뽑아 <b>남1+여1 팀</b>으로 자동 배치합니다.</p>
                </div>
                <div>
                    <p className="font-bold text-green-300 mb-1">④ "매칭 난이도를 낮춰주세요"가 뜨면?</p>
                    <p className="text-gray-300 leading-relaxed">지금 만들 수 있는 조합이 전부 <b>기준 점수</b>에 못 미친다는 뜻입니다(예: 방금 같이 친 사람끼리만 남음). <b>매칭 민감도</b>를 한 단계 낮추거나, 경기가 끝나 대기 선수가 늘어난 뒤 다시 눌러주세요.</p>
                </div>
                <div>
                    <p className="font-bold text-green-300 mb-1">⑤ 민감도 고르기</p>
                    <ul className="text-gray-300 leading-relaxed space-y-1">
                        {AUTO_MATCH_SENSITIVITIES.map((s) => <li key={s.key}><b className="text-white">{s.label}</b> — {s.short}: <span className="text-gray-400">{s.desc}</span></li>)}
                    </ul>
                </div>
                <div className="cox-box accent">
                    <p className="font-bold text-green-300 mb-1">💡 한 줄 팁</p>
                    <p className="text-gray-300 leading-relaxed">사람이 <b>적으면 낮음~보통</b>, <b>많으면 높음~최고</b>. 고민되면 그냥 <b>보통</b>으로 두세요. 인원에 맞춰 깐깐함은 자동으로 조절됩니다.</p>
                </div>
            </div>
        </ModalShell>
    );
}

// [하루 요약 카드] 미리보기 → 공유/저장
function DailySummaryModal({ allPlayers, onClose }) {
    const [imgUrl, setImgUrl] = useState(null);
    const [blob, setBlob] = useState(null);
    const [shareMsg, setShareMsg] = useState(null);
    const summary = useMemo(() => computeDailySummary(allPlayers), [allPlayers]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl = null;
        (async () => {
            try {
                await Promise.all([
                    document.fonts.load('900 104px "Noto Sans KR"'),
                    document.fonts.load('700 30px "Noto Sans KR"'),
                    document.fonts.load('400 34px "Anton"'),
                ]);
            } catch { /* 폰트 실패해도 시스템 폰트로 그린다 */ }
            if (cancelled) return;
            const canvas = document.createElement('canvas');
            drawSummaryCard(canvas, summary);
            canvas.toBlob((b) => {
                if (cancelled || !b) return;
                objectUrl = URL.createObjectURL(b);
                setBlob(b);
                setImgUrl(objectUrl);
            }, 'image/png');
        })();
        return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [summary]);

    const fileName = () => {
        const d = summary.date;
        return `콕스라이팅_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_운동요약.png`;
    };
    const handleDownload = () => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = imgUrl; a.download = fileName(); a.click();
        setShareMsg('이미지가 저장되었어요. 단톡방에 사진으로 첨부해주세요!');
    };
    const handleShare = async () => {
        if (!blob) return;
        const file = new File([blob], fileName(), { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: '콕스라이팅 오늘의 운동', text: `🏸 콕스라이팅 오늘의 운동 — 참석 ${summary.attendees.length}명 · 총 ${summary.totalGames}경기` });
            } catch (e) { if (e && e.name !== 'AbortError') handleDownload(); }
            return;
        }
        handleDownload();
    };

    return (
        <ModalShell title="📸 하루 요약 카드" titleClass="display accent" onClose={onClose} size="md" zIndex={70}
            footer={(
                <div className="w-full flex flex-col gap-2">
                    <button type="button" onClick={handleShare} disabled={!blob} className="cox-btn primary block">📤 단톡방에 공유하기</button>
                    <button type="button" onClick={handleDownload} disabled={!blob} className="cox-btn ghost block sm">💾 이미지로 저장</button>
                </div>
            )}>
            {!imgUrl ? (
                <div className="sk rounded-xl" style={{ height: 320 }} aria-label="카드를 만들고 있어요" />
            ) : (
                <img src={imgUrl} alt="오늘의 운동 요약 카드" className="w-full rounded-xl shadow-2xl" />
            )}
            {shareMsg && <p className="text-center text-xs text-green-300 mt-3 whitespace-pre-line" role="status">{shareMsg}</p>}
        </ModalShell>
    );
}
