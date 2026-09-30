import React, { useState, useEffect } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import { playersRef } from '../lib/firebase';
import { CoxMark } from './Logo';
import { TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../lib/helpers';

// ===================================================================================
// 신규 및 복구된 페이지/모달 컴포넌트들
// ===================================================================================
// [선수 명단] 입장 화면 개편 — 회원은 이름만 입력하면 명단에서 급수/성별을 자동으로
// 가져온다. 급수/성별 선택은 게스트(명단에 없는 손님)에게만 표시된다.
//
// [청백전] teamMode 가 켜지면 화면이 완전히 달라진다.
//   · 게스트 체크란이 없다 — 모두가 이름·급수(S~D)·성별·팀(청/백)을 직접 고른다
//   · 명단에 있는 이름이면 급수/성별을 미리 채워 주되, 바꿀 수 있다 (S조는 명단에 없으므로)
//   · '관리자' 이름의 유령 관리자 입장은 그대로 동작한다
// ===================================================================================
const TEAM_LEVELS = ['S조', 'A조', 'B조', 'C조', 'D조'];

function EntryPage({ onEnter, roster, teamMode = false }) {
    const [formData, setFormData] = useState({ name: '', level: 'A조', gender: '남', isGuest: false, team: null });
    const [entryError, setEntryError] = useState(null);

    useEffect(() => {
        const savedUserId = localStorage.getItem('badminton-currentUser-id');
        if (savedUserId) {
             getDoc(doc(playersRef, savedUserId)).then(docSnap => {
                if (docSnap.exists()) {
                    const d = docSnap.data();
                    setFormData(prev => ({
                        ...prev,
                        name: d.name || prev.name,
                        isGuest: !!d.isGuest,
                        level: d.level || prev.level,
                        gender: d.gender || prev.gender,
                        team: d.team === TEAM_BLUE || d.team === TEAM_WHITE ? d.team : prev.team,
                    }));
                }
            }).catch(e => console.error("이전 입장 정보 불러오기 실패:", e));
        }
    }, []);

    // [청백전] 이름을 다 치면 명단에서 급수/성별을 미리 채워 준다 (수정 가능)
    useEffect(() => {
        if (!teamMode) return;
        const name = (formData.name || '').trim();
        if (!name) return;
        const entry = Object.values(roster || {}).find(r => r.name === name);
        if (entry) {
            setFormData(prev => ({
                ...prev,
                level: TEAM_LEVELS.includes(entry.level) ? entry.level : prev.level,
                gender: entry.gender || prev.gender,
            }));
        }
    }, [teamMode, formData.name, roster]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setEntryError(null);
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const name = (formData.name || '').trim();
        if (!name) { setEntryError('이름을 입력해주세요.'); return; }

        // [유령 관리자] 이름을 '관리자'로 입력하면 선수 카드 없이 관리자 기능만 사용한다.
        // 명단/게스트 검사를 모두 건너뛴다 (급수·성별 불필요).
        if (name === '관리자') {
            onEnter({ name, isGhostAdmin: true });
            return;
        }

        // [청백전] 팀을 골라야만 입장할 수 있다
        if (teamMode) {
            if (!formData.team) { setEntryError('청팀 / 백팀 중 하나를 골라주세요.'); return; }
            onEnter({ name, level: formData.level, gender: formData.gender, team: formData.team, isGuest: false, isTeamEntry: true });
            return;
        }

        if (formData.isGuest) {
            onEnter({ name, level: formData.level, gender: formData.gender, isGuest: true });
            return;
        }
        // 회원: 명단에서 급수/성별 자동 조회
        const rosterEntry = Object.values(roster || {}).find(r => r.name === name);
        if (!rosterEntry || !rosterEntry.level || !rosterEntry.gender) {
            setEntryError('등록된 선수 정보가 없습니다.\n관리자에게 문의해주세요.\n\n(모임 회원이 아닌 손님은 아래 "게스트"를 체크하고 입장해주세요.)');
            return;
        }
        onEnter({ name, level: rosterEntry.level, gender: rosterEntry.gender, isGuest: false });
    };

    const renderLevelButtons = (levels) => levels.map(level => (
        <button
            key={level}
            type="button"
            name="level"
            onClick={() => { setEntryError(null); setFormData(prev => ({ ...prev, level })); }}
            className={`w-full p-3 rounded-md font-bold transition-colors arcade-button ${formData.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}
        >
            {level}
        </button>
    ));

    const genderRadios = (
        <div className="flex justify-around items-center text-lg">
            <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="남" checked={formData.gender === '남'} onChange={handleChange} className="mr-2 h-4 w-4 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자</label>
            <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="여" checked={formData.gender === '여'} onChange={handleChange} className="mr-2 h-4 w-4 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자</label>
        </div>
    );

    return (
              <div className="cox-dark text-white min-h-screen flex items-center justify-center font-sans p-4 relative">
            <div className="modal-content bg-gray-800 p-8 w-full max-w-sm" style={{ borderRadius: '26px' }}>
                {/* [브랜드 CI] 볼트 셔틀 마크 — 브랜드 첫 인상 */}
                <div className="cox-entry-mark">
                    <CoxMark size={64} glow />
                </div>
                <p className="cox-label text-center mb-2" style={{ color: 'var(--volt)' }}>Premium Match System</p>
                <h1 className="text-3xl font-bold text-yellow-400 mb-1 text-center arcade-font flicker-text" style={{ letterSpacing: '.06em' }}>COCKSLIGHTING</h1>
                {teamMode ? (
                    <div className="flex justify-center mb-5">
                        <span className="tm-mode-chip">⚔️ 청백전 모드</span>
                    </div>
                ) : (
                    <p className="text-center text-gray-500 text-xs mb-6 tracking-wide">실시간 배드민턴 경기 관리</p>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" name="name" placeholder="이름" value={formData.name} onChange={handleChange} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400" required />

                    {teamMode ? (
                        <>
                            {/* [청백전] 급수 S~D · 성별 · 팀 선택 (게스트 체크란 없음) */}
                            <div>
                                <p className="tm-entry-label">급수</p>
                                <div className="grid grid-cols-5 gap-1.5">
                                    {renderLevelButtons(TEAM_LEVELS)}
                                </div>
                            </div>
                            <div>
                                <p className="tm-entry-label">성별</p>
                                {genderRadios}
                            </div>
                            <div>
                                <p className="tm-entry-label">우리 팀</p>
                                <div className="grid grid-cols-2 gap-2" data-tut="entry-team">
                                    {[TEAM_BLUE, TEAM_WHITE].map(team => {
                                        const meta = TEAM_META[team];
                                        const on = formData.team === team;
                                        return (
                                            <button
                                                key={team}
                                                type="button"
                                                onClick={() => { setEntryError(null); setFormData(prev => ({ ...prev, team })); }}
                                                className={`tm-team-pick ${meta.key} ${on ? 'on' : ''}`}
                                                aria-pressed={on}
                                            >
                                                <span className="tm-team-pick-mark">{team}</span>
                                                <span className="tm-team-pick-name">{meta.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {!formData.isGuest && (
                                <p className="text-center text-gray-400 text-xs bg-gray-700/50 rounded-lg py-2 px-3">
                                    회원은 이름만 입력하면 등록된 급수로 입장됩니다.
                                </p>
                            )}

                            {/* 게스트만 급수/성별을 직접 선택한다 (회원은 명단에서 자동) */}
                            {formData.isGuest && (
                                <>
                                    <div className="grid grid-cols-4 gap-2">
                                        {renderLevelButtons(['A조', 'B조', 'C조', 'D조'])}
                                    </div>
                                    {genderRadios}
                                </>
                            )}

                            <div className="text-center">
                                <label className="flex items-center justify-center text-lg cursor-pointer">
                                    <input type="checkbox" name="isGuest" checked={formData.isGuest} onChange={handleChange} className="mr-2 h-4 w-4 rounded text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" />
                                    게스트
                                </label>
                            </div>
                        </>
                    )}

                    {entryError && (
                        <div className="bg-red-900/40 border border-red-500/50 text-red-200 text-sm rounded-lg p-3 text-center whitespace-pre-line">
                            {entryError}
                        </div>
                    )}

                    <button
                        type="submit"
                        className={`w-full arcade-button font-bold py-3 rounded-lg transition duration-300 ${
                            teamMode && formData.team ? `tm-submit ${TEAM_META[formData.team].key}` : 'bg-yellow-500 hover:bg-yellow-600 text-black'
                        }`}
                    >
                        {teamMode && formData.team ? `${TEAM_META[formData.team].label}으로 입장하기` : '입장하기'}
                    </button>
                </form>
            </div>
        </div>
    );
}




export { EntryPage };
