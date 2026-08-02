import { App, Notice, TFile, normalizePath, requestUrl } from 'obsidian';
import { BlogConfig } from './settings/types';

export interface PostDoc {
	id: string;
	slug: string;
	title: string;
	body_md: string;
	published: number;
	tags: string;
	category: string;
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
/** 로컬 vault 이미지 → 업로드된 서버 URL 캐시. key: "path:mtime" (플러그인 재로드 시 초기화, 무해함 — 재업로드만 될 뿐). */
const uploadedImageCache = new Map<string, string>();
const STANDARD_IMAGE_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

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

async function uploadImageFile(app: App, blog: BlogConfig, imageFile: TFile): Promise<string | null> {
	const cacheKey = `${imageFile.path}:${imageFile.stat.mtime}`;
	const cached = uploadedImageCache.get(cacheKey);
	if (cached) return cached;

	try {
		const data = await app.vault.readBinary(imageFile);
		const ext = imageFile.extension.toLowerCase();
		const mime = IMAGE_MIME[ext] ?? 'application/octet-stream';
		const { body, contentType } = buildMultipartBody('file', imageFile.name, mime, data);
		const res = await requestUrl({
			url: `${blog.link}/api/uploads`,
			method: 'POST',
			headers: { 'Content-Type': contentType, Authorization: `Bearer ${blog.password}` },
			body,
			throw: false,
		});
		if (res.status !== 200) {
			console.warn(`[ramen] 이미지 업로드 실패 (${res.status}): ${imageFile.path}`);
			return null;
		}
		const url = (res.json as { url?: string })?.url;
		if (!url) return null;
		uploadedImageCache.set(cacheKey, url);
		return url;
	} catch (e) {
		console.warn(`[ramen] 이미지 업로드 실패: ${imageFile.path}`, e);
		return null;
	}
}

/**
 * 노트 안의 로컬 vault 이미지(위키링크 `![[img.png]]` 및 표준 `![alt](상대경로)`)를 서버에 업로드하고
 * 본문의 참조를 서버 URL(`![alt](/uploads/...)`) 로 치환. 원본 vault 파일은 건드리지 않음 — 서버로 보낼 body_md에만 적용.
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
		if (!(resolved instanceof TFile)) continue;
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
function normalizeTagsValue(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
	if (typeof raw === 'string' && raw.trim()) {
		return raw.split(',').map((t) => t.trim()).filter(Boolean);
	}
	return [];
}

export async function fileToPostDoc(app: App, file: TFile, blog: BlogConfig, contentOverride?: string): Promise<PostDoc | null> {
	const root = blog.rootFolder.replace(/\/+$/, '');
	if (!file.path.startsWith(root + '/')) return null;

	const content = contentOverride ?? await app.vault.read(file);
	const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};

	const slug = slugFromPath(file.path, blog.rootFolder);
	const category = categoryFromPath(file.path, blog.rootFolder);

	const body_md = await uploadEmbeddedImages(app, file, blog, stripFrontmatter(content));

	const rawTags = fm['tags'];
	const tags = normalizeTagsValue(rawTags);
	if (typeof rawTags === 'string' && rawTags.trim()) {
		new Notice(`"${file.basename}"의 tags 속성은 목록이어야 합니다. 자동으로 고쳤어요: ${tags.join(', ')}`, 6000);
		await app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.tags = tags;
		});
	}

	return {
		id: `post:${slug}`,
		slug,
		title: typeof fm['title'] === 'string' ? fm['title'] : file.basename,
		body_md,
		published: fm['published'] === true || fm['published'] === 1 ? 1 : 0,
		tags: JSON.stringify(tags),
		category: JSON.stringify(category),
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

function docToFileContent(doc: PostDoc): string {
	const tags = parseJsonField(doc.tags) as string[];
	const lines = ['---'];
	lines.push(`title: "${doc.title.replace(/"/g, '\\"')}"`);
	if (tags.length > 0) lines.push(`tags: [${tags.map(t => `"${String(t).replace(/"/g, '\\"')}"`).join(', ')}]`);
	if (doc.published) lines.push('published: true');
	lines.push(`created_at: ${doc.created_at}`);
	lines.push('---', '', doc.body_md);
	return lines.join('\n');
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
	for (const doc of docs) {
		if (doc.deleted_at) continue;
		const root = blog.rootFolder.replace(/\/+$/, '');
		const filePath = normalizePath(`${root}/${doc.slug}.md`);
		const file = app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) continue;

		const serverMtime = new Date(doc.updated_at).getTime();
		if (serverMtime <= file.stat.mtime) continue;

		onApply(filePath);
		await app.vault.modify(file, docToFileContent(doc));
	}
}

export interface PullResult {
	created: number;
	updated: number;
	skipped: number;
	log: string[];
}

// 명시적 pull 커맨드용 — 서버의 모든 문서를 가져와 없으면 생성, 있으면 최신화
export async function pullBlog(
	app: App,
	blog: BlogConfig,
	onApply: (path: string) => void,
	onProgress?: (msg: string) => void,
): Promise<PullResult> {
	onProgress?.('서버에서 문서 목록 가져오는 중…');
	const result = await callSyncApi(blog, [], null);

	const total = result.documents.filter(d => !d.deleted_at).length;
	const msg = `총 ${total}개 문서 수신 (deleted 포함 ${result.documents.length}개)`;
	onProgress?.(msg);
	console.log(`[ramen pull] ${msg}`);
	console.debug('[ramen pull] raw documents:', result.documents);

	let created = 0;
	let updated = 0;
	let skipped = 0;
	const log: string[] = [];

	for (const doc of result.documents) {
		if (doc.deleted_at) {
			console.debug(`[ramen pull] 스킵(deleted): ${doc.slug}`, doc);
			continue;
		}
		const root = blog.rootFolder.replace(/\/+$/, '');
		const filePath = normalizePath(`${root}/${doc.slug}.md`);
		const existing = app.vault.getAbstractFileByPath(filePath);

		console.debug(`[ramen pull] 처리 중: ${doc.slug}`, {
			id: doc.id,
			title: doc.title,
			published: doc.published,
			tags: doc.tags,
			category: doc.category,
			updated_at: doc.updated_at,
			body_preview: doc.body_md?.slice(0, 80),
		});

		if (existing instanceof TFile) {
			const serverMtime = new Date(doc.updated_at).getTime();
			if (serverMtime > existing.stat.mtime) {
				onApply(filePath);
				await app.vault.modify(existing, docToFileContent(doc));
				updated++;
				const entry = `[업데이트] ${doc.slug}`;
				log.push(entry);
				onProgress?.(entry);
				console.log(`[ramen pull] ${entry} (server: ${doc.updated_at}, local: ${new Date(existing.stat.mtime).toISOString()})`);
			} else {
				skipped++;
				const skipMsg = `[스킵] ${doc.slug} (로컬이 최신 — local: ${new Date(existing.stat.mtime).toISOString()}, server: ${doc.updated_at})`;
				onProgress?.(`[스킵] ${doc.slug} (로컬이 최신)`);
				console.log(`[ramen pull] ${skipMsg}`);
			}
		} else {
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dir && !app.vault.getAbstractFileByPath(dir)) {
				await app.vault.createFolder(dir);
			}
			onApply(filePath);
			await app.vault.create(filePath, docToFileContent(doc));
			created++;
			const entry = `[생성] ${doc.slug}`;
			log.push(entry);
			onProgress?.(entry);
			console.log(`[ramen pull] ${entry}`);
		}
	}

	localStorage.setItem(checkpointKey(blog.id), result.checkpoint);
	return { created, updated, skipped, log };
}

export async function syncBlog(
	app: App,
	blog: BlogConfig,
	extraDocs: PostDoc[] = [],
	onApplyPull?: (path: string) => void,
): Promise<void> {
	if (!blog.link || !blog.password) return;

	const checkpoint = localStorage.getItem(checkpointKey(blog.id)) ?? null;
	const root = blog.rootFolder.replace(/\/+$/, '');

	const allFiles = app.vault.getMarkdownFiles()
		.filter(f => f.path.startsWith(root + '/'));

	const filesToPush = checkpoint
		? allFiles.filter(f => f.stat.mtime > new Date(checkpoint).getTime())
		: allFiles;

	const localDocs: PostDoc[] = [...extraDocs];
	for (const file of filesToPush) {
		const doc = await fileToPostDoc(app, file, blog);
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
): Promise<void> {
	if (!blog.link || !blog.password) return;

	const content = await app.vault.cachedRead(file);
	const doc = await fileToPostDoc(app, file, blog, content);
	if (!doc) return;

	doc.updated_at = new Date().toISOString();

	console.log(`[ramen] live push: ${doc.slug}`);
	const checkpoint = localStorage.getItem(checkpointKey(blog.id)) ?? null;
	const result = await callSyncApi(blog, [doc], checkpoint);
	localStorage.setItem(checkpointKey(blog.id), result.checkpoint);
}

// 특정 블로그 하나에 발행 상태를 명시적으로 반영.
// 문서가 아직 그 블로그 서버에 없을 수 있으므로 먼저 push(upsert)한 뒤 published를 PATCH.
export async function publishToBlog(app: App, blog: BlogConfig, file: TFile, publish: boolean): Promise<void> {
	if (!blog.link || !blog.password) throw new Error('블로그 연결 정보 없음');

	await pushFileLive(app, blog, file);

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
