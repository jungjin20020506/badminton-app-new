import React, { useState, useEffect, useMemo } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { configRef } from '../lib/firebase';
import { getAdminNames } from '../lib/helpers';
import { AUTO_MATCH_SENSITIVITIES, getSensitivity } from '../lib/matching';
import { computeDailySummary, drawSummaryCard } from '../lib/summaryCard';

function SettingsModal({ isAdmin, scheduledCount, courtCount, seasonConfig, activePlayers, allPlayers, currentUser, roster, onSave, onCancel, setModal, onSystemReset, onClearPlayerHistory, onGenerateRobots, onAdminAddPlayer, onSomoimSync, onOpenRoster, somoimSync }) {
    const [scheduled, setScheduled] = useState(scheduledCount);
    const [courts, setCourts] = useState(courtCount);
    const [announcement, setAnnouncement] = useState(seasonConfig.announcement);
    const [robotMaleCount, setRobotMaleCount] = useState(0);
    const [robotFemaleCount, setRobotFemaleCount] = useState(0);

    // [하루 요약 카드] 모달 표시 상태
    const [showDailySummary, setShowDailySummary] = useState(false);

    // 수동 선수 추가 폼 상태
    const [showAddPlayerForm, setShowAddPlayerForm] = useState(false);
    const [newPlayerForm, setNewPlayerForm] = useState({ name: '', level: 'A조', gender: '남', isGuest: false });

    // [자동매칭] 사용설명서 모달 표시 상태
    const [showAutoGuide, setShowAutoGuide] = useState(false);

    // 자동매칭 설정 상태 (수정됨)
    // [자동매칭] 민감도 프리셋 초기화 (구버전 설정 호환)
    //  ON/OFF는 더 이상 쓰지 않는다 — 메인 화면의 '매칭 만들기' 버튼으로 1경기씩 생성
  const [autoMatchConfig, setAutoMatchConfig] = useState(() => {
        const cfg = seasonConfig.autoMatchConfig || {};
        const sensitivity = cfg.sensitivity || 'normal';
        return {
            ...cfg,
            sensitivity,
            perGenderSensitivity: cfg.perGenderSensitivity ?? false,
            maleSensitivity: cfg.maleSensitivity || sensitivity,
            femaleSensitivity: cfg.femaleSensitivity || sensitivity,
            // [수정] 루트 레벨에 저장된 공지 타입과 사진 URL을 초기값으로 명시
            announcementType: seasonConfig.announcementType || 'text',
            announcementPhotoUrl: seasonConfig.announcementPhotoUrl || ''
        };
    });

    // [관리자 권한] 현재 관리자 목록 (config/season.adminNames 기준, 없으면 기본 관리자)
    const adminNames = useMemo(() => getAdminNames(seasonConfig), [seasonConfig]);
    const [adminInput, setAdminInput] = useState('');
    const [isAdminBusy, setIsAdminBusy] = useState(false);
    // 명단(roster)에 있는 이름인지 확인용 — 오타로 엉뚱한 이름이 등록되는 것을 눈으로 잡기 위함
    const rosterNames = useMemo(
        () => Object.values(roster || {}).map(r => r.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
        [roster]
    );

    if (!isAdmin) return null;
    
    const handleSave = () => {
        onSave({ scheduled, courts, announcement, autoMatchConfig });
    };

    // ── [관리자 권한] 부여/해임 — 아래 저장 버튼과 무관하게 즉시 반영된다 ──
    const saveAdminNames = async (nextList) => {
        setIsAdminBusy(true);
        try {
            await setDoc(configRef, { adminNames: nextList }, { merge: true });
        } catch (e) {
            console.error('관리자 목록 저장 실패:', e);
            setModal({ type: 'alert', data: { title: '오류', body: '관리자 목록 저장에 실패했습니다.' } });
        } finally {
            setIsAdminBusy(false);
        }
    };

    const handleAddAdmin = async () => {
        const name = (adminInput || '').trim();
        if (!name) {
            setModal({ type: 'alert', data: { title: '안내', body: '관리자 권한을 줄 사람의 이름을 입력해주세요.' } });
            return;
        }
        if (adminNames.includes(name)) {
            setModal({ type: 'alert', data: { title: '안내', body: `${name} 님은 이미 관리자입니다.` } });
            return;
        }
        await saveAdminNames([...adminNames, name]);
        setAdminInput('');
    };

    const handleRemoveAdmin = (name) => {
        // 마지막 한 명까지 해임하면 아무도 설정을 열 수 없게 되므로 막는다.
        if (adminNames.length <= 1) {
            setModal({ type: 'alert', data: {
                title: '해임할 수 없습니다',
                body: '관리자는 최소 1명이 있어야 합니다.\n먼저 다른 사람에게 관리자 권한을 준 뒤에 해임해주세요.'
            }});
            return;
        }
        const isSelf = currentUser?.name === name;
        setModal({ type: 'confirm', data: {
            title: '관리자 해임',
            body: isSelf
                ? `${name} 님(나 자신)의 관리자 권한을 해임할까요?\n해임하면 설정 창을 포함한 관리자 기능을 더 이상 쓸 수 없습니다.`
                : `${name} 님의 관리자 권한을 해임할까요?`,
            onConfirm: async () => {
                setModal({ type: null, data: null });
                await saveAdminNames(adminNames.filter(n => n !== name));
            }
        }});
    };

// [자동매칭] 현재 활성 인원수 (대기+진행+예정 모두 포함, 휴식 제외, 게스트 포함)
    const { malePlayerCount, femalePlayerCount } = useMemo(() => {
        const activePlayersList = Object.values(activePlayers).filter(p => !p.isResting);
        return {
            malePlayerCount: activePlayersList.filter(p => p.gender === '남').length,
            femalePlayerCount: activePlayersList.filter(p => p.gender === '여').length,
        };
    }, [activePlayers]);

    // [자동매칭] 민감도 세그먼트 선택 컴포넌트
    const SensitivitySelect = ({ value, onChange }) => (
        <div className="grid grid-cols-4 gap-1">
            {AUTO_MATCH_SENSITIVITIES.map(s => (
                <button
                    key={s.key}
                    type="button"
                    onClick={() => onChange(s.key)}
                    className={`py-1.5 rounded-md text-xs font-bold arcade-button transition-colors ${value === s.key ? 'bg-green-500 text-black' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}
                >
                    {s.label}
                </button>
            ))}
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg text-white shadow-lg flex flex-col" style={{maxHeight: '90vh'}}>
                <h3 className="text-xl font-bold text-white mb-6 arcade-font text-center flex-shrink-0">설정</h3>
                <div className="flex-grow overflow-y-auto pr-2 space-y-4">

                    {/* --- 자동 매칭 설정 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg" data-tut="set-auto">
                        <div className="flex justify-between items-center mb-3">
                            <label className="font-semibold text-lg text-green-400 arcade-font">
                                🤖 콕스타 자동 매칭
                            </label>
                            <button
                                type="button"
                                onClick={() => setShowAutoGuide(true)}
                                className="flex items-center gap-1 text-xs font-bold bg-green-500/15 text-green-300 border border-green-500/40 rounded-full px-3 py-1.5 hover:bg-green-500/25 transition-colors"
                            >
                                📖 사용설명서
                            </button>
                        </div>
                        {/* [자동매칭] 매칭 생성 방식 안내 (ON/OFF 폐지 → 버튼으로 1경기씩) */}
                        <div className="bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300 leading-relaxed">
                            메인 화면 <b className="text-green-300">🤖 자동 매칭</b>의
                            <b className="text-blue-300"> 👨 남자 매칭 만들기</b> /
                            <b className="text-pink-300"> 👩 여자 매칭 만들기</b> 버튼을 누를 때마다
                            <b className="text-white"> 한 경기씩</b> 만들어집니다.
                        </div>

                        {(
                            <div className="mt-4 pt-4 border-t border-gray-600 space-y-4">

                              {/* 현재 활성 인원 표시 */}
                               <div className="bg-gray-800 p-2 rounded text-center">
                                    <p className="text-sm text-gray-400">
                                        현재 활성 인원: <span className="text-blue-300 font-bold">남 {malePlayerCount}</span> / <span className="text-pink-300 font-bold">여 {femalePlayerCount}</span> 명
                                    </p>
                                </div>

                                {/* [자동매칭] 민감도 프리셋 (낮음/보통/높음/최고) */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <p className="font-semibold">매칭 민감도</p>
                                        <label className="flex items-center text-xs cursor-pointer text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={autoMatchConfig.perGenderSensitivity || false}
                                                onChange={(e) => setAutoMatchConfig(prev => ({ ...prev, perGenderSensitivity: e.target.checked }))}
                                                className="w-4 h-4 mr-1.5 text-green-400 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                                            />
                                            남/여 따로
                                        </label>
                                    </div>

                                    {!autoMatchConfig.perGenderSensitivity ? (
                                        <>
                                            <SensitivitySelect
                                                value={autoMatchConfig.sensitivity || 'normal'}
                                                onChange={(key) => setAutoMatchConfig(prev => ({ ...prev, sensitivity: key, maleSensitivity: key, femaleSensitivity: key }))}
                                            />
                                            <p className="text-xs text-green-300/90 mt-2 text-center min-h-[2.5em]">
                                                <span className="font-bold">{getSensitivity(autoMatchConfig.sensitivity || 'normal').label}</span>
                                                {' · '}{getSensitivity(autoMatchConfig.sensitivity || 'normal').desc}
                                            </p>
                                        </>
                                    ) : (
                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-sm text-blue-300 font-semibold mb-1">👨 남자</p>
                                                <SensitivitySelect
                                                    value={autoMatchConfig.maleSensitivity || 'normal'}
                                                    onChange={(key) => setAutoMatchConfig(prev => ({ ...prev, maleSensitivity: key }))}
                                                />
                                            </div>
                                            <div>
                                                <p className="text-sm text-pink-300 font-semibold mb-1">👩 여자</p>
                                                <SensitivitySelect
                                                    value={autoMatchConfig.femaleSensitivity || 'normal'}
                                                    onChange={(key) => setAutoMatchConfig(prev => ({ ...prev, femaleSensitivity: key }))}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <p className="text-xs text-gray-500 text-center">
                                    민감도가 <b>높을수록</b> 최대한 '안 친 사람'끼리 매칭합니다(조합이 까다로워짐).<br/>
                                    <b>낮을수록</b> 웬만한 조합도 바로 경기로 만듭니다. 잘 모르겠으면 <b>보통</b>.<br/>
                                    <span className="text-yellow-500/80">'매칭 만들기'에서 만들 조합이 없다고 나오면 민감도를 한 단계 낮춰보세요.</span>
                                </p>
                            </div>
                        )}
                    </div>

                    {/* --- [관리자 권한] 관리자 부여 / 해임 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg" data-tut="set-admin">
                        <label className="font-semibold text-lg text-yellow-400 arcade-font block mb-1">
                            👑 관리자 권한 부여
                        </label>
                        <p className="text-xs text-gray-400 mb-3">
                            이름을 입력하고 <b className="text-yellow-300">부여</b>를 누르면 그 사람이 관리자가 되고,
                            목록의 <b className="text-red-300">✕</b>를 누르면 권한이 해임됩니다. (저장 버튼과 상관없이 바로 적용)
                        </p>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                list="admin-name-suggestions"
                                value={adminInput}
                                onChange={(e) => setAdminInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAdmin(); } }}
                                placeholder="이름 입력 (예: 홍길동)"
                                disabled={isAdminBusy}
                                className="flex-1 min-w-0 bg-gray-800 text-white p-2 rounded-lg border border-gray-600 focus:border-yellow-500 focus:outline-none"
                            />
                            <datalist id="admin-name-suggestions">
                                {rosterNames.map(n => <option key={n} value={n} />)}
                            </datalist>
                            <button
                                type="button"
                                onClick={handleAddAdmin}
                                disabled={isAdminBusy}
                                className="flex-shrink-0 arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-4 rounded-lg disabled:bg-gray-500 disabled:cursor-not-allowed"
                            >
                                부여
                            </button>
                        </div>

                        <div className="mt-3 space-y-1.5">
                            {adminNames.map(name => {
                                const notInRoster = rosterNames.length > 0 && !rosterNames.includes(name);
                                const isSelf = currentUser?.name === name;
                                return (
                                    <div key={name} className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded-lg">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="font-semibold truncate">👑 {name}</span>
                                            {isSelf && <span className="flex-shrink-0 text-[10px] font-bold text-green-300 bg-green-500/15 border border-green-500/40 rounded-full px-2 py-0.5">나</span>}
                                            {notInRoster && <span className="flex-shrink-0 text-[10px] font-bold text-orange-300 bg-orange-500/15 border border-orange-500/40 rounded-full px-2 py-0.5">명단에 없음</span>}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveAdmin(name)}
                                            disabled={isAdminBusy}
                                            title={`${name} 관리자 해임`}
                                            className="flex-shrink-0 ml-2 w-7 h-7 flex items-center justify-center rounded-full bg-red-900/50 hover:bg-red-700 text-red-200 font-bold disabled:opacity-50"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <p className="text-xs text-gray-500 mt-2">
                            · 이름은 <b>입장할 때 쓰는 이름</b>과 정확히 같아야 합니다(띄어쓰기 주의).<br/>
                            · 관리자는 최소 1명이 필요해서 마지막 한 명은 해임할 수 없습니다.
                        </p>
                    </div>

                    {/* --- 일반 설정 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg" data-tut="set-general">
                        <span className="font-semibold mb-2 block text-center">일반 설정</span>
                        <div className="flex items-center justify-around">
                            <div className="text-center">
                                <p>경기 예정 코트 수</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setScheduled(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{scheduled}</span>
                                    <button onClick={() => setScheduled(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                            <div className="text-center">
                                <p>경기 진행 코트 수</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setCourts(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{courts}</span>
                                    <button onClick={() => setCourts(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                   <div className="bg-gray-700 p-3 rounded-lg space-y-3" data-tut="set-notice">
                        <label className="font-semibold block text-center border-b border-gray-600 pb-2">시즌 공지 설정</label>
                   <div className="flex flex-wrap justify-center gap-3 mb-2 text-sm">
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="none" checked={autoMatchConfig.announcementType === 'none'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>없음</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="simple" checked={autoMatchConfig.announcementType === 'simple'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>일반 텍스트</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="text" checked={(autoMatchConfig.announcementType || 'text') === 'text'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>포스터</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="photo" checked={autoMatchConfig.announcementType === 'photo'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>사진 업로드</span>
    </label>
</div>

{autoMatchConfig.announcementType === 'none' ? (
    <div className="text-center text-sm text-gray-400 py-3 bg-gray-800 rounded">
        접속 시 공지사항 창을 띄우지 않고 바로 방으로 입장합니다.
    </div>
) : autoMatchConfig.announcementType === 'photo' ? (
    <div className="space-y-2">
        <input type="file" accept="image/*" onChange={(e) => setAutoMatchConfig(prev => ({...prev, photoFile: e.target.files[0]}))}
            className="w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-yellow-500 file:text-black hover:file:bg-yellow-600" />
        {seasonConfig.announcementPhotoUrl && <p className="text-[10px] text-gray-500 text-center">기존 사진이 등록되어 있습니다. 변경 시 덮어씌워집니다.</p>}
    </div>
) : (
    <div className="space-y-2">
        <textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} rows="3" placeholder="공지 내용을 입력하세요"
            className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400"></textarea>
        <p className="text-[10px] text-center text-gray-500">
            {autoMatchConfig.announcementType === 'simple' ? '입력한 내용이 모달 창에 깔끔한 일반 텍스트 형태로 표시됩니다.' : '입력한 내용이 \'사용자 지정 포스터\' 디자인에 자동으로 삽입됩니다.'}
        </p>
    </div>
)}
                    </div>

                 {/* --- [소모임 연동] 선수 정보 관리 + 정모 동기화 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-3" data-tut="set-somoim">
                        <label className="font-semibold block text-center border-b border-gray-600 pb-2">🏸 소모임 연동</label>

                        <button
                            onClick={onOpenRoster}
                            className="w-full arcade-button bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg"
                        >
                            👥 선수 정보 관리 (명단)
                        </button>

                        <button
                            onClick={onSomoimSync}
                            className="w-full arcade-button bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 rounded-lg"
                        >
                            🔄 소모임 정모 동기화 (참석자 → 선수카드)
                        </button>

                        {/* 마지막 동기화 결과 요약 */}
                        {somoimSync?.lastResult && (
                            <div className="bg-gray-800 rounded-lg p-2.5 text-xs text-gray-300 space-y-1">
                                <p className="text-gray-400">
                                    마지막 동기화: {new Date(somoimSync.lastResult.at).toLocaleString('ko-KR')}
                                    {somoimSync.lastResult.trigger === 'auto' ? ' (자동)' : ' (수동)'}
                                </p>
                                {somoimSync.lastResult.noEvent ? (
                                    <p>당일 정모 없음</p>
                                ) : (
                                    <>
                                        <p>생성 {somoimSync.lastResult.created?.length || 0}명 · 재입장 {somoimSync.lastResult.activated?.length || 0}명 · 이미 입장 {somoimSync.lastResult.already?.length || 0}명</p>
                                        {somoimSync.lastResult.unmatched?.length > 0 && (
                                            <p className="text-yellow-400">⚠ 명단 미등록: {somoimSync.lastResult.unmatched.join(', ')}</p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        {somoimSync?.lastError && (
                            <div className="bg-red-900/40 border border-red-500/40 rounded-lg p-2.5 text-xs text-red-200">
                                ⚠ 마지막 자동 동기화 실패 (오류코드: {somoimSync.lastError.code}) — {new Date(somoimSync.lastError.at).toLocaleString('ko-KR')}
                            </div>
                        )}
                        <p className="text-[10px] text-gray-500 text-center leading-relaxed">
                            정모가 있는 날 <b>오후 6시</b>에 참석 인원의 선수카드가 자동 생성됩니다.<br/>
                            버튼을 누르면 지금 즉시 동기화합니다. (여러 번 눌러도 안전)
                        </p>
                    </div>

                 {/* --- [하루 요약 카드] 오늘의 운동 리포트 공유 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2" data-tut="set-summary">
                        <label className="font-semibold block text-center border-b border-gray-600 pb-2">📸 오늘의 운동 요약</label>
                        <button
                            onClick={() => setShowDailySummary(true)}
                            className="w-full arcade-button bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 rounded-lg"
                        >
                            📸 하루 요약 카드 만들기
                        </button>
                        <p className="text-[10px] text-gray-500 text-center leading-relaxed">
                            오늘 참석 멤버(게스트 포함)·총 경기 수·1인 평균 경기 수를<br/>
                            멋진 카드 한 장으로 만들어 <b>단톡방에 바로 공유</b>합니다.
                        </p>
                    </div>

                 {/* --- 선수 수동 추가 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2" data-tut="set-addplayer">
                        <div
                            className="flex justify-between items-center cursor-pointer"
                            onClick={() => setShowAddPlayerForm(!showAddPlayerForm)}
                        >
                            <label className="font-semibold cursor-pointer">👤 관리자 선수 임의 추가</label>
                            <span className="text-gray-400">{showAddPlayerForm ? '▲' : '▼'}</span>
                        </div>
                        
                        {showAddPlayerForm && (
                            <div className="bg-gray-800 p-3 rounded border border-gray-600 mt-2 space-y-3">
                                <input 
                                    type="text" 
                                    placeholder="이름" 
                                    value={newPlayerForm.name} 
                                    onChange={(e) => setNewPlayerForm(prev => ({...prev, name: e.target.value}))} 
                                    className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm" 
                                />
                                <div className="grid grid-cols-4 gap-1">
                                    {['A조', 'B조', 'C조', 'D조'].map(level => (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => setNewPlayerForm(prev => ({ ...prev, level }))}
                                            className={`py-1 rounded text-xs font-bold transition-colors arcade-button ${newPlayerForm.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex justify-around items-center text-sm bg-gray-600 p-2 rounded-md">
                                    <label className="flex items-center cursor-pointer">
                                        <input type="radio" name="newPlayerGender" value="남" checked={newPlayerForm.gender === '남'} onChange={() => setNewPlayerForm(prev => ({...prev, gender: '남'}))} className="mr-1 h-3 w-3 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자
                                    </label>
                                    <label className="flex items-center cursor-pointer">
                                        <input type="radio" name="newPlayerGender" value="여" checked={newPlayerForm.gender === '여'} onChange={() => setNewPlayerForm(prev => ({...prev, gender: '여'}))} className="mr-1 h-3 w-3 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자
                                    </label>
                                    <div className="w-px h-4 bg-gray-500"></div>
                                    <label className="flex items-center cursor-pointer">
                                        <input type="checkbox" checked={newPlayerForm.isGuest} onChange={(e) => setNewPlayerForm(prev => ({...prev, isGuest: e.target.checked}))} className="mr-1 h-3 w-3 rounded text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" /> 게스트
                                    </label>
                                </div>
                                <button
                                    onClick={() => {
                                        onAdminAddPlayer(newPlayerForm);
                                        setNewPlayerForm({ name: '', level: 'A조', gender: '남', isGuest: false });
                                        setShowAddPlayerForm(false);
                                    }}
                                    className="w-full arcade-button bg-green-600 hover:bg-green-700 text-white font-bold py-1.5 rounded text-sm"
                                >
                                    추가하기
                                </button>
                            </div>
                        )}
                    </div>

                  {/* --- 고급 기능 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2" data-tut="set-advanced">
                        <label className="font-semibold mb-2 block text-center">고급 기능</label>
                        
                        {/* 테스트 로봇 생성 섹션 */}
                        <div className="bg-gray-800 p-2 rounded border border-gray-600 mb-4">
                            <p className="text-sm font-semibold text-center mb-2 text-cyan-400">🤖 테스트 로봇 생성 (개발용)</p>
                            <div className="flex justify-around gap-2 mb-2">
                                <div className="flex-1 text-center">
                                    <label className="block text-xs mb-1 text-gray-400">👨 남자 수</label>
                                    <input 
                                        type="number" min="0" 
                                        value={robotMaleCount} 
                                        onChange={(e) => setRobotMaleCount(Number(e.target.value))} 
                                        className="w-full bg-gray-600 p-1.5 rounded text-center text-white text-sm" 
                                    />
                                </div>
                                <div className="flex-1 text-center">
                                    <label className="block text-xs mb-1 text-gray-400">👩 여자 수</label>
                                    <input 
                                        type="number" min="0" 
                                        value={robotFemaleCount} 
                                        onChange={(e) => setRobotFemaleCount(Number(e.target.value))} 
                                        className="w-full bg-gray-600 p-1.5 rounded text-center text-white text-sm" 
                                    />
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    onGenerateRobots(robotMaleCount, robotFemaleCount);
                                    setRobotMaleCount(0);
                                    setRobotFemaleCount(0);
                                }}
                                className="w-full arcade-button bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={robotMaleCount === 0 && robotFemaleCount === 0}
                            >
                                로봇 생성하기
                            </button>
                        </div>

                         <button
                            onClick={onSystemReset}
                            className="w-full arcade-button bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-lg disabled:opacity-50 mb-2"
                        >
                            모두 대기로 이동
                        </button>
                        <button
                            onClick={onClearPlayerHistory}
                            className="w-full arcade-button bg-red-800 hover:bg-red-900 text-white font-bold py-2 rounded-lg disabled:opacity-50"
                        >
                            선수 히스토리 삭제
                        </button>
                    </div>
                </div>
                <div className="mt-6 flex gap-4 flex-shrink-0" data-tut="set-save">
                     <button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 font-bold py-2 rounded-lg">취소</button>
                    <button onClick={handleSave} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">저장</button>
                </div>
            </div>

            {/* [자동매칭] 사용설명서 모달 */}
            {showAutoGuide && <AutoMatchGuideModal onClose={() => setShowAutoGuide(false)} />}

            {/* [하루 요약 카드] 미리보기/공유 모달 */}
            {showDailySummary && <DailySummaryModal allPlayers={allPlayers} onClose={() => setShowDailySummary(false)} />}
        </div>
    );
}

// [자동매칭] 초보 관리자용 사용설명서 — 짧고 핵심만
function AutoMatchGuideModal({ onClose }) {
    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-2xl w-full max-w-md text-white shadow-[0_0_24px_rgba(34,197,94,0.25)] border border-green-500/30 flex flex-col"
                style={{ maxHeight: '88vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-5 pb-3 flex-shrink-0 border-b border-gray-700">
                    <h3 className="text-lg font-bold text-green-400 arcade-font">🤖 자동 매칭 사용설명서</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>

                <div className="p-5 pt-4 space-y-4 text-sm overflow-y-auto">
                    <div>
                        <p className="font-bold text-green-300 mb-1">① 자동 매칭이 뭔가요?</p>
                        <p className="text-gray-300 leading-relaxed">대기 중인 선수를 시스템이 알아서 <b>4명</b> 골라 <b>'🤖 자동 매칭'</b> 칸에 올려줍니다. 관리자는 <b>START</b>만 누르면 경기가 시작돼요.</p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">② 어떤 기준으로 짜나요?</p>
                        <p className="text-gray-300 leading-relaxed">
                            <b>1순위</b> 적게 치거나 오래 기다린 사람 먼저<br/>
                            <b>2순위</b> 그 안에서 최대한 <b>안 친 사람</b>끼리<br/>
                            <b>3순위</b> 양 팀 <b>급수</b>도 최대한 맞춰서
                        </p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">③ 만드는 법</p>
                        <p className="text-gray-300 leading-relaxed">
                            메인 화면 '🤖 자동 매칭'의 <b className="text-blue-300">👨 남자</b> / <b className="text-pink-300">👩 여자</b> / <b className="text-purple-300">💑 혼복</b> 매칭 만들기를 누르면
                            <b> 누를 때마다 한 경기</b>가 만들어집니다. 두 경기가 필요하면 두 번 누르면 돼요.
                            <br/>혼복은 <b>남2+여2</b>를 뽑아 <b>남1+여1 팀</b>으로 자동 배치합니다.
                        </p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">④ "매칭 난이도를 낮춰주세요"가 뜨면?</p>
                        <p className="text-gray-300 leading-relaxed">
                            지금 만들 수 있는 조합이 전부 <b>기준 점수</b>에 못 미친다는 뜻입니다(예: 방금 같이 친 사람끼리만 남음).
                            아래 <b>매칭 민감도</b>를 한 단계 낮추거나(예: 높음 → 보통), 경기가 끝나 대기 선수가 늘어난 뒤 다시 눌러주세요.
                        </p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">⑤ 민감도 고르기</p>
                        <ul className="text-gray-300 leading-relaxed space-y-1">
                            {AUTO_MATCH_SENSITIVITIES.map(s => (
                                <li key={s.key}><b className="text-white">{s.label}</b> — {s.short}: <span className="text-gray-400">{s.desc}</span></li>
                            ))}
                        </ul>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/25 rounded-lg p-3">
                        <p className="font-bold text-green-300 mb-1">💡 한 줄 팁</p>
                        <p className="text-gray-300 leading-relaxed">사람이 <b>적으면 낮음~보통</b>, <b>많으면 높음~최고</b>. 고민되면 그냥 <b>보통</b>으로 두세요. 인원에 맞춰 깐깐함은 자동으로 조절됩니다.</p>
                    </div>
                </div>

                <div className="p-4 flex-shrink-0 border-t border-gray-700">
                    <button onClick={onClose} className="w-full arcade-button bg-green-500 hover:bg-green-600 text-black font-bold py-2.5 rounded-lg">확인했어요</button>
                </div>
            </div>
        </div>
    );
}


function DailySummaryModal({ allPlayers, onClose }) {
    const [imgUrl, setImgUrl] = useState(null);
    const [blob, setBlob] = useState(null);
    const [shareMsg, setShareMsg] = useState(null);
    const summary = useMemo(() => computeDailySummary(allPlayers), [allPlayers]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl = null;
        (async () => {
            // 캔버스에서 웹폰트가 바로 나오도록 로드를 기다린다
            try {
                await Promise.all([
                    document.fonts.load('900 104px "Noto Sans KR"'),
                    document.fonts.load('700 30px "Noto Sans KR"'),
                    document.fonts.load('400 34px "Anton"'),
                ]);
            } catch (e) { /* 폰트 실패해도 시스템 폰트로 그린다 */ }
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
        // 폰 공유 시트(카카오톡 선택 가능) — 미지원 환경은 저장 폴백
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: '콕스라이팅 오늘의 운동',
                    text: `🏸 콕스라이팅 오늘의 운동 — 참석 ${summary.attendees.length}명 · 총 ${summary.totalGames}경기`,
                });
            } catch (e) {
                if (e && e.name !== 'AbortError') handleDownload();
            }
            return;
        }
        handleDownload();
    };

    return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[70] p-4" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-2xl w-full max-w-md text-white shadow-lg flex flex-col"
                style={{ maxHeight: '92vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-4 pb-3 flex-shrink-0 border-b border-gray-700">
                    <h3 className="text-lg font-bold text-yellow-400 arcade-font">📸 하루 요약 카드</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>

                <div className="flex-grow overflow-y-auto p-4">
                    {!imgUrl ? (
                        <div className="text-center text-gray-400 py-16">카드를 만들고 있어요...</div>
                    ) : (
                        <img src={imgUrl} alt="오늘의 운동 요약 카드" className="w-full rounded-xl shadow-2xl" />
                    )}
                    {shareMsg && (
                        <p className="text-center text-xs text-green-300 mt-3 whitespace-pre-line">{shareMsg}</p>
                    )}
                </div>

                <div className="p-4 flex flex-col gap-2 flex-shrink-0 border-t border-gray-700">
                    <button
                        onClick={handleShare}
                        disabled={!blob}
                        className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg disabled:opacity-50"
                    >
                        📤 단톡방에 공유하기
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={!blob}
                        className="w-full arcade-button bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 rounded-lg text-sm disabled:opacity-50"
                    >
                        💾 이미지로 저장
                    </button>
                </div>
            </div>
        </div>
    );
}


export { SettingsModal };