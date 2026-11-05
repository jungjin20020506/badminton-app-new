import React from 'react';
import { log, formatLogEntry } from '../lib/logger';
import { captureError } from '../lib/monitoring';
import { formatBuild } from '../lib/appUpdate';

// ===================================================================================
// [오류 경계] 렌더링 중 예외가 나면 흰 화면 대신 복구 화면을 보여준다
// -----------------------------------------------------------------------------------
//  · "새로고침" 한 번으로 대부분 복구된다 (로그인은 localStorage 에 있어 유지)
//  · "오류 내용 복사"로 관리자가 개발자에게 바로 전달할 수 있다 (직전 로그 포함)
//  · 예외는 로거와 모니터링(Sentry, 설정된 경우)으로 보낸다
// 함수 컴포넌트로는 만들 수 없는 React 기능이라 클래스 컴포넌트다.
// ===================================================================================
export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null, copied: false };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        log.error('[화면 오류]', error, info?.componentStack);
        captureError(error, { componentStack: info?.componentStack });
    }

    handleReload = () => {
        window.location.reload();
    };

    handleCopy = async () => {
        const { error } = this.state;
        const text = [
            `COCKSLIGHTING 오류 보고 · 버전 ${formatBuild()}`,
            `시각: ${new Date().toISOString()}`,
            `기기: ${navigator.userAgent}`,
            '',
            `${error?.name || 'Error'}: ${error?.message || ''}`,
            error?.stack || '',
            '',
            '--- 직전 로그 ---',
            ...log.recent().slice(-25).map(formatLogEntry),
        ].join('\n');
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else window.prompt('아래 내용을 복사해 주세요', text);
            this.setState({ copied: true });
        } catch {
            window.prompt('아래 내용을 복사해 주세요', text);
        }
    };

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="cox-error-screen" role="alert">
                <div className="cox-error-card">
                    <div className="cox-error-emoji" aria-hidden="true">🏸💥</div>
                    <h1 className="cox-error-title">앗, 화면에 문제가 생겼어요</h1>
                    <p className="cox-error-desc">
                        데이터는 안전하게 서버에 있어요.<br />
                        새로고침하면 대부분 바로 해결됩니다.
                    </p>
                    <button type="button" className="cox-error-btn primary" onClick={this.handleReload}>
                        🔄 새로고침
                    </button>
                    <button type="button" className="cox-error-btn ghost" onClick={this.handleCopy}>
                        {this.state.copied ? '✅ 복사됐어요 — 관리자에게 보내주세요' : '📋 오류 내용 복사'}
                    </button>
                    <p className="cox-error-meta">
                        {this.state.error?.message ? `오류: ${String(this.state.error.message).slice(0, 120)}` : ''}
                    </p>
                </div>
            </div>
        );
    }
}
