import { Editor, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile, TFolder, requestUrl, setTooltip } from 'obsidian';
import { BlogConfig, DEFAULT_SETTINGS, RamenPluginSettings, RamenSettingTab } from './settings';
import { AttachmentPreviewManager } from './attachment-preview';
import { CommentPreviewManager } from './comment-preview';
import { InsertImageModal } from './commands/insert-image/InsertImageModal';
import { AllCommentsModal } from './commands/all-comments/AllCommentsModal';
import { deletedPostDoc, fileToPostDoc, isInTrashbin, publishToBlog, pushFileLive, slugFromPath, syncBlog } from './sync';
import { PullModal } from './commands/pull/PullModal';
import { HTML_EDITOR_VIEW_TYPE, HtmlEditorView, autoSwapToHtmlEditorIfNeeded, isHtmlModeFile, swapLeafToHtmlEditor, switchToMarkdownTemporarily } from './commands/html-editor/HtmlEditorView';
import { PublishModal } from './commands/publish/PublishModal';
import { ReconnectModal } from './commands/reconnect/ReconnectModal';
import { normalizeBlogUrl, persistBlogConnection } from './settings/blogs/blog';
import { t } from './i18n';
import { debugLog, setDebugMode } from './logger';
import { fetchLatestRelease, installRelease, isNewerVersion } from './update-checker';

export default class RamenPlugin extends Plugin {
	settings!: RamenPluginSettings;
	attachmentPreview!: AttachmentPreviewManager;
	commentPreview!: CommentPreviewManager;

	private _modifyTimers = new Map<string, number>();
	private _pullingPaths = new Set<string>();
	private _attachmentFolderStyleSheet: CSSStyleSheet | null = null;
	private _publishedMarkerStyleSheet: CSSStyleSheet | null = null;
	private _publishedMarkerTimer: number | null = null;
	/** path → 공개(published)된 블로그 label. 서버에서 검증된 파일만 포함 (hover 툴팁용) */
	private _publishedByPath = new Map<string, string>();
	/** path → 업로드는 됐지만 아직 비공개(draft)인 블로그 label */
	private _uploadedOnlyByPath = new Map<string, string>();
	/** path → 실제로 공개(published) 상태인 블로그 id 집합. 파일 경로가 겹치는 블로그별 상태 구분용 */
	private _publishedBlogIdsByPath = new Map<string, Set<string>>();
	/** path → 업로드는 됐지만 비공개(draft)인 블로그 id 집합 */
	private _uploadedOnlyBlogIdsByPath = new Map<string, Set<string>>();
	/** 블로그별 마지막 동기화 실패 알림 시각 (스팸 방지) */
	private _lastSyncFailureNoticeAt = new Map<string, number>();
	/** 이번 세션에서 서버 검증에 성공한 블로그 rootFolder 집합. 검증된 블로그는 frontmatter 대신 서버 응답을 신뢰함 */
	private _verifiedBlogRoots = new Set<string>();
	/** "HTML 모드로 전환" 아이콘을 이미 추가한 MarkdownView 인스턴스 (같은 leaf가 재사용될 때 중복 추가 방지) */
	private _markdownViewsWithHtmlModeAction = new WeakSet<MarkdownView>();

	async onload() {
		await this.loadSettings();
		this.applyAttachmentFolderHiding();

		this.attachmentPreview = new AttachmentPreviewManager(this);
		this.attachmentPreview.register();

		this.commentPreview = new CommentPreviewManager(this);
		this.commentPreview.register();

		this.addSettingTab(new RamenSettingTab(this.app, this));

		this.registerView(
			HTML_EDITOR_VIEW_TYPE,
			(leaf) => new HtmlEditorView(leaf, this.settings.language, this.settings.htmlEditorDefaultTab),
		);

		this.addCommand({
			id: 'insert-image',
			name: t(this.settings.language, 'cmdInsertImage'),
			editorCallback: (editor: Editor) => {
				new InsertImageModal(this.app, editor, this.settings.language).open();
			},
		});

		this.addCommand({
			id: 'view-all-comments',
			name: t(this.settings.language, 'cmdViewAllComments'),
			callback: () => {
				new AllCommentsModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'sync-posts',
			name: t(this.settings.language, 'cmdSyncPosts'),
			callback: () => { void this.runFullSync(); },
		});

		this.addCommand({
			id: 'reconnect-blog',
			name: t(this.settings.language, 'cmdReconnectBlog'),
			callback: () => {
				const blogs = this.settings.blogs.filter(b => b.link && b.password);
				if (!blogs.length) return;
				new ReconnectModal(
					this.app,
					blogs,
					(blogId, connectedAt) => {
						this.settings.blogs = this.settings.blogs.map(b =>
							b.id === blogId ? { ...b, connectedAt } : b
						);
						void this.saveSettings();
					},
					this.settings.language,
				).open();
			},
		});

		this.addCommand({
			id: 'pull-posts',
			name: t(this.settings.language, 'cmdPullPosts'),
			callback: () => {
				const blogs = this.settings.blogs.filter(b => b.link && b.password);
				if (!blogs.length) return;
				new PullModal(
					this.app,
					blogs,
					(path) => this._pullingPaths.add(path),
					this.settings.language,
				).open();
			},
		});

		// 로컬이 서버보다 최신으로 판단되면 일반 pull은 건드리지 않는 파일도 무조건 덮어씀.
		// banner/임베드 이미지 링크가 과거 버전에서 이미 /uploads/... URL로 오염된 기존 파일을 복구하는 용도.
		this.addCommand({
			id: 'force-pull-posts',
			name: t(this.settings.language, 'cmdForcePullPosts'),
			callback: () => {
				const blogs = this.settings.blogs.filter(b => b.link && b.password);
				if (!blogs.length) return;
				new Notice(t(this.settings.language, 'forcePullWarning'), 8000);
				new PullModal(
					this.app,
					blogs,
					(path) => this._pullingPaths.add(path),
					this.settings.language,
					true,
				).open();
			},
		});

		this.addCommand({
			id: 'check-for-updates',
			name: t(this.settings.language, 'cmdCheckForUpdates'),
			callback: () => { void this.checkForUpdates({ force: true }); },
		});

		// html_mode 노트를 보여주는 leaf가 활성화될 때마다(파일 탐색기 클릭, 탭 전환, 링크 이동, split 등)
		// 기본 마크다운 보기 대신 HTML 편집기로 자동 전환. file-open보다 active-leaf-change가 항상 실제
		// leaf를 직접 넘겨줘서 어떤 leaf를 바꿔야 할지 다시 찾을 필요가 없고 더 확실하게 잡힘.
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf) return;
				if (leaf.view instanceof MarkdownView) this.ensureHtmlModeAction(leaf.view);
				void autoSwapToHtmlEditorIfNeeded(leaf, this.settings.htmlEditorAutoSwitch);
			}),
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
				if (this._pullingPaths.has(file.path)) return;

				const existing = this._modifyTimers.get(file.path);
				if (existing) window.clearTimeout(existing);
				this._modifyTimers.set(
					file.path,
					window.setTimeout(() => {
						this._modifyTimers.delete(file.path);
						void this.syncModifiedFile(file);
					}, 500),
				);
			}),
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.path.endsWith('.md')) {
					void this.syncRenamedFile(file, oldPath);
					return;
				}
				// 폴더 이동/이름변경 — Obsidian은 폴더 자체에 대해서만 'rename'을 한 번 발생시키고
				// 안의 파일들에 대해선 개별 이벤트를 주지 않으므로, 폴더 안 모든 md 파일을 직접 순회해야 함.
				if (file instanceof TFolder) {
					void this.syncRenamedFolder(file, oldPath);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile) || !file.path.endsWith('.md')) return;
				void this.syncDeletedFile(file);
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void (async () => {
				await this.tryConnectBlogsAtStartup();
				void this.runFullSync({ startup: true });
				this.applyPublishedFileMarkers();
				await this.refreshUploadedFromServer();
			})();
			void this.checkForUpdates();
			// Obsidian 재시작 등으로 html_mode 노트가 이미 마크다운 탭으로 열려있는 채로 시작한 경우도 전환.
			for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
				if (leaf.view instanceof MarkdownView) this.ensureHtmlModeAction(leaf.view);
				void autoSwapToHtmlEditorIfNeeded(leaf, this.settings.htmlEditorAutoSwitch);
			}
		});

		this.registerDomEvent(document, 'mouseover', (evt: MouseEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- eslint's type info disagrees with `tsc`/`bun run build` here; closest() resolves to Element without this cast and fails the actual build (setTooltip expects HTMLElement).
			const target = (evt.target as HTMLElement).closest?.('.nav-file-title[data-path]') as HTMLElement | null;
			if (!target) return;
			const path = target.getAttribute('data-path');
			if (!path) return;
			const publishedLabel = this._publishedByPath.get(path);
			if (publishedLabel) {
				setTooltip(target, t(this.settings.language, 'tooltipPublishedAt', { label: publishedLabel }), { placement: 'right' });
				return;
			}
			const uploadedLabel = this._uploadedOnlyByPath.get(path);
			if (uploadedLabel) setTooltip(target, t(this.settings.language, 'tooltipUploadedAt', { label: uploadedLabel }), { placement: 'right' });
		});

		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				if (this._publishedMarkerTimer) window.clearTimeout(this._publishedMarkerTimer);
				this._publishedMarkerTimer = window.setTimeout(() => {
					this._publishedMarkerTimer = null;
					this.applyPublishedFileMarkers();
				}, 1000);
			}),
		);

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, abstractFile: TAbstractFile, _source: string, leaf) => {
				if (!(abstractFile instanceof TFile) || !abstractFile.path.endsWith('.md')) return;
				const blogs = this.blogsForPath(abstractFile.path).filter(b => b.link && b.password && b.connectedAt);

				// 블로그 발행/비공개/삭제 항목 — 연결된 블로그가 있는 파일에서만. 아래 html_mode 관련
				// 항목들은 블로그 연결 여부와 무관하게 항상 나와야 하므로 여기서 return하지 않고 분리.
				if (blogs.length > 0) {
					const fm = this.app.metadataCache.getFileCache(abstractFile)?.frontmatter;
					const fmPublished = fm?.published === true || fm?.published === 1;

					// 블로그별 공개 상태 판단: 서버 검증된 블로그는 published 블로그 id 집합을 신뢰,
					// 아직 검증 안 된 블로그는 frontmatter로 대체 (applyPublishedFileMarkers와 동일한 규칙).
					const publishedBlogIds = this._publishedBlogIdsByPath.get(abstractFile.path);
					const privateBlogs = blogs.filter(blog => {
						const root = blog.rootFolder.replace(/\/+$/, '');
						const verified = root !== '' && this._verifiedBlogRoots.has(root);
						const isPublished = verified ? (publishedBlogIds?.has(blog.id) ?? false) : fmPublished;
						return !isPublished;
					});
					const publishedBlogs = blogs.filter(blog => !privateBlogs.includes(blog));

					menu.addSeparator();

					if (privateBlogs.length > 0) {
						menu.addItem(item => item
							.setTitle(t(this.settings.language, 'menuSwitchToPublic'))
							.setIcon('upload')
							.onClick(() => void this.togglePostPublished(abstractFile, privateBlogs, true))
						);
					}
					if (publishedBlogs.length > 0) {
						menu.addItem(item => item
							.setTitle(t(this.settings.language, 'menuSwitchToPrivate'))
							.setIcon('eye-off')
							.onClick(() => void this.togglePostPublished(abstractFile, publishedBlogs, false))
						);
					}

					menu.addItem(item => item
						.setTitle(t(this.settings.language, 'menuRemoveFromBlog'))
						.setIcon('trash-2')
						.onClick(() => void this.removePostFromBlog(abstractFile, blogs))
					);
				}

				menu.addSeparator();

				const htmlMode = isHtmlModeFile(this.app, abstractFile);
				menu.addItem(item => item
					.setTitle(t(this.settings.language, htmlMode ? 'menuSwitchToMarkdownMode' : 'menuSwitchToHtmlMode'))
					.setIcon('code')
					.onClick(() => void this.toggleHtmlMode(abstractFile, !htmlMode))
				);

				// html_mode는 켠 채로, 지금 화면만 잠깐 마크다운으로 봄(속성 편집 등). HTML 편집기로 보고
				// 있는 leaf에서만 의미가 있음 (미리보기 분할은 그 뷰 헤더의 전용 아이콘으로 제공 — 이 메뉴는
				// 뷰 안에서 여는 core "..."에서는 뜨지 않아서 옮김: HtmlEditorView.showSplitPreviewMenu 참고).
				if (leaf && leaf.view.getViewType() === HTML_EDITOR_VIEW_TYPE) {
					menu.addItem(item => item
						.setTitle(t(this.settings.language, 'htmlEditorOpenAsMarkdown'))
						.setIcon('file-text')
						.onClick(() => void switchToMarkdownTemporarily(leaf, abstractFile.path))
					);
				}
			}),
		);
	}

	onunload() {
		this.attachmentPreview.unload();
		this.commentPreview.unload();
		for (const t of this._modifyTimers.values()) window.clearTimeout(t);
		if (this._publishedMarkerTimer) window.clearTimeout(this._publishedMarkerTimer);
		this.removeAdoptedStyleSheet(this._attachmentFolderStyleSheet);
		this._attachmentFolderStyleSheet = null;
		this.removeAdoptedStyleSheet(this._publishedMarkerStyleSheet);
		this._publishedMarkerStyleSheet = null;
	}

	/**
	 * Vault 콘텐츠(파일 경로 등)에 따라 동적으로 바뀌는 CSS 규칙을,
	 * 정적 styles.css로 담을 수 없어 constructable stylesheet로 주입한다.
	 * (`document.createElement('style')` 대신 `adoptedStyleSheets` 사용 — DOM에 새 엘리먼트를 붙이지 않는다.)
	 */
	private addAdoptedStyleSheet(css: string): CSSStyleSheet {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(css);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
		return sheet;
	}

	private removeAdoptedStyleSheet(sheet: CSSStyleSheet | null) {
		if (!sheet) return;
		document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
	}

	applyAttachmentFolderHiding() {
		this.removeAdoptedStyleSheet(this._attachmentFolderStyleSheet);
		this._attachmentFolderStyleSheet = null;

		if (!this.settings.hideAttachmentFolder) {
			debugLog('[ramen] attachment folder hiding: 비활성화');
			return;
		}

		// Obsidian 첨부파일 경로 설정
		// ""  → vault 루트
		// "." → 현재 파일과 같은 폴더
		// "./name" → 현재 파일 기준 하위 폴더
		// "path/to/folder" → vault 기준 절대 경로
		const vaultConfig = this.app.vault as unknown as { getConfig(key: string): unknown };
		const obsidianPath = (vaultConfig.getConfig('attachmentFolderPath') as string | undefined) ?? '';

		const blogRoots = this.settings.blogs
			.map(b => b.rootFolder.replace(/\/+$/, ''))
			.filter(Boolean);

		if (blogRoots.length === 0) {
			debugLog('[ramen] attachment folder hiding: rootFolder 설정된 블로그 없음, 스킵');
			return;
		}

		const targetPaths: string[] = [];

		if (!obsidianPath || obsidianPath === '/' || obsidianPath === '.') {
			// vault 루트 또는 현재 파일 폴더 → 특정 폴더 식별 불가, 무시
			debugLog(`[ramen] attachment folder hiding: Obsidian 첨부 경로="${obsidianPath}" (vault 루트/동일 폴더), 무시`);
			return;
		} else if (obsidianPath.startsWith('./')) {
			// subfolder 모드: 각 블로그 rootFolder 아래에 해당 폴더가 생김
			const subName = obsidianPath.slice(2);
			for (const root of blogRoots) {
				targetPaths.push(`${root}/${subName}`);
			}
			debugLog(`[ramen] attachment folder hiding: subfolder 모드 ("${obsidianPath}") → ${targetPaths.join(', ')}`);
		} else {
			// 절대 경로 모드: 블로그 rootFolder 내부일 때만 숨김
			for (const root of blogRoots) {
				if (obsidianPath === root || obsidianPath.startsWith(root + '/')) {
					targetPaths.push(obsidianPath);
					debugLog(`[ramen] attachment folder hiding: 절대 경로 모드 "${obsidianPath}" → 블로그 root "${root}" 내부, 숨김 적용`);
				} else {
					debugLog(`[ramen] attachment folder hiding: 절대 경로 모드 "${obsidianPath}" → 블로그 root "${root}" 외부, 무시`);
				}
			}
		}

		if (targetPaths.length === 0) return;

		const uniquePaths = [...new Set(targetPaths)];

		// 실제 DOM에서 매칭 여부 확인
		for (const p of uniquePaths) {
			const el = document.querySelector(`.nav-folder > div[data-path="${p}"]`);
			debugLog(`[ramen] attachment folder hiding: DOM 확인 → "${p}" ${el ? '✓ 요소 발견' : '✗ 요소 없음 (아직 렌더링 전이거나 경로 불일치)'}`);
			if (!el) {
				const allFolders = document.querySelectorAll('.nav-folder > div[data-path]');
				const samples = Array.from(allFolders).slice(0, 5).map(f => f.getAttribute('data-path'));
				debugLog(`[ramen]   → DOM의 data-path 샘플:`, samples);
			}
		}

		const rules = uniquePaths.map(p =>
			`.nav-folder:has(> div[data-path="${p}"]) { display: none !important; }`
		);
		debugLog('[ramen] attachment folder hiding: 주입할 CSS →\n' + rules.join('\n'));
		this._attachmentFolderStyleSheet = this.addAdoptedStyleSheet(rules.join('\n'));
	}

	applyPublishedFileMarkers() {
		this.removeAdoptedStyleSheet(this._publishedMarkerStyleSheet);
		this._publishedMarkerStyleSheet = null;

		const rules: string[] = [];

		for (const blog of this.settings.blogs) {
			const root = blog.rootFolder.replace(/\/+$/, '');
			if (!root) continue;

			const files = this.app.vault.getMarkdownFiles()
				.filter(f => f.path.startsWith(root + '/'));

			const verified = this._verifiedBlogRoots.has(root);
			debugLog(`[ramen] marker: ${root} → ${files.length}개 파일 검사 (서버 검증: ${verified ? 'O' : 'X, frontmatter로 대체'})`);

			for (const file of files) {
				let isPublished = false;
				let isUploadedOnly = false;
				if (verified) {
					// 서버가 신뢰할 수 있는 소스: frontmatter가 낡았어도 실제 공개/업로드 상태를 따름
					isPublished = this._publishedByPath.has(file.path);
					isUploadedOnly = !isPublished && this._uploadedOnlyByPath.has(file.path);
				} else {
					const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as { published?: boolean | number } | undefined;
					const pub = fm?.published;
					if (pub !== undefined) {
						debugLog(`[ramen] marker: ${file.path} published=${JSON.stringify(pub)} (${typeof pub})`);
					}
					isPublished = pub === true || pub === 1;
				}
				if (isPublished) {
					rules.push(
						`.nav-file-title[data-path="${file.path}"] .nav-file-title-content::after {` +
						` content: " ✓"; color: #4ade80; font-weight: bold; }`
					);
				} else if (isUploadedOnly) {
					rules.push(
						`.nav-file-title[data-path="${file.path}"] .nav-file-title-content::after {` +
						` content: " ●"; color: var(--text-faint); font-weight: bold; }`
					);
				}
			}
		}

		debugLog(`[ramen] marker: 생성된 rules ${rules.length}개`);
		if (rules.length === 0) return;

		this._publishedMarkerStyleSheet = this.addAdoptedStyleSheet(rules.join('\n'));
	}

	/**
	 * 연결된 블로그마다 서버에 실제로 존재하는 포스트(slug/published)를 받아와
	 * 로컬 vault 파일과 대조한 뒤 체크표시(공개)/업로드전용 표시를 최신화한다.
	 * frontmatter는 pull 누락이나 웹앱에서의 변경 등으로 낡을 수 있으므로,
	 * 검증된 블로그에 한해 이 서버 응답을 신뢰 가능한 소스로 사용한다.
	 */
	private async refreshUploadedFromServer(): Promise<void> {
		const blogs = this.settings.blogs.filter(b => b.link && b.password && b.connectedAt);
		if (!blogs.length) return;

		const newPublished = new Map<string, string>();
		const newUploadedOnly = new Map<string, string>();
		const newVerifiedRoots = new Set<string>();
		const newPublishedBlogIds = new Map<string, Set<string>>();
		const newUploadedOnlyBlogIds = new Map<string, Set<string>>();

		for (const blog of blogs) {
			const root = blog.rootFolder.replace(/\/+$/, '');
			if (!root) continue;
			const label = blog.rootFolder || blog.link;

			try {
				const base = normalizeBlogUrl(blog.link);
				const res = await requestUrl({
					url: `${base}/api/posts/slugs`,
					method: 'GET',
					headers: { Authorization: `Bearer ${blog.password}` },
					throw: false,
				});
				if (res.status !== 200) {
					debugLog(`[ramen] uploaded 확인 실패 (${res.status}): ${label}`);
					continue;
				}

				const posts = res.json as Array<{ slug: string; published: boolean }>;
				const publishedSlugs = new Set(posts.filter(p => p.published).map(p => p.slug));
				const uploadedSlugs = new Set(posts.map(p => p.slug));
				newVerifiedRoots.add(root);

				const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(root + '/'));
				let publishedCount = 0;
				let uploadedOnlyCount = 0;
				for (const file of files) {
					const slug = slugFromPath(file.path, blog.rootFolder);
					if (publishedSlugs.has(slug)) {
						newPublished.set(file.path, label);
						publishedCount++;
						if (!newPublishedBlogIds.has(file.path)) newPublishedBlogIds.set(file.path, new Set());
						newPublishedBlogIds.get(file.path)!.add(blog.id);
					} else if (uploadedSlugs.has(slug)) {
						newUploadedOnly.set(file.path, label);
						uploadedOnlyCount++;
						if (!newUploadedOnlyBlogIds.has(file.path)) newUploadedOnlyBlogIds.set(file.path, new Set());
						newUploadedOnlyBlogIds.get(file.path)!.add(blog.id);
					}
				}
				debugLog(`[ramen] uploaded 확인 완료: ${label} → 서버 ${posts.length}개 중 공개 ${publishedCount}개 / 업로드전용(비공개) ${uploadedOnlyCount}개 매칭`);
			} catch (e) {
				debugLog(`[ramen] uploaded 확인 오류: ${label}`, e);
			}
		}

		this._publishedByPath = newPublished;
		this._uploadedOnlyByPath = newUploadedOnly;
		this._verifiedBlogRoots = newVerifiedRoots;
		this._publishedBlogIdsByPath = newPublishedBlogIds;
		this._uploadedOnlyBlogIdsByPath = newUploadedOnlyBlogIds;
		this.applyPublishedFileMarkers();
	}

	private blogsForPath(filePath: string) {
		return this.settings.blogs.filter(b => {
			const root = b.rootFolder.replace(/\/+$/, '');
			if (!root || !filePath.startsWith(root + '/')) return false;
			// .trashbin 안 파일은 pull이 보관해둔 것 — 다시 push되면 삭제가 무효화되므로 제외
			if (isInTrashbin(filePath, b.rootFolder)) return false;
			return true;
		});
	}

	private async syncModifiedFile(file: TFile) {
		for (const blog of this.blogsForPath(file.path)) {
			try {
				await pushFileLive(this.app, blog, file, this.settings.language);
			} catch (e) {
				const name = blog.rootFolder || blog.link;
				console.error(`[ramen] live push 실패 (${name}):`, e);
				this.notifySyncFailure(blog, String(e));
			}
		}
	}

	// 같은 블로그에 대해 짧은 시간 내 반복되는 실패 알림(타이핑 중 연속 실패 등) 스팸 방지.
	private notifySyncFailure(blog: BlogConfig, message: string): void {
		const now = Date.now();
		const last = this._lastSyncFailureNoticeAt.get(blog.id) ?? 0;
		if (now - last < 30_000) return;
		this._lastSyncFailureNoticeAt.set(blog.id, now);
		const name = blog.rootFolder || blog.link;
		new Notice(t(this.settings.language, 'noticeSyncFailed', { name, message }), 6000);
	}

	private async syncRenamedFile(file: TFile, oldPath: string, silent = false) {
		// 파일 탐색기 체크표시(✓/●)도 옛 경로 키를 새 경로로 옮겨야 이동 직후 사라지지 않음
		if (this._publishedByPath.has(oldPath)) {
			this._publishedByPath.set(file.path, this._publishedByPath.get(oldPath)!);
			this._publishedByPath.delete(oldPath);
			this.applyPublishedFileMarkers();
		} else if (this._uploadedOnlyByPath.has(oldPath)) {
			this._uploadedOnlyByPath.set(file.path, this._uploadedOnlyByPath.get(oldPath)!);
			this._uploadedOnlyByPath.delete(oldPath);
			this.applyPublishedFileMarkers();
		}
		if (this._publishedBlogIdsByPath.has(oldPath)) {
			this._publishedBlogIdsByPath.set(file.path, this._publishedBlogIdsByPath.get(oldPath)!);
			this._publishedBlogIdsByPath.delete(oldPath);
		}
		if (this._uploadedOnlyBlogIdsByPath.has(oldPath)) {
			this._uploadedOnlyBlogIdsByPath.set(file.path, this._uploadedOnlyBlogIdsByPath.get(oldPath)!);
			this._uploadedOnlyBlogIdsByPath.delete(oldPath);
		}

		const affectedBlogs = new Set([
			...this.blogsForPath(file.path),
			...this.blogsForPath(oldPath),
		]);
		debugLog(`[ramen] 파일 이동/이름변경 감지: "${oldPath}" → "${file.path}" (매칭 블로그 ${affectedBlogs.size}개)`);
		if (affectedBlogs.size === 0) return;

		const now = new Date().toISOString();
		let successCount = 0;
		for (const blog of affectedBlogs) {
			try {
				const root = blog.rootFolder.replace(/\/+$/, '');
				const extraDocs = [];

				// 이전 slug 삭제
				if (oldPath.startsWith(root + '/')) {
					extraDocs.push(deletedPostDoc(
						slugFromPath(oldPath, blog.rootFolder),
						oldPath.split('/').pop()?.replace(/\.md$/, '') ?? '',
					));
				}

				// 새 slug 즉시 push — rename은 mtime이 바뀌지 않아 syncBlog의 checkpoint 필터에서 누락됨
				if (file.path.startsWith(root + '/')) {
					const newDoc = await fileToPostDoc(this.app, file, blog, undefined, this.settings.language);
					if (newDoc) {
						newDoc.updated_at = now;
						extraDocs.push(newDoc);
					}
				}

				await syncBlog(this.app, blog, extraDocs, undefined, this.settings.language);
				successCount++;
			} catch (e) {
				console.error('[ramen] rename sync failed:', e);
				this.notifySyncFailure(blog, String(e));
			}
		}
		if (successCount > 0 && !silent) {
			new Notice(t(this.settings.language, 'noticeMoveApplied', { name: file.basename }), 3000);
		}
	}

	// 폴더 이동/이름변경 시, 새 폴더 경로 아래 모든 md 파일을 옛 경로로부터 rename된 것처럼 처리.
	private async syncRenamedFolder(folder: TFolder, oldFolderPath: string): Promise<void> {
		const newFolderPath = folder.path;
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(newFolderPath + '/'));
		debugLog(`[ramen] 폴더 이동 감지: "${oldFolderPath}" → "${newFolderPath}" (md 파일 ${files.length}개)`);
		if (files.length === 0) return;
		for (const file of files) {
			const oldPath = oldFolderPath + file.path.slice(newFolderPath.length);
			await this.syncRenamedFile(file, oldPath, true);
		}
		new Notice(t(this.settings.language, 'noticeFolderMoveApplied', { count: files.length }), 4000);
	}

	private async syncDeletedFile(file: TFile) {
		for (const blog of this.blogsForPath(file.path)) {
			try {
				const slug = slugFromPath(file.path, blog.rootFolder);
				await syncBlog(this.app, blog, [deletedPostDoc(slug, file.basename)]);
			} catch (e) {
				console.error('[ramen] delete sync failed:', e);
				this.notifySyncFailure(blog, String(e));
			}
		}
	}

	async runFullSync({ startup = false }: { startup?: boolean } = {}) {
		const blogs = this.settings.blogs.filter(b => b.link && b.password && b.connectedAt);
		if (!blogs.length) {
			if (startup) debugLog('[ramen] 시작 시 자동 sync: 연결된 블로그 없음, 스킵');
			return;
		}
		if (startup) debugLog(`[ramen] 시작 시 자동 sync 시작 (${blogs.length}개 블로그)`);
		for (const blog of blogs) {
			debugLog(`[ramen] sync 시작: ${blog.rootFolder || blog.link}`);
			try {
				await syncBlog(this.app, blog, [], (path) => this._pullingPaths.add(path), this.settings.language);
				debugLog(`[ramen] sync 완료: ${blog.rootFolder || blog.link}`);
			} catch (e) {
				console.error(`[ramen] sync 실패: ${blog.rootFolder || blog.link}`, e);
			}
		}
		if (startup) debugLog('[ramen] 시작 시 자동 sync 완료');
	}

	async loadSettings() {
		const saved = await this.loadData() as Partial<RamenPluginSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		setDebugMode(this.settings.debugMode);
		this.settings.blogs = this.settings.blogs.map(b => {
			const migrated = !b.attachmentFolder;
			const blog = { ...b, attachmentFolder: b.attachmentFolder || 'attachments' };
			if (migrated) debugLog(`[ramen] loadSettings: attachmentFolder 기본값 적용 → ${blog.rootFolder || blog.id}`);
			return blog;
		});
		debugLog(`[ramen] loadSettings 완료: 블로그 ${this.settings.blogs.length}개, hideAttachmentFolder=${this.settings.hideAttachmentFolder}`);
	}

	private async tryConnectBlogsAtStartup(): Promise<void> {
		const pending = this.settings.blogs.filter(b => b.link && b.password && !b.connectedAt);
		if (!pending.length) return;

		let changed = false;
		for (const blog of pending) {
			try {
				const base = normalizeBlogUrl(blog.link);
				const res = await requestUrl({
					url: `${base}/api/posts`,
					method: 'GET',
					headers: { Authorization: `Bearer ${blog.password}` },
					throw: false,
				});
				if (res.status >= 200 && res.status < 300) {
					this.settings.blogs = this.settings.blogs.map(b =>
						b.id === blog.id ? { ...b, link: base, connectedAt: new Date().toISOString() } : b
					);
					persistBlogConnection(blog.rootFolder, base, blog.password);
					debugLog(`[ramen] startup connect 성공: ${blog.rootFolder || blog.link}`);
					changed = true;
				} else {
					debugLog(`[ramen] startup connect 실패 (${res.status}): ${blog.rootFolder || blog.link}`);
				}
			} catch (e) {
				debugLog(`[ramen] startup connect 오류: ${blog.rootFolder || blog.link}`, e);
			}
		}
		if (changed) await this.saveSettings();
	}

	/**
	 * 검증된 블로그는 published/uploaded-only 기록을 신뢰(정확한 참/거짓).
	 * 한 번도 기록이 없는 미검증 블로그는 유실 방지를 위해 공개 상태로 간주.
	 */
	private isBlogPublishedForFile(filePath: string, blog: BlogConfig): boolean {
		if (this._publishedBlogIdsByPath.get(filePath)?.has(blog.id)) return true;
		if (this._uploadedOnlyBlogIdsByPath.get(filePath)?.has(blog.id)) return false;
		const root = blog.rootFolder.replace(/\/+$/, '');
		const verified = root !== '' && this._verifiedBlogRoots.has(root);
		return !verified;
	}

	/** 이 파일에 연결된 블로그 중 하나라도 공개 상태면 frontmatter published를 유지, 아니면 제거. */
	private async syncPublishedFrontmatter(file: TFile): Promise<void> {
		const connected = this.blogsForPath(file.path).filter(b => b.link && b.password && b.connectedAt);
		const anyPublished = connected.some(b => this.isBlogPublishedForFile(file.path, b));
		await this.app.fileManager.processFrontMatter(file, (fm: { published?: boolean }) => {
			if (anyPublished) {
				fm.published = true;
			} else {
				delete fm.published;
			}
		});
	}

	private async togglePostPublished(file: TFile, blogs: BlogConfig[], publish: boolean): Promise<void> {
		// 실제로 서버 반영에 성공한 블로그만 마커/툴팁/frontmatter에 반영.
		// (재빌드/네트워크 오류 등으로 실패하면 아무 상태도 건드리지 않음 — 이전엔 결과와 무관하게
		//  frontmatter를 먼저 지워버려서, 실패해도 published가 사라지는 문제가 있었음)
		const applyResult = (blog: BlogConfig, ok: boolean) => {
			if (!ok) return;
			const label = blog.rootFolder || blog.link;
			if (publish) {
				this._publishedByPath.set(file.path, label);
				this._uploadedOnlyByPath.delete(file.path);
				this._uploadedOnlyBlogIdsByPath.get(file.path)?.delete(blog.id);
				if (!this._publishedBlogIdsByPath.has(file.path)) this._publishedBlogIdsByPath.set(file.path, new Set());
				this._publishedBlogIdsByPath.get(file.path)!.add(blog.id);
			} else {
				this._publishedByPath.delete(file.path);
				this._uploadedOnlyByPath.set(file.path, label);
				this._publishedBlogIdsByPath.get(file.path)?.delete(blog.id);
				if (!this._uploadedOnlyBlogIdsByPath.has(file.path)) this._uploadedOnlyBlogIdsByPath.set(file.path, new Set());
				this._uploadedOnlyBlogIdsByPath.get(file.path)!.add(blog.id);
			}
			this.applyPublishedFileMarkers();
			void this.syncPublishedFrontmatter(file);
		};

		// 겹치는 블로그가 여러 개면 어디에 적용할지 선택하게 함.
		if (blogs.length > 1) {
			new PublishModal(this.app, blogs, file, publish, applyResult, this.settings.language).open();
			return;
		}

		const blog = blogs[0];
		if (!blog) return;
		const name = blog.rootFolder || blog.link;
		const notice = new Notice(
			t(this.settings.language, publish ? 'noticeTogglingPublic' : 'noticeTogglingPrivate', { name }),
			0,
		);
		try {
			await publishToBlog(this.app, blog, file, publish, this.settings.language);
			notice.hide();
			new Notice(
				t(this.settings.language, publish ? 'noticeSwitchedToPublic' : 'noticeSwitchedToPrivate'),
				3000,
			);
			applyResult(blog, true);
		} catch (e) {
			notice.hide();
			new Notice(t(this.settings.language, 'noticeToggleFailed', { e: String(e) }), 8000);
			applyResult(blog, false);
		}
	}

	private async removePostFromBlog(file: TFile, blogs: BlogConfig[]): Promise<void> {
		for (const blog of blogs) {
			const name = blog.rootFolder || blog.link;
			const notice = new Notice(t(this.settings.language, 'noticeRemoving', { name }), 0);
			try {
				const base = normalizeBlogUrl(blog.link);
				const slug = slugFromPath(file.path, blog.rootFolder);
				const res = await requestUrl({
					url: `${base}/api/posts/by-slug/${encodeURIComponent(slug)}`,
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${blog.password}`,
					},
					body: JSON.stringify({ deleted: true }),
					throw: false,
				});
				notice.hide();
				if (res.status >= 200 && res.status < 300) {
					new Notice(t(this.settings.language, 'noticeRemoved', { name }), 3000);
					this._publishedByPath.delete(file.path);
					this._uploadedOnlyByPath.delete(file.path);
					this._publishedBlogIdsByPath.get(file.path)?.delete(blog.id);
					this._uploadedOnlyBlogIdsByPath.get(file.path)?.delete(blog.id);
					this.applyPublishedFileMarkers();
				} else {
					new Notice(t(this.settings.language, 'noticeRemoveFailed', { name, status: res.status }), 5000);
				}
			} catch (e) {
				notice.hide();
				new Notice(t(this.settings.language, 'noticeRemoveError', { name, e: String(e) }), 5000);
			}
		}
	}

	/**
	 * frontmatter의 html_mode를 켜고/끄고, 지금 그 파일을 보고 있는 leaf가 있으면 뷰도 즉시 맞춰 바꾼다.
	 * (켤 때: markdown → HTML 편집기, 끌 때: HTML 편집기 → markdown. 다른 파일을 보고 있으면 뷰는 안 건드림 —
	 *  다음에 그 파일을 열 때 autoSwapToHtmlEditorIfNeeded가 알아서 처리함.)
	 */
	private async toggleHtmlMode(file: TFile, enable: boolean): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: { html_mode?: boolean }) => {
			if (enable) fm.html_mode = true;
			else delete fm.html_mode;
		});

		if (enable) {
			const leaf = this.app.workspace.getLeavesOfType('markdown')
				.find(l => l.view instanceof MarkdownView && l.view.file?.path === file.path);
			if (leaf) await swapLeafToHtmlEditor(leaf, file);
		} else {
			const leaf = this.app.workspace.getLeavesOfType(HTML_EDITOR_VIEW_TYPE)
				.find(l => l.view instanceof HtmlEditorView && l.view.file?.path === file.path);
			if (leaf) await leaf.setViewState({ type: 'markdown', state: { file: file.path } });
		}
	}

	/**
	 * 일반 마크다운 뷰에도 HTML 편집기로 넘어갈 수 있는 아이콘을 달아준다 — HTML 편집기 쪽엔
	 * "마크다운으로 보기" 아이콘이 있는데 반대 방향(마크다운 → HTML 모드)은 파일 메뉴에만 있어서
	 * 눈에 잘 안 띄었음. 같은 view 인스턴스에 중복으로 추가되지 않도록 WeakSet으로 추적.
	 */
	private ensureHtmlModeAction(view: MarkdownView): void {
		if (this._markdownViewsWithHtmlModeAction.has(view)) return;
		this._markdownViewsWithHtmlModeAction.add(view);
		const actionEl = view.addAction('code', t(this.settings.language, 'menuSwitchToHtmlMode'), () => {
			if (view.file) void this.toggleHtmlMode(view.file, true);
		});

		// addAction은 네이티브 아이콘들보다 앞(왼쪽)에 꽂힘 — 편집/읽기 모드 전환 아이콘 바로 옆으로 옮김.
		// aria-label로 그 아이콘을 찾아서 바로 뒤에 삽입, 못 찾으면 대충 중간 위치로 폴백.
		const container = actionEl.parentElement;
		if (!container) return;
		const siblings = Array.from(container.children).filter((el) => el !== actionEl);
		const modeToggle = siblings.find((el) => /reading|edit|읽기|편집/i.test(el.getAttribute('aria-label') ?? ''));
		if (modeToggle) {
			modeToggle.insertAdjacentElement('afterend', actionEl);
		} else if (siblings.length > 0) {
			container.insertBefore(actionEl, siblings[Math.floor(siblings.length / 2)] ?? null);
		}
	}

	async saveSettings() {
		setDebugMode(this.settings.debugMode);
		await this.saveData(this.settings);
	}

	/**
	 * GitHub 릴리즈(project-ramen/obsidian)에서 최신 버전을 확인한다.
	 * force가 아니면 `autoUpdateCheck` 설정과 마지막 확인 시각(12시간 쿨다운)을 따르고,
	 * 쿨다운 중이면 이전에 캐시해둔 `latestKnownVersion`을 그대로 반환한다.
	 */
	async checkForUpdates(opts: { force?: boolean } = {}): Promise<{ hasUpdate: boolean; latestVersion: string | null }> {
		const force = opts.force ?? false;

		if (!force) {
			if (!this.settings.autoUpdateCheck) {
				return { hasUpdate: false, latestVersion: this.settings.latestKnownVersion ?? null };
			}
			const elapsed = Date.now() - this.settings.lastUpdateCheckAt;
			if (elapsed < 12 * 60 * 60 * 1000) {
				const cached = this.settings.latestKnownVersion ?? null;
				return { hasUpdate: !!cached && isNewerVersion(cached, this.manifest.version), latestVersion: cached };
			}
		}

		this.settings.lastUpdateCheckAt = Date.now();
		const release = await fetchLatestRelease();
		if (!release) {
			await this.saveSettings();
			if (force) new Notice(t(this.settings.language, 'updateCheckFailed'));
			return { hasUpdate: false, latestVersion: this.settings.latestKnownVersion ?? null };
		}

		this.settings.latestKnownVersion = release.version;
		await this.saveSettings();

		const hasUpdate = isNewerVersion(release.version, this.manifest.version);
		if (hasUpdate) {
			new Notice(t(this.settings.language, 'updateAvailable', { version: release.version }), 8000);
		} else if (force) {
			new Notice(t(this.settings.language, 'updateUpToDate', { version: this.manifest.version }));
		}
		return { hasUpdate, latestVersion: release.version };
	}

	/** 최신 릴리즈의 main.js/manifest.json/styles.css를 내려받아 덮어쓴 뒤 플러그인 재로드를 시도한다. */
	async installUpdate(): Promise<void> {
		const release = await fetchLatestRelease();
		if (!release || !isNewerVersion(release.version, this.manifest.version)) {
			new Notice(t(this.settings.language, 'updateUpToDate', { version: this.manifest.version }));
			return;
		}

		const notice = new Notice(t(this.settings.language, 'updateInstalling', { version: release.version }), 0);
		try {
			const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
			await installRelease(this.app, pluginDir, release);
			notice.hide();
			new Notice(t(this.settings.language, 'updateInstalled', { version: release.version }), 6000);
			await this.reloadPlugin();
		} catch (e) {
			notice.hide();
			new Notice(t(this.settings.language, 'updateFailed', { e: String(e) }), 8000);
		}
	}

	/**
	 * 내부 플러그인 매니저 API(공식 타입 없음)로 재로드를 시도한다.
	 * 실패해도 파일은 이미 갱신됐으므로 조용히 넘어간다 — 사용자가 수동으로 새로고침하면 됨.
	 */
	private async reloadPlugin(): Promise<void> {
		try {
			const internalApp = this.app as unknown as {
				plugins: {
					disablePlugin(id: string): Promise<void>;
					enablePlugin(id: string): Promise<void>;
				};
			};
			await internalApp.plugins.disablePlugin(this.manifest.id);
			await internalApp.plugins.enablePlugin(this.manifest.id);
		} catch (e) {
			debugLog('[ramen] 플러그인 자동 재로드 실패, 수동 새로고침 필요', e);
		}
	}
}
