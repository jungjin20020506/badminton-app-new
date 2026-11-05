import React from 'react';
import { ModalShell } from './ModalShell';

/** [소모임 동기화] 수동 동기화 결과 */
export function SomoimSyncResultModal({ result, onClose }) {
    return (
        <ModalShell
            title="🔄 동기화 완료"
            titleClass="display accent"
            onClose={onClose}
            zIndex={80}
            footer={<button type="button" className="cox-btn primary" onClick={onClose} data-autofocus>확인</button>}
        >
            <div className="space-y-3 text-sm">
                {result.noEvent ? (
                    <p className="text-center text-gray-300 py-4">
                        오늘 날짜의 소모임 정모가 없습니다.<br />
                        <span className="text-xs text-gray-500">(정모가 등록된 날에만 선수카드가 생성됩니다)</span>
                    </p>
                ) : (
                    <>
                        {result.events?.length > 0 && (
                            <div className="cox-box soft">
                                <p className="text-xs text-gray-400 mb-1">오늘 정모</p>
                                {result.events.map((ev, i) => <p key={i} className="font-bold text-yellow-300 text-xs">{ev.name}</p>)}
                            </div>
                        )}
                        <div className="cox-box soft space-y-1.5">
                            <p>✅ 새로 입장: <b className="text-green-400">{result.created.length}명</b>
                                {result.created.length > 0 && <span className="text-xs text-gray-400 block">{result.created.join(', ')}</span>}
                            </p>
                            <p>♻️ 재입장 처리: <b className="text-teal-300">{result.activated.length}명</b>
                                {result.activated.length > 0 && <span className="text-xs text-gray-400 block">{result.activated.join(', ')}</span>}
                            </p>
                            <p>👍 이미 입장 중: <b className="text-gray-300">{result.already.length}명</b>
                                {result.already.length > 0 && <span className="text-xs text-gray-400 block">{result.already.join(', ')}</span>}
                            </p>
                        </div>
                        {result.unmatched.length > 0 && (
                            <div className="cox-box warn">
                                <p className="font-bold text-xs mb-1">⚠ 명단에 없어 카드가 생성되지 않은 참석자 ({result.unmatched.length}명)</p>
                                <p className="text-xs">{result.unmatched.join(', ')}</p>
                                <p className="text-[10px] opacity-80 mt-1.5">관리자 설정 → 선수 정보 관리에서 이 선수들을 추가한 뒤 다시 동기화해주세요.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </ModalShell>
    );
}
