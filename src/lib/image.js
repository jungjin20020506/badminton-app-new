// ===================================================================================
// [이미지] 업로드 전에 브라우저에서 줄인다 (공지 사진)
// -----------------------------------------------------------------------------------
// 폰 카메라 원본(4000px, 5MB)을 그대로 올리면 Storage 용량과 모든 회원의 데이터가
// 낭비된다. 긴 변 1600px, JPEG 품질 0.85로 줄이면 보통 200~400KB가 된다.
// 줄이지 못하는 환경(지원 안 되는 형식 등)에서는 원본을 그대로 돌려준다.
// ===================================================================================
import { log } from './logger';

const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = src;
});

/**
 * @param {File} file
 * @param {{maxEdge?: number, quality?: number, type?: string}} [opts]
 * @returns {Promise<File>} 줄인 파일 (실패 시 원본)
 */
export async function resizeImageFile(file, { maxEdge = 1600, quality = 0.85, type = 'image/jpeg' } = {}) {
    if (!file || !file.type?.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file; // 움직이는 그림은 건드리지 않는다
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && file.size < 600 * 1024) return file; // 이미 작으면 그대로
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
        if (!blob) return file;
        const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.webp');
        const out = new File([blob], name, { type });
        log.info(`[이미지] ${Math.round(file.size / 1024)}KB → ${Math.round(out.size / 1024)}KB (${w}×${h})`);
        return out.size < file.size ? out : file;
    } catch (e) {
        log.warn('[이미지] 리사이즈 실패, 원본 업로드', e);
        return file;
    } finally {
        URL.revokeObjectURL(url);
    }
}
