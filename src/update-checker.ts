import { App, requestUrl } from 'obsidian';

/** GitHub owner/repo — release.yml이 태그 푸시마다 main.js/manifest.json/styles.css를 첨부해 릴리즈를 만든다. */
const REPO = 'project-ramen/obsidian';

interface GitHubReleaseAsset {
	name: string;
	browser_download_url: string;
}

interface GitHubReleaseResponse {
	tag_name?: string;
	assets?: GitHubReleaseAsset[];
}

export interface ReleaseAsset {
	name: string;
	url: string;
}

export interface ReleaseInfo {
	version: string;
	assets: ReleaseAsset[];
}

export interface ReleaseHistoryEntry {
	version: string;
	/** GitHub release 본문(마크다운) — release.yml이 `gh release create --generate-notes`로 자동 생성. */
	body: string;
	publishedAt: string;
}

interface GitHubReleaseListItem {
	tag_name?: string;
	body?: string | null;
	published_at?: string | null;
}

/** GitHub 릴리즈 내역(버전 + 노트)을 최신순으로 가져온다. 실패 시 null. */
export async function fetchReleaseHistory(limit = 15): Promise<ReleaseHistoryEntry[] | null> {
	const res = await requestUrl({
		url: `https://api.github.com/repos/${REPO}/releases?per_page=${limit}`,
		method: 'GET',
		throw: false,
	});
	if (res.status < 200 || res.status >= 300) return null;

	const data = res.json as GitHubReleaseListItem[];
	if (!Array.isArray(data)) return null;

	return data
		.filter((r) => r.tag_name)
		.map((r) => ({
			version: (r.tag_name ?? '').replace(/^v/, ''),
			body: r.body ?? '',
			publishedAt: r.published_at ?? '',
		}));
}

/** GitHub의 최신 릴리즈 정보를 가져온다. 실패(네트워크 오류, 릴리즈 없음 등) 시 null. */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
	const res = await requestUrl({
		url: `https://api.github.com/repos/${REPO}/releases/latest`,
		method: 'GET',
		throw: false,
	});
	if (res.status < 200 || res.status >= 300) return null;

	const data = res.json as GitHubReleaseResponse;
	if (!data.tag_name) return null;

	return {
		version: data.tag_name.replace(/^v/, ''),
		assets: (data.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url })),
	};
}

/** semver(x.y.z) 비교. latest가 current보다 크면 true. */
export function isNewerVersion(latest: string, current: string): boolean {
	const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
	const b = current.split('.').map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x > y) return true;
		if (x < y) return false;
	}
	return false;
}

const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];

/** 릴리즈 에셋(main.js/manifest.json/styles.css)을 내려받아 플러그인 폴더에 덮어쓴다. */
export async function installRelease(app: App, pluginDir: string, release: ReleaseInfo): Promise<void> {
	for (const fileName of RELEASE_FILES) {
		const asset = release.assets.find((a) => a.name === fileName);
		if (!asset) continue;

		const res = await requestUrl({ url: asset.url, method: 'GET', throw: false });
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`${fileName} 다운로드 실패 (${res.status})`);
		}
		await app.vault.adapter.write(`${pluginDir}/${fileName}`, res.text);
	}
}
