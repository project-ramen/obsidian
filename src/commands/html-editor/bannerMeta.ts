import { App, TFile, normalizePath } from 'obsidian';

const WIKILINK_RE = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/;
const MD_IMAGE_RE = /^!\[[^\]]*\]\(([^)\s]+)\)$/;

/**
 * frontmatter의 banner 값(위키링크 `[[img.png]]`/`![[img.png]]`, 표준 `![alt](경로)`, 이미 서버에
 * 업로드된 외부 URL/절대경로)을 <img src>로 바로 쓸 수 있는 값으로 변환. resolveBannerImage(sync.ts)와
 * 같은 형식을 인식하되, 저건 "서버 업로드용 URL 변환"이고 이건 "에디터 미리보기용 표시"라 용도가 달라
 * 별도로 둠 — 로컬 vault 파일이면 리소스 경로로, 못 찾으면 null.
 */
export function resolveBannerSrc(app: App, sourcePath: string, raw: string | undefined | null): string | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('/')) return trimmed;
	const linkPath = trimmed.match(WIKILINK_RE)?.[1] ?? trimmed.match(MD_IMAGE_RE)?.[1];
	if (!linkPath) return null;
	const resolved = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(linkPath), sourcePath);
	return resolved instanceof TFile ? app.vault.getResourcePath(resolved) : null;
}

/**
 * 로컬에서 고른 이미지 파일을 Obsidian의 "새 첨부파일 기본 위치" 설정을 따라 vault에 저장하고,
 * frontmatter banner 값으로 바로 쓸 수 있는 위키링크 문자열을 반환.
 */
export async function attachBannerImage(app: App, sourcePath: string, file: File): Promise<string> {
	const buf = await file.arrayBuffer();
	const availablePath = await app.fileManager.getAvailablePathForAttachment(file.name, sourcePath);
	const saved = await app.vault.createBinary(normalizePath(availablePath), buf);
	return `[[${saved.name}]]`;
}
