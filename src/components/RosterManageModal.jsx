import React, { useState, useMemo } from 'react';
import { doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, rosterRef, ROSTER_SEED } from '../lib/firebase';
import { generateId, getLevelColor } from '../lib/helpers';

// ===================================================================================
// [선수 명단] 선수 정보 관리 모달 — 관리자 설정 > 선수 정보 관리
// 명단(이름/급수/성별) 조회·검색·추가·수정·삭제. 소모임 연동(mid) 상태도 표시.
// ===================================================================================
function RosterManageModal({ roster, onClose, setModal }) {
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ level: 'A조', gender: '남' });
    const [showAddForm, setShowAddForm] = useState(false);
    const [addForm, setAddForm] = useState({ name: '', level: 'A조', gender: '남' });
    const [isBusy, setIsBusy] = useState(false);

    const rosterList = useMemo(() =>
        // 문서에 id 필드가 없어도 문서 키를 id로 보정해 수정/삭제가 항상 동작하게 한다
        Object.entries(roster || {}).map(([docId, r]) => ({ ...r, id: r.id || docId }))
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')),
    [roster]);

    const filtered = useMemo(() =>
        search.trim() ? rosterList.filter(r => (r.name || '').includes(search.trim())) : rosterList,
    [rosterList, search]);

    const showError = (body) => setModal({ type: 'alert', data: { title: '오류', body } });

    // 기본 명단(사진 명단) 등록 — 이미 있는 이름은 건드리지 않는 비파괴 병합
    const handleSeed = async () => {
        setIsBusy(true);
        try {
            const existingNames = new Set(rosterList.map(r => r.name));
            const toAdd = ROSTER_SEED.filter(s => !existingNames.has(s.name));
            if (toAdd.length === 0) {
                setModal({ type: 'alert', data: { title: '안내', body: '기본 명단의 선수들이 이미 모두 등록되어 있습니다.' } });
                return;
            }
            const batch = writeBatch(db);
            toAdd.forEach(s => {
                const id = generateId(s.name);
                batch.set(doc(rosterRef, id), {
                    id, name: s.name, level: s.level, gender: s.gender,
                    somoimMid: null, createdAt: new Date().toISOString(),
                }, { merge: true });
            });
            await batch.commit();
            setModal({ type: 'alert', data: {
                title: '등록 완료',
                body: `기본 명단 ${toAdd.length}명이 등록되었습니다.\n\n⚠ 성별은 이름으로 추정한 값입니다. 목록을 확인하고 잘못된 선수는 수정해주세요.`,
            }});
        } catch (e) {
            console.error('명단 기본 등록 실패:', e);
            showError('기본 명단 등록에 실패했습니다.');
        } finally {
            setIsBusy(false);
        }
    };

    const handleAdd = async () => {
        const name = (addForm.name || '').trim();
        if (!name) { showError('이름을 입력해주세요.'); return; }
        if (rosterList.some(r => r.name === name)) { showError('이미 명단에 있는 이름입니다.'); return; }
        setIsBusy(true);
        try {
            const id = generateId(name);
            await setDoc(doc(rosterRef, id), {
                id, name, level: addForm.level, gender: addForm.gender,
                somoimMid: null, createdAt: new Date().toISOString(),
            }, { merge: true });
            setAddForm({ name: '', level: 'A조', gender: '남' });
            setShowAddForm(false);
        } catch (e) {
            console.error('명단 추가 실패:', e);
            showError('선수 추가에 실패했습니다.');
        } finally {
            setIsBusy(false);
        }
    };

    const handleEditSave = async (entry) => {
        setIsBusy(true);
        try {
            await setDoc(doc(rosterRef, entry.id), {
                level: editForm.level, gender: editForm.gender,
                updatedAt: new Date().toISOString(),
            }, { merge: true });
            setEditingId(null);
        } catch (e) {
            console.error('명단 수정 실패:', e);
            showError('선수 정보 수정에 실패했습니다.');
        } finally {
            setIsBusy(false);
        }
    };

    const handleDelete = (entry) => {
        setModal({ type: 'confirm', data: {
            title: '명단에서 삭제',
            body: `${entry.name} 선수를 명단에서 삭제할까요?\n(삭제하면 일반 입장 및 소모임 동기화가 되지 않습니다)`,
            onConfirm: async () => {
                try {
                    await deleteDoc(doc(rosterRef, entry.id));
                } catch (e) {
                    console.error('명단 삭제 실패:', e);
                    showError('삭제에 실패했습니다.');
                }
                setModal({ type: null, data: null });
            }
        }});
    };

    const LevelPicker = ({ value, onChange }) => (
        <div className="grid grid-cols-4 gap-1">
            {['A조', 'B조', 'C조', 'D조'].map(level => (
                <button key={level} type="button" onClick={() => onChange(level)}
                    className={`py-1 rounded text-xs font-bold arcade-button ${value === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}>
                    {level}
                </button>
            ))}
        </div>
    );
    const GenderPicker = ({ value, onChange }) => (
        <div className="flex gap-2">
            {['남', '여'].map(g => (
                <button key={g} type="button" onClick={() => onChange(g)}
                    className={`flex-1 py-1 rounded text-xs font-bold arcade-button ${value === g ? (g === '남' ? 'bg-blue-500 text-white' : 'bg-pink-500 text-white') : 'bg-gray-600 text-white'}`}>
                    {g === '남' ? '👨 남자' : '👩 여자'}
                </button>
            ))}
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[70] p-4">
            <div className="bg-gray-800 rounded-lg p-5 w-full max-w-md text-white shadow-lg flex flex-col" style={{ maxHeight: '90vh' }} data-tut="roster">
                <div className="flex justify-between items-center mb-3 flex-shrink-0">
                    <h3 className="text-lg font-bold text-yellow-400 arcade-font">👥 선수 정보 관리</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>

                <div className="flex gap-2 mb-3 flex-shrink-0">
                    <input
                        type="text" placeholder="이름 검색" value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="flex-1 bg-gray-700 text-white p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                    <button onClick={() => setShowAddForm(v => !v)}
                        className="arcade-button bg-green-600 hover:bg-green-700 text-white font-bold px-3 rounded-lg text-sm flex-shrink-0">
                        {showAddForm ? '닫기' : '+ 추가'}
                    </button>
                </div>

                {showAddForm && (
                    <div className="bg-gray-700 rounded-lg p-3 mb-3 space-y-2 flex-shrink-0">
                        <input type="text" placeholder="이름" value={addForm.name}
                            onChange={(e) => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full bg-gray-600 text-white p-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                        <LevelPicker value={addForm.level} onChange={(level) => setAddForm(prev => ({ ...prev, level }))} />
                        <GenderPicker value={addForm.gender} onChange={(gender) => setAddForm(prev => ({ ...prev, gender }))} />
                        <button onClick={handleAdd} disabled={isBusy}
                            className="w-full arcade-button bg-green-600 hover:bg-green-700 text-white font-bold py-1.5 rounded text-sm disabled:opacity-50">
                            명단에 추가
                        </button>
                    </div>
                )}

                <p className="text-[10px] text-gray-500 mb-2 flex-shrink-0 text-center">
                    총 {rosterList.length}명 · 🔗 = 소모임 계정 연동됨 · 이름을 누르면 수정할 수 있습니다
                </p>

                <div className="flex-grow overflow-y-auto space-y-1 pr-1">
                    {rosterList.length === 0 && (
                        <div className="text-center py-6 space-y-3">
                            <p className="text-gray-400 text-sm">등록된 선수 명단이 없습니다.</p>
                            <button onClick={handleSeed} disabled={isBusy}
                                className="arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                                📋 기본 명단 {ROSTER_SEED.length}명 등록하기
                            </button>
                            <p className="text-[10px] text-gray-500">모임 명단 사진 기준 (성별은 추정값이므로 등록 후 확인 필요)</p>
                        </div>
                    )}
                    {filtered.map(entry => (
                        <div key={entry.id} className="bg-gray-700/60 rounded-lg">
                            <div
                                className="flex items-center justify-between px-3 py-2 cursor-pointer"
                                onClick={() => {
                                    if (editingId === entry.id) { setEditingId(null); return; }
                                    setEditingId(entry.id);
                                    setEditForm({ level: entry.level || 'A조', gender: entry.gender || '남' });
                                }}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-bold text-sm truncate">{entry.name}</span>
                                    {entry.somoimMid && <span title="소모임 계정 연동됨" className="text-xs">🔗</span>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-xs font-bold" style={{ color: getLevelColor(entry.level, false) }}>{entry.level}</span>
                                    <span className={`text-xs font-bold ${entry.gender === '남' ? 'text-blue-400' : 'text-pink-400'}`}>{entry.gender}</span>
                                    <span className="text-gray-500 text-xs">{editingId === entry.id ? '▲' : '▼'}</span>
                                </div>
                            </div>
                            {editingId === entry.id && (
                                <div className="px-3 pb-3 space-y-2 border-t border-gray-600 pt-2">
                                    <LevelPicker value={editForm.level} onChange={(level) => setEditForm(prev => ({ ...prev, level }))} />
                                    <GenderPicker value={editForm.gender} onChange={(gender) => setEditForm(prev => ({ ...prev, gender }))} />
                                    <div className="flex gap-2">
                                        <button onClick={() => handleDelete(entry)}
                                            className="arcade-button bg-red-900/60 hover:bg-red-800 text-red-300 font-bold py-1.5 px-3 rounded text-xs">
                                            삭제
                                        </button>
                                        <button onClick={() => handleEditSave(entry)} disabled={isBusy}
                                            className="flex-1 arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-1.5 rounded text-xs disabled:opacity-50">
                                            저장
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {rosterList.length > 0 && filtered.length === 0 && (
                        <p className="text-center text-gray-500 text-sm py-4">검색 결과가 없습니다.</p>
                    )}
                </div>

                <button onClick={onClose} className="mt-4 w-full arcade-button bg-gray-600 hover:bg-gray-700 font-bold py-2 rounded-lg flex-shrink-0">닫기</button>
            </div>
        </div>
    );
}


export { RosterManageModal };