import { App, normalizePath } from 'obsidian';
import { BlogConfig } from './settings/types';

/**
 * blog.attachmentFolderMode가 'custom'이면 항상, 'default'면 Obsidian 전역 "새 첨부파일 기본 위치"
 * 설정이 고정된 절대 경로를 가리킬 때만 하나의 폴더 경로를 돌려준다. vault 루트("")나 "현재 파일과
 * 같은 폴더/그 하위 폴더"(".", "./name")처럼 노트마다 결과가 달라지는 경우는 null —
 * 이 경우 pull 다운로드는 그때그때(app.fileManager.getAvailablePathForAttachment로) 정해지고,
 * 폴더 변경 시 자동 이동 대상도 특정할 수 없으므로 마이그레이션 제안에서 제외한다.
 */
export function resolveFixedAttachmentDir(app: App, blog: BlogConfig): string | null {
	if (blog.attachmentFolderMode === 'custom') {
		const root = blog.rootFolder.replace(/\/+$/, '');
		return normalizePath(`${root}/${blog.attachmentFolder || 'attachments'}`);
	}
	const vaultConfig = app.vault as unknown as { getConfig(key: string): unknown };
	const obsidianPath = (vaultConfig.getConfig('attachmentFolderPath') as string | undefined) ?? '';
	if (!obsidianPath || obsidianPath === '/' || obsidianPath === '.' || obsidianPath.startsWith('./')) {
		return null;
	}
	return normalizePath(obsidianPath);
}
