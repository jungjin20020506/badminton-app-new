import React, { useState, useEffect } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import { playersRef } from '../lib/firebase';
import { CoxMark } from './Logo';

// ===================================================================================
// 신규 및 복구된 페이지/모달 컴포넌트들
// ===================================================================================
// [선수 명단] 입장 화면 개편 — 회원은 이름만 입력하면 명단에서 급수/성별을 자동으로
// 가져온다. 급수/성별 선택은 게스트(명단에 없는 손님)에게만 표시된다.
function EntryPage({ onEnter, roster }) {
    const [formData, setFormData] = useState({ name: '', level: 'A조', gender: '남', isGuest: false });
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
                    }));
                }
            }).catch(e => console.error("이전 입장 정보 불러오기 실패:", e));
        }
    }, []);

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

    const levelButtons = ['A조', 'B조', 'C조', 'D조'].map(level => (
        <button
            key={level}
            type="button"
            name="level"
            onClick={() => setFormData(prev => ({ ...prev, level }))}
            className={`w-full p-3 rounded-md font-bold transition-colors arcade-button ${formData.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}
        >
            {level}
        </button>
    ));

    return (
              <div className="cox-dark text-white min-h-screen flex items-center justify-center font-sans p-4 relative">
            <div className="modal-content bg-gray-800 p-8 w-full max-w-sm" style={{ borderRadius: '26px' }}>
                {/* [브랜드 CI] 볼트 셔틀 마크 — 브랜드 첫 인상 */}
                <div className="cox-entry-mark">
                    <CoxMark size={64} glow />
                </div>
                <p className="cox-label text-center mb-2" style={{ color: 'var(--volt)' }}>Premium Match System</p>
                <h1 className="text-3xl font-bold text-yellow-400 mb-1 text-center arcade-font flicker-text" style={{ letterSpacing: '.06em' }}>COCKSLIGHTING</h1>
                <p className="text-center text-gray-500 text-xs mb-6 tracking-wide">실시간 배드민턴 경기 관리</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" name="name" placeholder="이름" value={formData.name} onChange={handleChange} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400" required />

                    {!formData.isGuest && (
                        <p className="text-center text-gray-400 text-xs bg-gray-700/50 rounded-lg py-2 px-3">
                            회원은 이름만 입력하면 등록된 급수로 입장됩니다.
                        </p>
                    )}

                    {/* 게스트만 급수/성별을 직접 선택한다 (회원은 명단에서 자동) */}
                    {formData.isGuest && (
                        <>
                            <div className="grid grid-cols-4 gap-2">
                                {levelButtons}
                            </div>
                            <div className="flex justify-around items-center text-lg">
                                <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="남" checked={formData.gender === '남'} onChange={handleChange} className="mr-2 h-4 w-4 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자</label>
                                <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="여" checked={formData.gender === '여'} onChange={handleChange} className="mr-2 h-4 w-4 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자</label>
                            </div>
                        </>
                    )}

                    <div className="text-center">
                        <label className="flex items-center justify-center text-lg cursor-pointer">
                            <input type="checkbox" name="isGuest" checked={formData.isGuest} onChange={handleChange} className="mr-2 h-4 w-4 rounded text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" />
                            게스트
                        </label>
                    </div>

                    {entryError && (
                        <div className="bg-red-900/40 border border-red-500/50 text-red-200 text-sm rounded-lg p-3 text-center whitespace-pre-line">
                            {entryError}
                        </div>
                    )}

                    <button type="submit" className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg transition duration-300">입장하기</button>
                </form>
            </div>
        </div>
    );
}




export { EntryPage };