import React, { useEffect, useRef, useState } from 'react';
import { App, EventRef, FileView, Menu, MarkdownView, Notice, parseYaml, setIcon, SplitDirection, TFile, WorkspaceLeaf } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import { Locale, t } from '../../i18n';
import { HtmlDocParts, joinHtmlDoc, splitHtmlDoc, unwrapHtmlModeBody, wrapHtmlModeBody } from './htmlDocParts';
import { attachBannerImage, resolveBannerFile, resolveBannerSrc } from './bannerMeta';
import { BannerRemoveModal } from './BannerRemoveModal';
import { CodeEditor } from './CodeEditor';
import { blogsForFilePath, deleteServerUpload, forceReuploadImageFile, normalizeTagsValue, pushFileLive } from '../../sync';
import { BlogConfig } from '../../settings/types';

export const HTML_EDITOR_VIEW_TYPE = 'ramen-html-editor';

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

// leaf → 수동으로 "마크다운으로 보기"를 누른 시각. html_mode는 켠 채로 뷰만 바꾸는 거라, 그 직후
// active-leaf-change가 (같은 leaf에 대해) 다시 발생해도 autoSwapToHtmlEditorIfNeeded가 곧바로
// HTML 편집기로 되돌려버리지 않도록 짧게 억제하는 용도.
const manualMarkdownSwitchAt = new WeakMap<WorkspaceLeaf, number>();
const MANUAL_SWITCH_SUPPRESS_MS = 1500;

/** Obsidian 설정 > 편집기 > "줄 번호 표시"와 동일한 값을 읽음 (공식 타입 없는 내부 vault config API). */
function getShowLineNumbersSetting(app: App): boolean {
	const vaultConfig = app.vault as unknown as { getConfig(key: string): unknown };
	return vaultConfig.getConfig('showLineNumber') === true;
}

/**
 * Obsidian 설정 창에서 "줄 번호 표시" 등을 바꾸면 vault가 (공식 타입엔 없는) 'config-changed' 이벤트를
 * 바뀐 설정 키와 함께 쏨 — 실제 앱 코드도 각 에디터 뷰에서 이걸로 실시간 반영함. 우리도 같은 방식으로 구독.
 */
function onVaultConfigChanged(app: App, callback: (key: string) => void): EventRef {
	const vault = app.vault as unknown as { on(name: 'config-changed', cb: (key: string) => void): EventRef };
	return vault.on('config-changed', callback);
}

/** frontmatter 블록(`---\n...\n---\n`) 원문을 파싱해서 title/banner/banner-url/description/tags를 뽑아냄.
 *  render()가 매번 vault.read()로 읽은 원문을 그대로 넘겨주므로 metadataCache의 갱신 지연과
 *  무관하게 항상 지금 디스크 내용과 일치한다.
 *  published(공개 여부)는 여기 넣지 않음 — 단순 로컬 frontmatter 편집이 아니라 연결된 블로그별로
 *  서버에 실제 PATCH 요청까지 보내는 별도 흐름(main.ts togglePostPublished)이라, 이 가벼운 패널이
 *  아니라 기존 파일 메뉴("게시"/"비공개로 전환")를 그대로 씀. category도 frontmatter가 아니라
 *  폴더 경로에서 자동으로 정해지는 값이라 여기서 편집할 대상이 아님. */
function parseFrontmatterMeta(frontmatter: string): HtmlEditorMeta {
	if (!frontmatter) return EMPTY_META;
	const yaml = frontmatter.replace(/^---\n/, '').replace(/\n---\n?$/, '');
	if (!yaml.trim()) return EMPTY_META;
	try {
		const fm = parseYaml(yaml) as Record<string, unknown> | null;
		if (!fm || typeof fm !== 'object') return EMPTY_META;
		return {
			title: typeof fm['title'] === 'string' ? fm['title'] : '',
			banner: typeof fm['banner'] === 'string' ? fm['banner'] : '',
			bannerUrl: typeof fm['banner-url'] === 'string' ? fm['banner-url'] : '',
			description: typeof fm['description'] === 'string' ? fm['description'] : '',
			tagsInput: normalizeTagsValue(fm['tags']).join(', '),
		};
	} catch {
		return EMPTY_META;
	}
}

export type Tab = 'preview' | 'html' | 'css' | 'js';

/** frontmatter의 title/banner/banner-url/description/tags — 값이 없으면 빈 문자열(controlled input용). */
export interface HtmlEditorMeta {
	title: string;
	banner: string;
	bannerUrl: string;
	description: string;
	/** 쉼표로 구분된 입력창 표시용 문자열. 실제 frontmatter tags 배열과의 변환은 persistMeta에서. */
	tagsInput: string;
}

const EMPTY_META: HtmlEditorMeta = { title: '', banner: '', bannerUrl: '', description: '', tagsInput: '' };

interface PanelProps {
	app: App;
	sourcePath: string;
	/** 이 파일이 속한(연결된) 블로그 — "무시하고 다시 업로드" 버튼이 서버에 직접 요청 보낼 대상.
	 *  연결된 블로그가 없으면(html_mode 노트가 아직 어떤 블로그 rootFolder에도 없는 등) null. */
	blog: BlogConfig | null;
	initial: HtmlDocParts;
	meta: HtmlEditorMeta;
	locale: Locale;
	showLineNumbers: boolean;
	/** 탭 상태는 HtmlEditorView(뷰 헤더의 미리보기 아이콘)가 소유 — 패널 안 탭 버튼과 상단 아이콘이 같은 상태를 공유. */
	tab: Tab;
	onTabChange: (tab: Tab) => void;
	onChange: (parts: HtmlDocParts) => void;
	onMetaChange: (patch: Partial<HtmlEditorMeta>) => void;
}

function HtmlEditorPanel({ app, sourcePath, blog, initial, meta, locale, showLineNumbers, tab, onTabChange, onChange, onMetaChange }: PanelProps) {
	const [parts, setParts] = useState<HtmlDocParts>(initial);
	const debounceRef = useRef<number | null>(null);
	const [metaState, setMetaState] = useState<HtmlEditorMeta>(meta);
	const metaDebounceRef = useRef<number | null>(null);
	// 디바운스 타이머가 아직 안 터진 동안 서로 다른 필드(예: 설명 입력 중 배너 링크도 수정)를 잇달아
	// 바꾸면, 매번 새 타이머로 이전 타이머를 취소하면서 그 호출의 patch만 남기면 먼저 바뀐 필드가
	// 저장 안 되고 유실됨 — 그래서 터질 때까지의 patch를 여기 누적해서 한 번에 onMetaChange로 보냄.
	const pendingMetaPatchRef = useRef<Partial<HtmlEditorMeta>>({});
	const [bannerUploading, setBannerUploading] = useState(false);
	const [forceUploading, setForceUploading] = useState(false);
	const bannerFileInputRef = useRef<HTMLInputElement>(null);

	// 다른 파일로 전환되거나(setFile) 외부(pull 등)에서 파일이 바뀌면 편집 중인 내용을 새로 반영
	useEffect(() => {
		setParts(initial);
	}, [initial]);

	useEffect(() => {
		setMetaState(meta);
	}, [meta]);

	useEffect(() => () => {
		if (debounceRef.current) window.clearTimeout(debounceRef.current);
		if (metaDebounceRef.current) window.clearTimeout(metaDebounceRef.current);
	}, []);

	const update = (patch: Partial<HtmlDocParts>) => {
		const next = { ...parts, ...patch };
		setParts(next);
		if (debounceRef.current) window.clearTimeout(debounceRef.current);
		debounceRef.current = window.setTimeout(() => onChange(next), 500);
	};

	const updateMeta = (patch: Partial<HtmlEditorMeta>, immediate = false) => {
		const next = { ...metaState, ...patch };
		setMetaState(next);
		if (metaDebounceRef.current) window.clearTimeout(metaDebounceRef.current);
		if (immediate) {
			pendingMetaPatchRef.current = {};
			onMetaChange(patch);
		} else {
			pendingMetaPatchRef.current = { ...pendingMetaPatchRef.current, ...patch };
			metaDebounceRef.current = window.setTimeout(() => {
				const merged = pendingMetaPatchRef.current;
				pendingMetaPatchRef.current = {};
				onMetaChange(merged);
			}, 500);
		}
	};

	const handleBannerFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		setBannerUploading(true);
		try {
			const link = await attachBannerImage(app, sourcePath, file);
			updateMeta({ banner: link }, true);
		} finally {
			setBannerUploading(false);
		}
	};

	// 로컬 hash 캐시 때문에 같은 파일을 다시 push해도 서버가 재처리 안 하는 경우(예: 서버 업로드
	// 파이프라인이 새로 바뀐 뒤, 예전에 이미 캐시된 배너를 다시 최적화시키고 싶을 때) 강제로 재업로드.
	// 순서가 중요함: 1) 새 파일 업로드(캐시 갱신) 2) 이 노트를 즉시 push해서 서버 DB의 banner가
	// 실제로 새 URL을 가리키게 함 3) 그 다음에야 예전 파일을 지움 — 순서를 안 지키고 먼저 지워버리면
	// DB가 아직 예전 URL을 가리키는 동안 그 파일이 사라져서 라이브 배너가 잠깐 깨짐.
	const handleForceReupload = async () => {
		const bannerFile = resolveBannerFile(app, sourcePath, metaState.banner);
		const noteFile = app.vault.getAbstractFileByPath(sourcePath);
		if (!bannerFile || !blog || !(noteFile instanceof TFile)) return;
		setForceUploading(true);
		try {
			const result = await forceReuploadImageFile(app, blog, bannerFile);
			if (!result) {
				new Notice(t(locale, 'htmlEditorBannerForceReuploadFailed'));
				return;
			}
			await pushFileLive(app, blog, noteFile, locale);
			if (result.previousUrl) void deleteServerUpload(blog, result.previousUrl);
			new Notice(t(locale, 'htmlEditorBannerForceReuploadDone'));
		} catch {
			new Notice(t(locale, 'htmlEditorBannerForceReuploadFailed'));
		} finally {
			setForceUploading(false);
		}
	};

	const bannerSrc = resolveBannerSrc(app, sourcePath, metaState.banner);
	// 로컬 vault 이미지고 연결된 블로그가 있어야 "무시하고 다시 업로드"가 의미 있음
	// (외부 URL이면 재업로드할 로컬 원본이 없고, 블로그가 없으면 어디로 보낼지 알 수 없음).
	const canForceReupload = !!(blog && resolveBannerFile(app, sourcePath, metaState.banner));
	// frontmatter title이 비어있으면 sync.ts도 파일명을 제목으로 씀 — placeholder로 그 기본값을 보여줌.
	const fileBasename = sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? '';

	const handleBannerRemove = () => {
		const bannerFile = resolveBannerFile(app, sourcePath, metaState.banner);
		// 외부 URL(이미 서버에 업로드된 값 등)이라 지울 로컬 파일이 없으면 바로 참조만 제거.
		if (!bannerFile) {
			updateMeta({ banner: '', bannerUrl: '' }, true);
			return;
		}
		new BannerRemoveModal(
			app,
			{
				title: t(locale, 'htmlEditorBannerRemoveTitle'),
				message: t(locale, 'htmlEditorBannerRemoveMessage', { name: bannerFile.name }),
				deleteFileLabel: t(locale, 'htmlEditorBannerRemoveDeleteFile'),
				unlinkOnlyLabel: t(locale, 'htmlEditorBannerRemoveUnlinkOnly'),
				cancelLabel: t(locale, 'cancel'),
			},
			(choice) => {
				if (!choice) return;
				if (choice === 'delete-file') void app.fileManager.trashFile(bannerFile);
				updateMeta({ banner: '', bannerUrl: '' }, true);
			},
		).open();
	};

	// Preview는 탭 바가 아니라 뷰 헤더의 아이콘으로 접근 — 여기 탭 바에는 HTML/CSS/JS만.
	const tabs: { key: Tab; label: string }[] = [
		{ key: 'html', label: 'HTML' },
		{ key: 'css', label: 'CSS' },
		{ key: 'js', label: 'JS' },
	];

	return (
		<div className="ramen-html-editor">
			<div className="ramen-html-editor-meta">
				<div className="ramen-html-editor-meta-field">
					<label htmlFor="ramen-html-editor-title" className="ramen-html-editor-meta-label">
						{t(locale, 'htmlEditorTitleLabel')}
					</label>
					<input
						id="ramen-html-editor-title"
						type="text"
						className="ramen-html-editor-meta-input"
						value={metaState.title}
						placeholder={fileBasename}
						onChange={(e) => updateMeta({ title: e.target.value })}
					/>
				</div>
				<div className="ramen-html-editor-meta-field">
					<span className="ramen-html-editor-meta-label">{t(locale, 'htmlEditorBannerLabel')}</span>
					<div className="ramen-html-editor-meta-banner">
						{bannerSrc ? (
							<img src={bannerSrc} alt="" className="ramen-html-editor-meta-banner-preview" />
						) : (
							<div className="ramen-html-editor-meta-banner-empty">{t(locale, 'htmlEditorBannerNone')}</div>
						)}
						<div className="ramen-html-editor-meta-banner-actions">
							<button
								type="button"
								className="ramen-html-editor-meta-button"
								disabled={bannerUploading}
								onClick={() => bannerFileInputRef.current?.click()}
							>
								{bannerUploading ? t(locale, 'htmlEditorBannerUploading') : metaState.banner ? t(locale, 'htmlEditorBannerChange') : t(locale, 'htmlEditorBannerUpload')}
							</button>
							{canForceReupload && (
								<button
									type="button"
									className="ramen-html-editor-meta-button"
									disabled={forceUploading}
									onClick={() => void handleForceReupload()}
									title={t(locale, 'htmlEditorBannerForceReuploadHint')}
								>
									{forceUploading ? t(locale, 'htmlEditorBannerUploading') : t(locale, 'htmlEditorBannerForceReupload')}
								</button>
							)}
							{metaState.banner && (
								<button
									type="button"
									className="ramen-html-editor-meta-button is-danger"
									onClick={handleBannerRemove}
								>
									{t(locale, 'htmlEditorBannerClear')}
								</button>
							)}
							<input
								ref={bannerFileInputRef}
								type="file"
								accept="image/*"
								className="ramen-html-editor-hidden-input"
								onChange={(e) => void handleBannerFileSelected(e)}
							/>
						</div>
					</div>
				</div>
				{metaState.banner && (
					<div className="ramen-html-editor-meta-field">
						<label htmlFor="ramen-html-editor-banner-url" className="ramen-html-editor-meta-label">
							{t(locale, 'htmlEditorBannerUrlLabel')}
						</label>
						<input
							id="ramen-html-editor-banner-url"
							type="text"
							className="ramen-html-editor-meta-input"
							value={metaState.bannerUrl}
							placeholder={t(locale, 'htmlEditorBannerUrlPlaceholder')}
							onChange={(e) => updateMeta({ bannerUrl: e.target.value })}
						/>
					</div>
				)}
				<div className="ramen-html-editor-meta-field">
					<label htmlFor="ramen-html-editor-description" className="ramen-html-editor-meta-label">
						{t(locale, 'htmlEditorDescriptionLabel')}
					</label>
					<textarea
						id="ramen-html-editor-description"
						className="ramen-html-editor-meta-description"
						rows={2}
						value={metaState.description}
						placeholder={t(locale, 'htmlEditorDescriptionPlaceholder')}
						onChange={(e) => updateMeta({ description: e.target.value })}
					/>
				</div>
				<div className="ramen-html-editor-meta-field">
					<label htmlFor="ramen-html-editor-tags" className="ramen-html-editor-meta-label">
						{t(locale, 'htmlEditorTagsLabel')}
					</label>
					<input
						id="ramen-html-editor-tags"
						type="text"
						className="ramen-html-editor-meta-input"
						value={metaState.tagsInput}
						placeholder={t(locale, 'htmlEditorTagsPlaceholder')}
						onChange={(e) => updateMeta({ tagsInput: e.target.value })}
					/>
				</div>
			</div>
			{tab !== 'preview' && (
				<div className="ramen-html-editor-tabs">
					{tabs.map(({ key, label }) => (
						<button
							key={key}
							type="button"
							className={`ramen-html-editor-tab${tab === key ? ' is-active' : ''}`}
							onClick={() => onTabChange(key)}
						>
							{label}
						</button>
					))}
				</div>
			)}
			<div className="ramen-html-editor-body">
				{tab === 'preview' && (
					<iframe
						className="ramen-html-editor-preview"
						srcDoc={joinHtmlDoc(parts)}
						title={t(locale, 'htmlEditorTabPreview')}
						sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
					/>
				)}
				{tab === 'html' && (
					<CodeEditor lang="html" value={parts.html} onChange={(v) => update({ html: v })} showLineNumbers={showLineNumbers} />
				)}
				{tab === 'css' && (
					<CodeEditor lang="css" value={parts.css} onChange={(v) => update({ css: v })} showLineNumbers={showLineNumbers} />
				)}
				{tab === 'js' && (
					<CodeEditor lang="js" value={parts.js} onChange={(v) => update({ js: v })} showLineNumbers={showLineNumbers} />
				)}
			</div>
		</div>
	);
}

/**
 * html_mode 노트(body_md 전체가 raw HTML)를 HTML/CSS/JS 세 탭으로 나눠서 편집하고,
 * 실시간 미리보기(iframe)로 볼 수 있는 사이드 패널. 탭에서 수정하면 디바운스 후
 * 노트 body_md에 다시 합쳐써서 저장 — 일반 push 흐름(vault modify 감지)을 그대로 탄다.
 *
 * FileView를 상속해서 this.file을 부모가 관리하게 함(onLoadFile 등 표준 라이프사이클 활용).
 * 뷰 헤더 기본 "..."는 file-menu가 아니라 View.onPaneMenu 훅으로 채운다(아래 참고) — "마크다운으로
 * 보기"·"미리보기 분할" 4방향은 거기 넣고, 자주 쓰는 미리보기 토글만 별도 addAction 아이콘으로 둔다.
 */
export class HtmlEditorView extends FileView {
	private root: Root | null = null;
	private locale: Locale;
	/** 설정 > 일반 > "HTML 편집기 시작 탭" — 노트를 (새로) 열 때마다 이 탭으로 시작. */
	private readonly defaultTab: Tab;
	private tab: Tab;
	/** 미리보기 아이콘을 다시 눌러 토글로 빠져나올 때 복귀할 탭. */
	private lastCodeTab: Exclude<Tab, 'preview'>;
	/** 미리보기 토글 아이콘 자체 — 현재 tab 상태에 맞춰 눈/눈-off 아이콘으로 바꿔줌. */
	private previewActionEl: HTMLElement | null = null;
	/** onLoadFile이 "다른 파일로 전환"인지 판단하기 위한 직전 파일 경로. */
	private loadedFilePath: string | null = null;
	/** "무시하고 다시 업로드" 버튼용 — 이 파일이 속한 블로그(연결 정보)를 알아야 서버에 직접 업로드/삭제
	 *  요청을 보낼 수 있음. 콜백으로 받아서 항상 설정 창에서 방금 바뀐 최신 블로그 목록을 봄. */
	private readonly getBlogs: () => BlogConfig[];

	constructor(leaf: WorkspaceLeaf, locale: Locale, defaultTab: Tab, getBlogs: () => BlogConfig[]) {
		super(leaf);
		this.locale = locale;
		this.defaultTab = defaultTab;
		this.tab = defaultTab;
		this.lastCodeTab = defaultTab === 'preview' ? 'html' : defaultTab;
		this.getBlogs = getBlogs;
	}

	getViewType(): string {
		return HTML_EDITOR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file ? this.file.basename : t(this.locale, 'htmlEditorViewName');
	}

	getIcon(): string {
		return 'code';
	}

	async onLoadFile(file: TFile): Promise<void> {
		// 같은 leaf에서 다른 html_mode 노트로 전환한 경우에도 설정된 시작 탭으로 되돌아가게.
		if (this.loadedFilePath !== file.path) {
			this.loadedFilePath = file.path;
			this.tab = this.defaultTab;
			this.lastCodeTab = this.defaultTab === 'preview' ? 'html' : this.defaultTab;
			this.updatePreviewActionIcon();
		}
		await this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('ramen-html-editor-container');
		// 미리보기는 자주 쓰는 토글이라 뷰 헤더에 전용 아이콘으로 — 다시 누르면 원래 보던 코드 탭으로 복귀.
		this.previewActionEl = this.addAction('eye', t(this.locale, 'htmlEditorTabPreview'), () => {
			this.tab = this.tab === 'preview' ? this.lastCodeTab : 'preview';
			this.updatePreviewActionIcon();
			void this.render();
		});
		this.updatePreviewActionIcon();
		this.root = createRoot(this.contentEl);
		// 같은 파일을 다른 leaf(예: 미리보기 분할로 연 pane)에서 편집해서 디스크에 저장되면, 이 leaf의
		// 미리보기·코드 탭도 바로 최신 내용으로 다시 그려야 함 — vault modify를 그대로 구독.
		// (같은 leaf의 자체 편집으로 인한 modify는 render()가 멱등이라 별도 분기 없이 그대로 재사용.)
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (this.file && file.path === this.file.path) void this.render();
		}));
		// 설정 창에서 "줄 번호 표시"를 바로 바꿔도, 탭을 새로 열지 않고 지금 보이는 에디터에 즉시 반영.
		this.registerEvent(onVaultConfigChanged(this.app, (key) => {
			if (key === 'showLineNumber') void this.render();
		}));
	}

	/**
	 * 뷰 헤더의 기본 "..."(more-options) / 탭 우클릭(tab-header) 메뉴를 채우는 공식 훅.
	 * file-menu 이벤트와 달리 이 뷰에서 직접 열었을 때도 확실히 호출된다 — "마크다운으로 보기"와
	 * "미리보기 분할" 4방향을 여기에 넣어 Split right/down 등 core 기본 항목들 옆에 같이 뜨게 한다.
	 */
	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		if (!this.file) return;
		const file = this.file;

		menu.addItem(item => item
			.setTitle(t(this.locale, 'htmlEditorOpenAsMarkdown'))
			.setIcon('file-text')
			.onClick(() => void switchToMarkdownTemporarily(this.leaf, file.path))
		);
		menu.addItem(item => item
			.setTitle(t(this.locale, 'htmlEditorSplitPreviewRight'))
			.setIcon('panel-right')
			.onClick(() => void this.splitToPreview('vertical', false))
		);
		menu.addItem(item => item
			.setTitle(t(this.locale, 'htmlEditorSplitPreviewLeft'))
			.setIcon('panel-left')
			.onClick(() => void this.splitToPreview('vertical', true))
		);
		menu.addItem(item => item
			.setTitle(t(this.locale, 'htmlEditorSplitPreviewDown'))
			.setIcon('panel-bottom')
			.onClick(() => void this.splitToPreview('horizontal', false))
		);
		menu.addItem(item => item
			.setTitle(t(this.locale, 'htmlEditorSplitPreviewUp'))
			.setIcon('panel-top')
			.onClick(() => void this.splitToPreview('horizontal', true))
		);
	}

	/** 지정한 방향으로 새 leaf를 분할해서 같은 파일을 미리보기 탭으로 곧바로 연다. */
	private async splitToPreview(direction: SplitDirection, before: boolean): Promise<void> {
		if (!this.file) return;
		const newLeaf = this.app.workspace.createLeafBySplit(this.leaf, direction, before);
		await newLeaf.setViewState({ type: HTML_EDITOR_VIEW_TYPE, state: { file: this.file.path }, active: true });
		if (newLeaf.view instanceof HtmlEditorView) await newLeaf.view.openInPreview();
	}

	/** 현재 tab 상태에 맞춰 미리보기 아이콘의 모양·툴팁을 갱신 (미리보기 중이면 eye-off로 "코드로 돌아가기" 표시). */
	private updatePreviewActionIcon(): void {
		if (!this.previewActionEl) return;
		const inPreview = this.tab === 'preview';
		setIcon(this.previewActionEl, inPreview ? 'eye-off' : 'eye');
		this.previewActionEl.setAttribute(
			'aria-label',
			t(this.locale, inPreview ? 'htmlEditorTabCode' : 'htmlEditorTabPreview'),
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	/** 새로 분할한 leaf를 미리보기 탭으로 강제 전환할 때 사용 (splitToPreview 참고). */
	async openInPreview(): Promise<void> {
		this.tab = 'preview';
		this.updatePreviewActionIcon();
		await this.render();
	}

	private async render(): Promise<void> {
		if (!this.root || !this.file) return;
		const raw = await this.app.vault.read(this.file);
		const fmMatch = raw.match(FRONTMATTER_RE);
		const frontmatter = fmMatch ? fmMatch[0] : '';
		const parts = splitHtmlDoc(unwrapHtmlModeBody(raw.slice(frontmatter.length)));
		const meta = parseFrontmatterMeta(frontmatter);
		const blog = blogsForFilePath(this.getBlogs(), this.file.path)[0] ?? null;

		this.root.render(
			<HtmlEditorPanel
				key={this.file.path}
				app={this.app}
				sourcePath={this.file.path}
				blog={blog}
				initial={parts}
				meta={meta}
				locale={this.locale}
				showLineNumbers={getShowLineNumbersSetting(this.app)}
				tab={this.tab}
				onTabChange={(tab) => {
					this.tab = tab;
					// 패널 안 탭 바에는 preview가 없으니 여기로 들어오는 tab은 항상 코드 탭.
					if (tab !== 'preview') this.lastCodeTab = tab;
					this.updatePreviewActionIcon();
					void this.render();
				}}
				onChange={(next) => void this.persist(frontmatter, next)}
				onMetaChange={(patch) => void this.persistMeta(patch)}
			/>
		);
	}

	private async persist(frontmatter: string, parts: HtmlDocParts): Promise<void> {
		if (!this.file) return;
		await this.app.vault.modify(this.file, `${frontmatter}${wrapHtmlModeBody(joinHtmlDoc(parts))}`);
	}

	/** banner/banner-url/description frontmatter 필드만 갱신 — 본문(html/css/js)은 건드리지 않음.
	 *  processFrontMatter는 저장 시점 최신 파일 내용을 다시 읽어서 patch하므로 persist()와 거의 동시에
	 *  호출돼도 서로 덮어쓰지 않는다. */
	private async persistMeta(patch: Partial<HtmlEditorMeta>): Promise<void> {
		if (!this.file) return;
		await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
			if ('title' in patch) {
				if (patch.title) fm['title'] = patch.title;
				else delete fm['title'];
			}
			if ('banner' in patch) {
				if (patch.banner) fm['banner'] = patch.banner;
				else delete fm['banner'];
			}
			if ('bannerUrl' in patch) {
				if (patch.bannerUrl) fm['banner-url'] = patch.bannerUrl;
				else delete fm['banner-url'];
			}
			if ('description' in patch) {
				if (patch.description) fm['description'] = patch.description;
				else delete fm['description'];
			}
			if ('tagsInput' in patch) {
				const tags = normalizeTagsValue(patch.tagsInput);
				if (tags.length > 0) fm['tags'] = tags;
				else delete fm['tags'];
			}
		});
	}
}

/** frontmatter에 html_mode: true (또는 1/"true")가 설정돼 있는지. */
export function isHtmlModeFile(app: App, file: TFile): boolean {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	return fm?.['html_mode'] === true || fm?.['html_mode'] === 1 || fm?.['html_mode'] === 'true';
}

export async function swapLeafToHtmlEditor(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
	// FileView 표준 방식 — state.file을 주면 core가 알아서 파일을 로드하고 onLoadFile을 호출해준다.
	await leaf.setViewState({ type: HTML_EDITOR_VIEW_TYPE, state: { file: file.path }, active: true });
}

/**
 * html_mode는 켠 채로 지금 leaf만 잠깐 마크다운 뷰로 전환 (속성 편집 등). 이후 짧은 시간 동안은
 * autoSwapToHtmlEditorIfNeeded가 다시 HTML 편집기로 되돌리지 않도록 억제 표시를 남긴다 —
 * 안 남기면 view 전환 자체가 다시 active-leaf-change를 발생시켜서 누르자마자 되돌아가버림.
 */
export async function switchToMarkdownTemporarily(leaf: WorkspaceLeaf, filePath: string): Promise<void> {
	manualMarkdownSwitchAt.set(leaf, Date.now());
	await leaf.setViewState({ type: 'markdown', state: { file: filePath } });
}

/**
 * leaf가 지금 html_mode 노트를 마크다운 뷰로 보여주고 있으면 자동으로 이 편집기로 전환.
 * (파일 탐색기 클릭, 탭 전환, 링크 이동 등 그 leaf가 "활성"이 될 때마다 호출하면 됨.)
 * switchToMarkdownTemporarily로 방금 되돌아온 상태면 건드리지 않음 — 탈출구를 자동 전환이
 * 곧바로 다시 덮어쓰지 않도록. enabled가 false면(설정 > 일반 > "HTML 편집기 자동 전환" 꺼짐)
 * 아무것도 하지 않음 — 이 경우 사용자는 "..." 메뉴나 헤더 아이콘으로만 수동 전환할 수 있음.
 */
export async function autoSwapToHtmlEditorIfNeeded(leaf: WorkspaceLeaf, enabled: boolean): Promise<void> {
	if (!enabled) return;
	const view = leaf.view;
	if (!(view instanceof MarkdownView) || !view.file) return;
	if (!isHtmlModeFile(view.app, view.file)) return;
	const lastManualSwitch = manualMarkdownSwitchAt.get(leaf);
	if (lastManualSwitch && Date.now() - lastManualSwitch < MANUAL_SWITCH_SUPPRESS_MS) return;
	await swapLeafToHtmlEditor(leaf, view.file);
}
