import { App, Notice, TFile, TFolder, normalizePath, requestUrl } from 'obsidian';
import { BlogConfig } from './settings/types';
import { resolveFixedAttachmentDir } from './attachmentFolder';
import { unwrapHtmlModeBody, wrapHtmlModeBody } from './commands/html-editor/htmlDocParts';
import { Locale, t } from './i18n';
import { debugLog } from './logger';

export interface PostDoc {
	id: string;
	slug: string;
	title: string;
	body_md: string;
	published: number;
	tags: string;
	category: string;
	banner?: string | null;
	banner_url?: string | null;
	description?: string | null;
	/** true(1)면 body_md를 마크다운 대신 raw HTML로 그대로 표시 (frontmatter html_mode) */
	html_mode?: number;
	deleted_at: string | null;
	created_at: string;
	updated_at: string;
}

const CHECKPOINT_PREFIX = 'ramen-sync-checkpoint-';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
};
/** 이미지 내용 해시(blogId:sha256) → 업로드된 서버 URL 캐시(메모리, 세션 내 재해시 방지용). 영속 캐시는 uploadedHashKey 참고. */
const uploadedImageCache = new Map<string, string>();
const STANDARD_IMAGE_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
/** raw HTML <img src="..."> — width/style 같은 마크다운으로 못 넣는 속성 쓰려고 직접 HTML을 섞어 쓰는 경우.
 *  그룹: 1=<img ...src= 까지, 2=따옴표, 3=src 값, 4=나머지(>까지) — src 값만 바꿔치기하고 다른 속성은 그대로 둠. */
const HTML_IMG_SRC_RE = /(<img\b[^>]*\bsrc=)(["'])([^"']+)\2([^>]*>)/gi;

/** ArrayBuffer의 SHA-256 hex digest. 같은 내용이면 파일 경로·이름·mtime이 달라도 같은 값이 나옴 —
 *  "같은 이미지가 여러 번 업로드되는" 문제를 파일 메타데이터가 아니라 실제 바이트 내용 기준으로 막기 위함. */
async function hashArrayBuffer(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** blogId:filePath → pushFileLive가 마지막으로 보낸 updated_at. 이후 sync가 같은 문서를 pull해오면
 *  (서버가 우리가 방금 보낸 그 push를 그대로 되돌려준 echo) 로컬 파일을 덮어쓰지 않도록 구분하는 용도.
 *  이게 없으면 banner의 원본 [[link.png]] 위키링크가 서버에 업로드된 URL로 되돌아와 파일을 덮어써버림. */
const lastLivePushedAt = new Map<string, string>();

// 서버 업로드 URL → 업로드 당시 원본 파일명. 서버가 파일을 uuid로 저장해버려서(server/src/api.ts 업로드 엔드포인트)
// URL만으로는 원본 이름을 알 수 없음 — pull 시 이 매핑으로 파일명을 원복. localStorage에 저장해 플러그인 재시작 후에도 유지.
function uploadedFilenameKey(blogId: string, url: string): string {
	return `ramen-uploaded-filename-${blogId}:${url}`;
}
function rememberUploadedFilename(blogId: string, url: string, filename: string): void {
	try {
		localStorage.setItem(uploadedFilenameKey(blogId, url), filename);
	} catch (e) {
		debugLog(`[ramen] 업로드 파일명 기억 실패 (무해함, URL에서 유추한 이름으로 대체됨): ${url}`, e);
	}
}
function recallUploadedFilename(blogId: string, url: string): string | null {
	try {
		return localStorage.getItem(uploadedFilenameKey(blogId, url));
	} catch {
		return null;
	}
}

// 이미지 내용 해시 → 업로드된 서버 URL. localStorage에 저장해 플러그인 재시작 후에도 유지 —
// 이게 없으면 재시작할 때마다 내용이 안 바뀐 이미지도 매번 새로 업로드돼서 서버에 중복 파일이 쌓임.
function uploadedHashKey(blogId: string, hash: string): string {
	return `ramen-uploaded-hash-${blogId}:${hash}`;
}
function rememberUploadedUrlByHash(blogId: string, hash: string, url: string): void {
	try {
		localStorage.setItem(uploadedHashKey(blogId, hash), url);
	} catch (e) {
		debugLog(`[ramen] 업로드 해시 기억 실패 (무해함, 다음에 다시 업로드될 수 있음): ${hash}`, e);
	}
}
function recallUploadedUrlByHash(blogId: string, hash: string): string | null {
	try {
		return localStorage.getItem(uploadedHashKey(blogId, hash));
	} catch {
		return null;
	}
}

/** Obsidian requestUrl은 FormData를 지원하지 않아 multipart/form-data 바디를 직접 구성. */
function buildMultipartBody(fieldName: string, filename: string, mime: string, data: ArrayBuffer): { body: ArrayBuffer; contentType: string } {
	const boundary = `----ramenBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const encoder = new TextEncoder();
	const preamble = encoder.encode(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
		`Content-Type: ${mime}\r\n\r\n`
	);
	const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);
	const body = new Uint8Array(preamble.byteLength + data.byteLength + epilogue.byteLength);
	body.set(preamble, 0);
	body.set(new Uint8Array(data), preamble.byteLength);
	body.set(epilogue, preamble.byteLength + data.byteLength);
	return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** 실제 HTTP 업로드 1회 수행(캐시 체크 없이). 성공하면 서버 URL, 실패하면 null. */
async function performImageUpload(blog: BlogConfig, imageFile: TFile, data: ArrayBuffer): Promise<string | null> {
	const target = `${blog.link}/api/uploads`;
	debugLog(`[ramen] 이미지 업로드 시작: ${imageFile.path} (${imageFile.stat.size} bytes) → ${target}`);
	try {
		const ext = imageFile.extension.toLowerCase();
		const mime = IMAGE_MIME[ext] ?? 'application/octet-stream';
		const { body, contentType } = buildMultipartBody('file', imageFile.name, mime, data);
		const res = await requestUrl({
			url: target,
			method: 'POST',
			headers: { 'Content-Type': contentType, Authorization: `Bearer ${blog.password}` },
			body,
			throw: false,
		});
		if (res.status !== 200) {
			console.warn(`[ramen] 이미지 업로드 실패 (${res.status}): ${imageFile.path}`, res.text);
			return null;
		}
		const url = (res.json as { url?: string })?.url;
		if (!url) {
			console.warn(`[ramen] 이미지 업로드 응답에 url 없음: ${imageFile.path}`, res.text);
			return null;
		}
		debugLog(`[ramen] 이미지 업로드 성공: ${imageFile.path} → ${url}`);
		return url;
	} catch (e) {
		console.warn(`[ramen] 이미지 업로드 실패: ${imageFile.path}`, e);
		return null;
	}
}

async function uploadImageFile(app: App, blog: BlogConfig, imageFile: TFile): Promise<string | null> {
	const data = await app.vault.readBinary(imageFile);
	const hash = await hashArrayBuffer(data);
	const cacheKey = `${blog.id}:${hash}`;

	// 내용이 완전히 같은 이미지는 파일 경로·이름·mtime이 달라도(예: 사본, pull 시 다시 받은 동일 이미지) 재업로드하지 않음
	const cached = uploadedImageCache.get(cacheKey) ?? recallUploadedUrlByHash(blog.id, hash);
	if (cached) {
		debugLog(`[ramen] 이미지 업로드 스킵 (동일 내용 이미 업로드됨): ${imageFile.path} → ${cached}`);
		uploadedImageCache.set(cacheKey, cached);
		return cached;
	}

	const url = await performImageUpload(blog, imageFile, data);
	if (!url) return null;
	uploadedImageCache.set(cacheKey, url);
	rememberUploadedUrlByHash(blog.id, hash, url);
	rememberUploadedFilename(blog.id, url, imageFile.name);
	return url;
}

/**
 * uploadImageFile과 달리 내용-해시 캐시를 무시하고 무조건 새로 업로드 — 서버가 재처리(예: 리사이즈/
 * 포맷 변환)를 새로 하도록 강제하고 싶을 때 씀(예: 서버 업로드 파이프라인이 바뀐 뒤 예전에 이미
 * 캐시된 이미지를 다시 최적화시키고 싶은 경우). 캐시에 남아있던 "이전 URL"을 같이 반환하니, 호출부에서
 * 그 파일이 이제 이 노트에서 안 쓰인다고 판단되면 deleteServerUpload로 정리할 수 있음.
 */
export async function forceReuploadImageFile(
	app: App,
	blog: BlogConfig,
	imageFile: TFile,
): Promise<{ url: string; previousUrl: string | null } | null> {
	const data = await app.vault.readBinary(imageFile);
	const hash = await hashArrayBuffer(data);
	const cacheKey = `${blog.id}:${hash}`;
	const previousUrl = uploadedImageCache.get(cacheKey) ?? recallUploadedUrlByHash(blog.id, hash) ?? null;

	const url = await performImageUpload(blog, imageFile, data);
	if (!url) return null;
	uploadedImageCache.set(cacheKey, url);
	rememberUploadedUrlByHash(blog.id, hash, url);
	rememberUploadedFilename(blog.id, url, imageFile.name);
	return { url, previousUrl: previousUrl && previousUrl !== url ? previousUrl : null };
}

/** blog 서버에 업로드된 /uploads/... 파일을 지움 — force 재업로드로 예전 파일이 더 이상
 *  안 쓰이게 됐을 때 정리하는 용도. 실패해도(이미 없거나 네트워크 오류) 조용히 무시. */
export async function deleteServerUpload(blog: BlogConfig, url: string): Promise<void> {
	if (!url.startsWith('/uploads/')) return;
	const filename = url.slice('/uploads/'.length);
	if (!filename || filename.includes('/')) return;
	try {
		await requestUrl({
			url: `${blog.link}/api/uploads/${filename}`,
			method: 'DELETE',
			headers: { Authorization: `Bearer ${blog.password}` },
			throw: false,
		});
	} catch (e) {
		debugLog(`[ramen] 예전 업로드 파일 삭제 실패 (무해함): ${url}`, e);
	}
}

/** filePath가 속한 블로그들(rootFolder 하위) — 연결(link+password) 안 된 블로그는 제외. */
export function blogsForFilePath(blogs: BlogConfig[], filePath: string): BlogConfig[] {
	return blogs.filter(b => {
		const root = b.rootFolder.replace(/\/+$/, '');
		if (!root || !filePath.startsWith(root + '/')) return false;
		return !!(b.link && b.password);
	});
}

/**
 * 노트 안의 로컬 vault 이미지(위키링크 `![[img.png]]`, 표준 `![alt](상대경로)`, raw HTML `<img src="상대경로">`)를
 * 서버에 업로드하고 본문의 참조를 서버 URL로 치환. 원본 vault 파일은 건드리지 않음 — 서버로 보낼 body_md에만 적용.
 */
async function uploadEmbeddedImages(app: App, file: TFile, blog: BlogConfig, content: string): Promise<string> {
	let result = content;
	const seen = new Set<string>();

	// 1) 위키링크 임베드: ![[img.png]]
	const embeds = app.metadataCache.getFileCache(file)?.embeds ?? [];
	for (const embed of embeds) {
		const ext = embed.link.split('.').pop()?.toLowerCase() ?? '';
		if (!IMAGE_EXTS.has(ext)) continue;
		const original = embed.original ?? `![[${embed.link}]]`;
		if (seen.has(original)) continue;
		seen.add(original);

		const resolved = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
		if (!(resolved instanceof TFile)) {
			console.warn(`[ramen] 본문 임베드 이미지 링크 해석 실패: "${embed.link}" (${file.path})`);
			continue;
		}
		const url = await uploadImageFile(app, blog, resolved);
		if (!url) continue;
		result = result.split(original).join(`![${resolved.basename}](${url})`);
	}

	// 2) 표준 마크다운 이미지: ![alt](상대경로) — Obsidian 설정에서 "Markdown links" 사용 시
	const standardMatches = [...content.matchAll(STANDARD_IMAGE_MD_RE)];
	for (const m of standardMatches) {
		const alt = m[1] ?? '';
		const linkPath = m[2];
		if (!linkPath) continue;
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(linkPath) || linkPath.startsWith('/')) continue; // http(s):, data:, 이미 서버 URL
		const ext = linkPath.split('.').pop()?.toLowerCase() ?? '';
		if (!IMAGE_EXTS.has(ext)) continue;
		const original = `(${linkPath})`;
		if (seen.has(original)) continue;
		seen.add(original);

		const resolved = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(linkPath), file.path);
		if (!(resolved instanceof TFile)) continue;
		const url = await uploadImageFile(app, blog, resolved);
		if (!url) continue;
		result = result.split(`![${alt}](${linkPath})`).join(`![${alt}](${url})`);
	}

	// 3) raw HTML <img src="상대경로"> — 마크다운 문법 밖에서 직접 HTML을 섞어 쓴 경우.
	//    src만 서버 URL로 바꾸고 alt/width/style 등 다른 속성은 그대로 둠.
	const htmlImgMatches = [...content.matchAll(HTML_IMG_SRC_RE)];
	for (const m of htmlImgMatches) {
		const linkPath = m[3];
		if (!linkPath) continue;
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(linkPath) || linkPath.startsWith('/')) continue; // http(s):, data:, 이미 서버 URL
		const ext = linkPath.split('.').pop()?.toLowerCase() ?? '';
		if (!IMAGE_EXTS.has(ext)) continue;
		const original = m[0];
		if (seen.has(original)) continue;
		seen.add(original);

		const resolved = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(linkPath), file.path);
		if (!(resolved instanceof TFile)) continue;
		const url = await uploadImageFile(app, blog, resolved);
		if (!url) continue;
		const newTag = `${m[1]}${m[2]}${url}${m[2]}${m[4]}`;
		result = result.split(original).join(newTag);
	}

	return result;
}

const WIKILINK_RE = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/;
const MD_IMAGE_RE = /^!\[[^\]]*\]\(([^)\s]+)\)$/;

/**
 * frontmatter의 banner 값(위키링크 `[[img.png]]`/`![[img.png]]` 또는 표준 `![alt](상대경로)`)이
 * 로컬 vault 이미지를 가리키면 서버에 업로드하고 그 URL을 반환. 원본 vault 파일(frontmatter)은 건드리지 않음 —
 * 서버로 보낼 PostDoc에만 적용. 이미 외부 URL/절대경로거나 인식 불가한 형식이면 원본 값 그대로 반환.
 */
async function resolveBannerImage(app: App, file: TFile, blog: BlogConfig, raw: string): Promise<string> {
	const trimmed = raw.trim();
	if (!trimmed) return trimmed;
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('/')) {
		debugLog(`[ramen] banner: 이미 외부 URL/절대경로라 업로드 스킵: "${trimmed}"`);
		return trimmed;
	}

	const linkPath = trimmed.match(WIKILINK_RE)?.[1] ?? trimmed.match(MD_IMAGE_RE)?.[1];
	if (!linkPath) {
		console.warn(`[ramen] banner: 인식 가능한 링크 형식이 아님 (그대로 사용): "${trimmed}"`);
		return trimmed;
	}

	const ext = linkPath.split('.').pop()?.toLowerCase() ?? '';
	if (!IMAGE_EXTS.has(ext)) {
		console.warn(`[ramen] banner: 지원하지 않는 확장자라 업로드 스킵: "${linkPath}"`);
		return trimmed;
	}

	const resolved = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(linkPath), file.path);
	if (!(resolved instanceof TFile)) {
		console.warn(`[ramen] banner: vault에서 이미지 파일을 찾을 수 없음: "${linkPath}" (${file.path})`);
		return trimmed;
	}

	const url = await uploadImageFile(app, blog, resolved);
	return url ?? trimmed;
}

/** 서버 업로드 URL(/uploads/...) → 다운로드해서 저장한 로컬 TFile 캐시. key: "blogId:url". */
const downloadedImageCache = new Map<string, TFile>();
const SERVER_UPLOAD_MD_IMAGE_RE = /!\[([^\]]*)\]\((\/uploads\/[^)\s]+)\)/g;

/** dir 안에서 filename과 안 겹치는 경로를 찾음 — 겹치면 Obsidian 컨벤션대로 "이름 2.ext", "이름 3.ext" 순으로 증가. */
export function availablePathInFolder(app: App, dir: string, filename: string): string {
	const dot = filename.lastIndexOf('.');
	const base = dot > 0 ? filename.slice(0, dot) : filename;
	const ext = dot > 0 ? filename.slice(dot) : '';
	let candidate = normalizePath(`${dir}/${filename}`);
	for (let i = 2; app.vault.getAbstractFileByPath(candidate); i++) {
		candidate = normalizePath(`${dir}/${base} ${i}${ext}`);
	}
	return candidate;
}

/**
 * 서버의 /uploads/... 상대경로 이미지를 vault 첨부파일 폴더로 다운로드하고 로컬 TFile을 반환.
 * 이미 다운로드한 적 있으면 캐시된 파일을 재사용. 실패 시 null.
 */
/**
 * url이 서버에서 리사이즈/webp 변환된 최적화 파일이면, 그 원본(`GET .../original`)의 URL을 찾아 반환.
 * 원본이 따로 없으면(gif/svg처럼 애초에 최적화 대상이 아니었거나, 오래된 업로드라 원본이 안 남아있는
 * 경우) null — 호출부가 url 자체를 그대로 쓰면 됨. 실패해도 조용히 null(다운로드 자체를 막지 않음).
 */
async function resolveOriginalUploadUrl(blog: BlogConfig, url: string): Promise<string | null> {
	const filename = url.split('/').pop();
	if (!filename) return null;
	try {
		const res = await requestUrl({ url: `${blog.link.replace(/\/+$/, '')}/api/uploads/${filename}/original`, method: 'GET', throw: false });
		if (res.status !== 200) return null;
		const originalUrl = (res.json as { originalUrl?: string })?.originalUrl;
		return typeof originalUrl === 'string' ? originalUrl : null;
	} catch (e) {
		debugLog(`[ramen pull] 원본 조회 실패 (무해함, 최적화된 파일 그대로 받음): ${url}`, e);
		return null;
	}
}

async function downloadServerImage(app: App, blog: BlogConfig, url: string, referenceFilePath: string): Promise<TFile | null> {
	const cacheKey = `${blog.id}:${url}`;
	const cached = downloadedImageCache.get(cacheKey);
	if (cached && app.vault.getAbstractFileByPath(cached.path) === cached) {
		debugLog(`[ramen pull] 이미지 다운로드 캐시 사용: ${url} → ${cached.path}`);
		return cached;
	}

	// 서버가 리사이즈/webp 변환한 파일이면 원본이 따로 있는지 먼저 확인 — 있으면 그걸 받아서
	// vault엔 화질 손실 없는 원본이 들어가게(다른 기기에서 pull해도 처음 업로드했던 원본 그대로).
	const originalUrl = await resolveOriginalUploadUrl(blog, url);
	const downloadUrl = originalUrl ?? url;
	const absoluteUrl = /^https?:\/\//.test(downloadUrl) ? downloadUrl : `${blog.link.replace(/\/+$/, '')}${downloadUrl}`;
	// 업로드 당시 기억해둔 원본 파일명이 있으면 그걸로 복원, 없으면(다른 기기에서 pull하는 경우 등) 실제
	// 받아오는 파일(downloadUrl — 원본이 있으면 원본, 없으면 최적화 파일)의 확장자로 유추.
	const rawName = recallUploadedFilename(blog.id, url) ?? decodeURIComponent(absoluteUrl.split('/').pop() || `image-${Date.now()}`);

	// vault에 같은 이름의 파일이 이미 있으면(애초에 그 이미지를 push했던 로컬 원본이거나 이미 한 번 pull된 경우)
	// 새로 받지 않고 그대로 재사용 — 안 하면 availablePathInFolder가 "파일명 2.png" 식으로 매번 중복 생성함.
	const existing = app.metadataCache.getFirstLinkpathDest(rawName, referenceFilePath);
	if (existing instanceof TFile) {
		debugLog(`[ramen pull] vault에 이미 있는 이미지 재사용 (다운로드 스킵): ${rawName} → ${existing.path}`);
		downloadedImageCache.set(cacheKey, existing);
		return existing;
	}

	try {
		const res = await requestUrl({ url: absoluteUrl, method: 'GET', throw: false });
		if (res.status !== 200) {
			console.warn(`[ramen pull] 이미지 다운로드 실패 (${res.status}): ${absoluteUrl}`);
			return null;
		}
		let file: TFile;
		if (blog.attachmentFolderMode === 'default') {
			// 사용자가 설정 화면에서 명시적으로 "기본 설정 따름"을 선택한 경우에만 Obsidian 전역 설정
			// ("파일 및 링크 > 새 첨부파일 기본 위치")을 그대로 따름 — vault 루트가 될 수도 있음을 알고 선택한 것.
			const availablePath = await app.fileManager.getAvailablePathForAttachment(rawName, referenceFilePath);
			file = await app.vault.createBinary(normalizePath(availablePath), res.arrayBuffer);
		} else {
			// 'custom' 모드: rootFolder/attachmentFolder 아래 경로를 직접 정하고, 중복 파일명은 자체적으로 회피
			// (app.fileManager.getAvailablePathForAttachment에 맡기면 전역 설정이 우선돼 블로그별 지정이 무시됨).
			const attachDir = resolveFixedAttachmentDir(app, blog)!;
			if (!app.vault.getAbstractFileByPath(attachDir)) {
				await app.vault.createFolder(attachDir);
			}
			const availablePath = availablePathInFolder(app, attachDir, rawName);
			file = await app.vault.createBinary(availablePath, res.arrayBuffer);
		}
		downloadedImageCache.set(cacheKey, file);
		debugLog(`[ramen pull] 이미지 다운로드 성공: ${absoluteUrl} → ${file.path}`);
		return file;
	} catch (e) {
		console.warn(`[ramen pull] 이미지 다운로드 실패: ${absoluteUrl}`, e);
		return null;
	}
}

/**
 * pull된 doc.banner가 우리 서버의 업로드 경로(/uploads/...)면 vault로 다운로드하고 위키링크로 치환해서 반환.
 * 이미 위키링크거나 외부 URL이면 그대로 반환 — 다운로드 실패 시에도 원본 값 그대로 반환(정보 손실 방지).
 */
async function localizeBannerForPull(app: App, blog: BlogConfig, banner: string | null | undefined, referenceFilePath: string): Promise<string | null> {
	if (!banner) return banner ?? null;
	if (!banner.startsWith('/uploads/')) return banner;
	const file = await downloadServerImage(app, blog, banner, referenceFilePath);
	return file ? `[[${file.name}]]` : banner;
}

/**
 * pull된 body_md 안의 서버 업로드 이미지를 vault로 다운로드해서 되돌림 — push 시 uploadEmbeddedImages가
 * 하는 변환의 역방향. 표준 마크다운 `![alt](/uploads/...)`은 위키링크 임베드 `![[filename]]`로 치환하고,
 * raw HTML `<img src="/uploads/...">`은 위키링크로 바꾸면 width/style 같은 속성이 날아가므로 태그는
 * 그대로 두고 src만 로컬 파일명으로 되돌림.
 */
async function localizeEmbeddedImagesForPull(app: App, blog: BlogConfig, body: string, referenceFilePath: string): Promise<string> {
	let result = body;
	const seen = new Set<string>();

	const matches = [...body.matchAll(SERVER_UPLOAD_MD_IMAGE_RE)];
	for (const m of matches) {
		const full = m[0];
		const url = m[2];
		if (!url || seen.has(full)) continue;
		seen.add(full);
		const file = await downloadServerImage(app, blog, url, referenceFilePath);
		if (!file) continue;
		result = result.split(full).join(`![[${file.name}]]`);
	}

	const htmlImgMatches = [...body.matchAll(HTML_IMG_SRC_RE)];
	for (const m of htmlImgMatches) {
		const full = m[0];
		const url = m[3];
		if (!url || !url.startsWith('/uploads/') || seen.has(full)) continue;
		seen.add(full);
		const file = await downloadServerImage(app, blog, url, referenceFilePath);
		if (!file) continue;
		const newTag = `${m[1]}${m[2]}${encodeURI(file.name)}${m[2]}${m[4]}`;
		result = result.split(full).join(newTag);
	}

	return result;
}

export function checkpointKey(blogId: string): string {
	return `${CHECKPOINT_PREFIX}${blogId}`;
}

export function slugFromPath(filePath: string, rootFolder: string): string {
	const root = rootFolder.replace(/\/+$/, '');
	const rel = filePath.startsWith(root + '/')
		? filePath.slice(root.length + 1)
		: filePath;
	return rel.replace(/\.md$/, '').replace(/\./g, '-').replace(/-{2,}/g, '-');
}

/** pull에서 삭제/이름변경으로 확인된 파일이 보관되는 폴더 이름. "."로 시작해 파일 탐색기 dotfile 설정을 따라 기본적으로 숨겨짐. */
export const TRASHBIN_DIR_NAME = '.trashbin';

export function trashbinRootPath(rootFolder: string): string {
	return `${rootFolder.replace(/\/+$/, '')}/${TRASHBIN_DIR_NAME}`;
}

/** 이 경로가 rootFolder 안의 trashbin 하위(보관된 파일)인지. push 스캔·수정 이벤트에서 제외하는 데 씀. */
export function isInTrashbin(filePath: string, rootFolder: string): boolean {
	return filePath.startsWith(`${trashbinRootPath(rootFolder)}/`);
}

function categoryFromPath(filePath: string, rootFolder: string): string[] {
	const root = rootFolder.replace(/\/+$/, '');
	const rel = filePath.startsWith(root + '/')
		? filePath.slice(root.length + 1)
		: filePath;
	const parts = rel.split('/');
	return parts.length > 1 ? parts.slice(0, -1) : [];
}

export function deletedPostDoc(slug: string, basename: string): PostDoc {
	const now = new Date().toISOString();
	return {
		id: `post:${slug}`,
		slug,
		title: basename,
		body_md: '',
		published: 0,
		tags: '[]',
		category: '[]',
		deleted_at: now,
		created_at: now,
		updated_at: now,
	};
}

export function stripFrontmatter(content: string): string {
	if (!content.startsWith('---')) return content;
	const end = content.indexOf('\n---', 3);
	return end !== -1 ? content.slice(end + 4).replace(/^\s+/, '') : content;
}

/** Obsidian의 tags 속성은 목록이 정상이지만, 사용자가 "tags: foo" 처럼 단일 문자열로 쓰는 경우가 있다.
 *  이 경우 그대로 두면 배열이 아니라서 통째로 빈 배열([])로 취급돼 태그 기반 기능(예: project 승격)이 조용히 실패한다. */
export function normalizeTagsValue(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
	if (typeof raw === 'string' && raw.trim()) {
		return raw.split(',').map((t) => t.trim()).filter(Boolean);
	}
	return [];
}

/** description frontmatter가 없을 때 본문에서 자동 생성 (프로젝트 목록 카드 요약용). */
function generateDescription(body: string, maxLen = 90): string {
	const stripped = body
		.replace(/```[\s\S]*?```/g, '')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#>*_`~-]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return stripped.length > maxLen ? `${stripped.slice(0, maxLen).trim()}…` : stripped;
}

export async function fileToPostDoc(app: App, file: TFile, blog: BlogConfig, contentOverride?: string, locale: Locale = 'ko'): Promise<PostDoc | null> {
	const root = blog.rootFolder.replace(/\/+$/, '');
	if (!file.path.startsWith(root + '/')) return null;

	const content = contentOverride ?? await app.vault.read(file);
	const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};

	const slug = slugFromPath(file.path, blog.rootFolder);
	const category = categoryFromPath(file.path, blog.rootFolder);

	const html_mode = fm['html_mode'] === true || fm['html_mode'] === 1 ? 1 : 0;
	// html_mode 노트는 로컬 파일에 코드펜스로 감싸 저장돼 있음(Obsidian 태그 오염 방지, htmlDocParts.ts
	// 참고) — 서버로 보낼 body_md는 그 펜스를 벗긴 순수 raw HTML이어야 함.
	const strippedContent = stripFrontmatter(content);
	const bodyForUpload = html_mode ? unwrapHtmlModeBody(strippedContent) : strippedContent;
	const body_md = await uploadEmbeddedImages(app, file, blog, bodyForUpload);

	const rawBanner = typeof fm['banner'] === 'string' ? fm['banner'].trim() : '';
	const banner = rawBanner ? await resolveBannerImage(app, file, blog, rawBanner) : null;

	const rawBannerUrl = typeof fm['banner-url'] === 'string' ? fm['banner-url'].trim() : '';
	const banner_url = rawBannerUrl || null;

	const rawTags: unknown = fm['tags'];
	const tags = normalizeTagsValue(rawTags);
	if (typeof rawTags === 'string' && rawTags.trim()) {
		new Notice(t(locale, 'tagsFixedNotice', { basename: file.basename, tags: tags.join(', ') }), 6000);
		await app.fileManager.processFrontMatter(file, (frontmatter: { tags?: string[] }) => {
			frontmatter.tags = tags;
		});
	}

	const isProjectPost = !!blog.projectTag && tags.includes(blog.projectTag);

	const rawDescription = typeof fm['description'] === 'string' ? fm['description'].trim() : '';
	let description = rawDescription || null;
	if (!rawDescription && isProjectPost) {
		const generated = generateDescription(stripFrontmatter(content));
		if (generated) {
			description = generated;
			new Notice(t(locale, 'descriptionFixedNotice', { basename: file.basename, description: generated }), 6000);
			await app.fileManager.processFrontMatter(file, (frontmatter: { description?: string }) => {
				frontmatter.description = generated;
			});
		}
	}

	return {
		id: `post:${slug}`,
		slug,
		title: typeof fm['title'] === 'string' ? fm['title'] : file.basename,
		body_md,
		published: fm['published'] === true || fm['published'] === 1 ? 1 : 0,
		tags: JSON.stringify(tags),
		category: JSON.stringify(category),
		banner,
		banner_url,
		description,
		html_mode,
		deleted_at: null,
		created_at: typeof fm['created_at'] === 'string' ? fm['created_at'] : new Date(file.stat.ctime).toISOString(),
		updated_at: new Date(file.stat.mtime).toISOString(),
	};
}

async function callSyncApi(
	blog: BlogConfig,
	documents: PostDoc[],
	checkpoint: string | null,
): Promise<{ checkpoint: string; documents: PostDoc[] }> {
	const res = await requestUrl({
		url: `${blog.link}/api/sync/posts`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${blog.password}`,
		},
		body: JSON.stringify({ checkpoint, documents }),
		throw: false,
	});
	if (res.status !== 200) throw new Error(`Sync failed: ${res.status}`);
	return res.json as { checkpoint: string; documents: PostDoc[] };
}

function parseJsonField(value: unknown, fallback: unknown[] = []): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		try { return JSON.parse(value) as unknown[]; } catch { /* ignore */ }
	}
	return fallback;
}

// 서버 업로드 URL(/uploads/...)로 저장된 banner·본문 임베드 이미지를 vault로 다운로드해 위키링크로 되돌린 뒤
// frontmatter + body를 조립. referenceFilePath는 Obsidian의 첨부파일 경로 설정 기준점(대상 노트 경로)으로 씀.
async function docToFileContent(app: App, blog: BlogConfig, doc: PostDoc, referenceFilePath: string): Promise<string> {
	const tags = parseJsonField(doc.tags) as string[];
	const lines = ['---'];
	// title은 frontmatter에 쓰지 않음 — 파일 이름이 곧 제목(파일명 변경 = 제목 변경)이라
	// title을 같이 쓰면 파일명과 따로 노는 값이 생겨 혼동을 줌. push 시 fm.title 없으면 file.basename 사용.
	if (tags.length > 0) lines.push(`tags: [${tags.map(t => `"${String(t).replace(/"/g, '\\"')}"`).join(', ')}]`);
	if (doc.published) lines.push('published: true');
	const localBanner = await localizeBannerForPull(app, blog, doc.banner, referenceFilePath);
	if (localBanner) lines.push(`banner: "${localBanner.replace(/"/g, '\\"')}"`);
	if (doc.banner_url) lines.push(`banner-url: "${doc.banner_url.replace(/"/g, '\\"')}"`);
	if (doc.description) lines.push(`description: "${doc.description.replace(/"/g, '\\"')}"`);
	if (doc.html_mode) lines.push('html_mode: true');
	lines.push(`created_at: ${doc.created_at}`);
	const localBody = doc.html_mode ? wrapHtmlModeBody(doc.body_md) : await localizeEmbeddedImagesForPull(app, blog, doc.body_md, referenceFilePath);
	lines.push('---', '', localBody);
	return lines.join('\n');
}

// slug → 로컬 TFile 매핑. slugFromPath는 "." → "-" 변환 등으로 원본 파일명을 그대로 복원 못 하므로,
// "root/{slug}.md" 경로를 그대로 재구성해서 존재 여부를 확인하면 파일명에 "."이 있는 경우
// (예: "01.테스트.md" → slug "01-테스트") 항상 "없는 파일"로 오판해 pull마다 중복 생성됨.
// 로컬 파일들의 실제 slug를 미리 계산해 매칭해야 원본 파일을 찾을 수 있다.
function buildLocalSlugMap(app: App, rootFolder: string): Map<string, TFile> {
	const root = rootFolder.replace(/\/+$/, '');
	const map = new Map<string, TFile>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(root + '/')) continue;
		if (isInTrashbin(file.path, rootFolder)) continue;
		map.set(slugFromPath(file.path, rootFolder), file);
	}
	return map;
}

// 파일 이동 후 빈 폴더가 남으면 rootFolder까지(포함 안 함) 위로 올라가며 정리.
// 폴더 이름 변경(=구 slug는 deleted, 새 slug는 새 파일로 pull)의 부산물로 남는 빈 폴더를 없애기 위함.
async function trashEmptyFoldersUpward(app: App, startFolderPath: string, rootFolder: string): Promise<void> {
	const root = rootFolder.replace(/\/+$/, '');
	let folderPath = startFolderPath;
	while (folderPath && folderPath !== root && (folderPath === root || folderPath.startsWith(root + '/'))) {
		const folder = app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder) || folder.children.length > 0) break;
		const parentPath = folder.parent?.path ?? '';
		await app.fileManager.trashFile(folder);
		debugLog(`[ramen pull] 빈 폴더 정리: ${folderPath}`);
		folderPath = parentPath;
	}
}

// 서버에서 삭제된 것으로 확인된 로컬 파일을 지우는 대신 rootFolder 안 ".trashbin/{연도}/{월-일}/"
// 아래로 옮겨 보관한다. isInTrashbin으로 push 스캔·수정 이벤트에서 제외되므로 다시 서버로 안 올라간다.
// 재발행처럼 보이지 않도록 published frontmatter도 꺼둔다.
async function archiveDeletedFile(app: App, file: TFile, blog: BlogConfig): Promise<string> {
	const now = new Date();
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	const dir = normalizePath(`${trashbinRootPath(blog.rootFolder)}/${year}/${month}-${day}`);
	if (!app.vault.getAbstractFileByPath(dir)) {
		await app.vault.createFolder(dir);
	}

	let targetPath = normalizePath(`${dir}/${file.name}`);
	if (app.vault.getAbstractFileByPath(targetPath)) {
		let i = 2;
		while (app.vault.getAbstractFileByPath(targetPath)) {
			targetPath = normalizePath(`${dir}/${file.basename} ${i}.${file.extension}`);
			i++;
		}
	}

	await app.fileManager.renameFile(file, targetPath);
	await app.fileManager.processFrontMatter(file, (fm: { published?: boolean }) => {
		fm.published = false;
	});
	return targetPath;
}

// Pull된 문서를 vault 파일에 반영 (서버가 더 새로울 때만, 기존 파일만)
// frontmatter(title/tags/published/created_at)까지 함께 써서 로컬 상태를 서버와 통일시킨다.
// body_md만 반영하면 published 등 frontmatter가 통째로 사라지는 문제가 있었음.
async function applyPulledDocs(
	app: App,
	blog: BlogConfig,
	docs: PostDoc[],
	onApply: (path: string) => void,
): Promise<void> {
	const localBySlug = buildLocalSlugMap(app, blog.rootFolder);
	for (const doc of docs) {
		if (doc.deleted_at) continue;
		const file = localBySlug.get(doc.slug);
		if (!file) continue;
		const filePath = file.path;

		if (lastLivePushedAt.get(`${blog.id}:${filePath}`) === doc.updated_at) continue;

		const serverMtime = new Date(doc.updated_at).getTime();
		if (serverMtime <= file.stat.mtime) continue;

		onApply(filePath);
		await app.vault.modify(file, await docToFileContent(app, blog, doc, filePath));
	}
}

export interface PullResult {
	created: number;
	updated: number;
	skipped: number;
	deleted: number;
	log: string[];
}

// 명시적 pull 커맨드용 — 서버의 모든 문서를 가져와 없으면 생성, 있으면 최신화
export async function pullBlog(
	app: App,
	blog: BlogConfig,
	onApply: (path: string) => void,
	onProgress?: (msg: string) => void,
	locale: Locale = 'ko',
	options?: { force?: boolean },
): Promise<PullResult> {
	const force = options?.force ?? false;
	onProgress?.(t(locale, 'pullFetchingList'));
	const result = await callSyncApi(blog, [], null);

	const total = result.documents.filter(d => !d.deleted_at).length;
	const msg = t(locale, 'pullDocsReceived', { total, all: result.documents.length });
	onProgress?.(msg);
	debugLog(`[ramen pull] ${msg}`);
	console.debug('[ramen pull] raw documents:', result.documents);

	let created = 0;
	let updated = 0;
	let skipped = 0;
	let deleted = 0;
	const log: string[] = [];
	const localBySlug = buildLocalSlugMap(app, blog.rootFolder);

	for (const doc of result.documents) {
		if (doc.deleted_at) {
			const existingForDelete = localBySlug.get(doc.slug);
			if (existingForDelete) {
				const parentPath = existingForDelete.parent?.path ?? '';
				const archivedPath = await archiveDeletedFile(app, existingForDelete, blog);
				localBySlug.delete(doc.slug);
				await trashEmptyFoldersUpward(app, parentPath, blog.rootFolder);
				deleted++;
				const entry = t(locale, 'pullDeleted', { slug: doc.slug });
				log.push(entry);
				onProgress?.(entry);
				debugLog(`[ramen pull] ${entry} → ${archivedPath}`);
			} else {
				console.debug(`[ramen pull] 스킵(deleted, 로컬에 없음): ${doc.slug}`, doc);
			}
			continue;
		}
		const root = blog.rootFolder.replace(/\/+$/, '');
		const existing = localBySlug.get(doc.slug);
		const filePath = existing ? existing.path : normalizePath(`${root}/${doc.slug}.md`);

		console.debug(`[ramen pull] 처리 중: ${doc.slug}`, {
			id: doc.id,
			title: doc.title,
			published: doc.published,
			tags: doc.tags,
			category: doc.category,
			updated_at: doc.updated_at,
			body_preview: doc.body_md?.slice(0, 80),
		});

		if (existing) {
			const isOwnEcho = lastLivePushedAt.get(`${blog.id}:${existing.path}`) === doc.updated_at;
			const serverMtime = new Date(doc.updated_at).getTime();
			if (!isOwnEcho && (force || serverMtime > existing.stat.mtime)) {
				onApply(filePath);
				await app.vault.modify(existing, await docToFileContent(app, blog, doc, existing.path));
				updated++;
				const entry = t(locale, 'pullUpdated', { slug: doc.slug });
				log.push(entry);
				onProgress?.(entry);
				debugLog(`[ramen pull] ${entry} (server: ${doc.updated_at}, local: ${new Date(existing.stat.mtime).toISOString()})`);
			} else {
				skipped++;
				const skipMsg = `[스킵] ${doc.slug} (로컬이 최신 — local: ${new Date(existing.stat.mtime).toISOString()}, server: ${doc.updated_at})`;
				onProgress?.(t(locale, 'pullSkipped', { slug: doc.slug }));
				debugLog(`[ramen pull] ${skipMsg}`);
			}
		} else {
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dir && !app.vault.getAbstractFileByPath(dir)) {
				await app.vault.createFolder(dir);
			}
			onApply(filePath);
			const newFile = await app.vault.create(filePath, await docToFileContent(app, blog, doc, filePath));
			localBySlug.set(doc.slug, newFile);
			created++;
			const entry = t(locale, 'pullCreated', { slug: doc.slug });
			log.push(entry);
			onProgress?.(entry);
			debugLog(`[ramen pull] ${entry}`);
		}
	}

	localStorage.setItem(checkpointKey(blog.id), result.checkpoint);
	return { created, updated, skipped, deleted, log };
}

export async function syncBlog(
	app: App,
	blog: BlogConfig,
	extraDocs: PostDoc[] = [],
	onApplyPull?: (path: string) => void,
	locale: Locale = 'ko',
): Promise<void> {
	if (!blog.link || !blog.password) return;

	const checkpoint = localStorage.getItem(checkpointKey(blog.id)) ?? null;
	const root = blog.rootFolder.replace(/\/+$/, '');

	const allFiles = app.vault.getMarkdownFiles()
		.filter(f => f.path.startsWith(root + '/') && !isInTrashbin(f.path, blog.rootFolder));

	const filesToPush = checkpoint
		? allFiles.filter(f => f.stat.mtime > new Date(checkpoint).getTime())
		: allFiles;

	const localDocs: PostDoc[] = [...extraDocs];
	for (const file of filesToPush) {
		const doc = await fileToPostDoc(app, file, blog, undefined, locale);
		if (doc) localDocs.push(doc);
	}

	const result = await callSyncApi(blog, localDocs, checkpoint);

	if (onApplyPull && result.documents.length > 0) {
		await applyPulledDocs(app, blog, result.documents, onApplyPull);
	}

	localStorage.setItem(checkpointKey(blog.id), result.checkpoint);
}

// 타이핑 중 단일 파일을 서버에 즉시 push (pull 없음)
// - cachedRead: 디스크 flush 전 메모리 내용을 읽음
// - updated_at: 현재 시각 사용 (mtime은 아직 갱신 안 됐을 수 있음)
export async function pushFileLive(
	app: App,
	blog: BlogConfig,
	file: TFile,
	locale: Locale = 'ko',
): Promise<void> {
	if (!blog.link || !blog.password) return;

	const content = await app.vault.cachedRead(file);
	const doc = await fileToPostDoc(app, file, blog, content, locale);
	if (!doc) return;

	doc.updated_at = new Date().toISOString();
	lastLivePushedAt.set(`${blog.id}:${file.path}`, doc.updated_at);

	debugLog(`[ramen] live push: ${doc.slug}`);
	const checkpoint = localStorage.getItem(checkpointKey(blog.id)) ?? null;
	const result = await callSyncApi(blog, [doc], checkpoint);
	localStorage.setItem(checkpointKey(blog.id), result.checkpoint);
}

// 특정 블로그 하나에 발행 상태를 명시적으로 반영.
// 문서가 아직 그 블로그 서버에 없을 수 있으므로 먼저 push(upsert)한 뒤 published를 PATCH.
export async function publishToBlog(app: App, blog: BlogConfig, file: TFile, publish: boolean, locale: Locale = 'ko'): Promise<void> {
	if (!blog.link || !blog.password) throw new Error(t(locale, 'noBlogConnectionInfo'));

	await pushFileLive(app, blog, file, locale);

	const slug = slugFromPath(file.path, blog.rootFolder);
	const res = await requestUrl({
		url: `${blog.link}/api/posts/by-slug/${encodeURIComponent(slug)}`,
		method: 'PATCH',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${blog.password}`,
		},
		body: JSON.stringify({ published: publish ? 1 : 0 }),
		throw: false,
	});
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`Publish failed: ${res.status}`);
	}
}
