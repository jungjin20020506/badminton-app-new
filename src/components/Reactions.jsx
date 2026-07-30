import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendLiveReaction } from '../lib/firebase';
import { playReaction } from '../lib/sound';

// ===================================================================================
// [라이브 리액션] 👏 🔥 💪 — 누르면 모두의 화면에서 이모지가 떠오른다
// -----------------------------------------------------------------------------------
// · 보내기: config/liveReactions 문서를 덮어쓰는 브로드캐스트 (연타 방지 1.2초)
// · 받기: App이 넘겨주는 liveReaction(스냅샷)에서 nonce가 새것일 때만 파티클 생성
// · 내가 보낸 것은 즉시 로컬 재생하고, 스냅샷 회신은 nonce로 걸러 중복 재생 방지
// ===================================================================================

const REACTION_EMOJIS = ['👏', '🔥', '💪'];
const PARTICLE_LIFE_MS = 2600;

export function ReactionLayer({ liveReaction, myName }) {
    const [particles, setParticles] = useState([]);
    const seenNonceRef = useRef(new Set());
    const [cooldown, setCooldown] = useState(false);

    // 파티클 생성 (좌우 무작위 흩날림)
    const spawn = useCallback((emoji, name) => {
        const id = Math.random().toString(36).slice(2);
        const particle = {
            id, emoji, name,
            x: 12 + Math.random() * 60,          // 화면 가로 위치(%)
            drift: (Math.random() - 0.5) * 90,   // 좌우 흔들림(px)
            scale: 0.9 + Math.random() * 0.5,
        };
        setParticles(list => [...list.slice(-11), particle]); // 최대 12개 유지
        setTimeout(() => {
            setParticles(list => list.filter(p => p.id !== id));
        }, PARTICLE_LIFE_MS);
        playReaction();
    }, []);

    // 다른 사람(또는 다른 기기)의 리액션 수신
    useEffect(() => {
        if (!liveReaction || !liveReaction.nonce) return;
        if (seenNonceRef.current.has(liveReaction.nonce)) return;
        seenNonceRef.current.add(liveReaction.nonce);
        // 접속 시점에 남아 있던 오래된 리액션은 재생하지 않는다
        if (typeof liveReaction.at === 'number' && Date.now() - liveReaction.at > 12 * 1000) return;
        spawn(liveReaction.emoji, liveReaction.name);
    }, [liveReaction, spawn]);

    const handleSend = (emoji) => {
        if (cooldown) return;
        setCooldown(true);
        setTimeout(() => setCooldown(false), 1200);
        const nonce = Math.random().toString(36).slice(2);
        seenNonceRef.current.add(nonce); // 내 스냅샷 회신은 재생하지 않음
        spawn(emoji, myName);            // 나는 즉시 재생 (낙관적)
        sendLiveReaction(emoji, myName, nonce).catch((e) => console.error('[리액션] 전송 실패:', e));
    };

    return (
        <>
            {/* 떠오르는 이모지 레이어 */}
            <div className="rx-layer" aria-hidden="true">
                {particles.map(p => (
                    <div
                        key={p.id}
                        className="rx-particle"
                        style={{
                            left: `${p.x}%`,
                            '--rx-drift': `${p.drift}px`,
                            '--rx-scale': p.scale,
                        }}
                    >
                        <span className="rx-emoji">{p.emoji}</span>
                        {p.name && <span className="rx-name">{p.name}</span>}
                    </div>
                ))}
            </div>

            {/* 리액션 독 (보내기 버튼) */}
            <div className={`rx-dock ${cooldown ? 'cooldown' : ''}`}>
                {REACTION_EMOJIS.map(e => (
                    <button key={e} type="button" className="rx-btn" onClick={() => handleSend(e)} aria-label={`${e} 리액션 보내기`}>
                        {e}
                    </button>
                ))}
            </div>
        </>
    );
}
