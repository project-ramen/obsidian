import React, { useEffect, useRef, useState } from 'react';
import { App, EventRef, FileView, Menu, MarkdownView, setIcon, SplitDirection, TFile, WorkspaceLeaf } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import { Locale, t } from '../../i18n';
import { HtmlDocParts, joinHtmlDoc, splitHtmlDoc, unwrapHtmlModeBody, wrapHtmlModeBody } from './htmlDocParts';
import { CodeEditor } from './CodeEditor';

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

export type Tab = 'preview' | 'html' | 'css' | 'js';

interface PanelProps {
	initial: HtmlDocParts;
	locale: Locale;
	showLineNumbers: boolean;
	/** 탭 상태는 HtmlEditorView(뷰 헤더의 미리보기 아이콘)가 소유 — 패널 안 탭 버튼과 상단 아이콘이 같은 상태를 공유. */
	tab: Tab;
	onTabChange: (tab: Tab) => void;
	onChange: (parts: HtmlDocParts) => void;
}

function HtmlEditorPanel({ initial, locale, showLineNumbers, tab, onTabChange, onChange }: PanelProps) {
	const [parts, setParts] = useState<HtmlDocParts>(initial);
	const debounceRef = useRef<number | null>(null);

	// 다른 파일로 전환되거나(setFile) 외부(pull 등)에서 파일이 바뀌면 편집 중인 내용을 새로 반영
	useEffect(() => {
		setParts(initial);
	}, [initial]);

	useEffect(() => () => {
		if (debounceRef.current) window.clearTimeout(debounceRef.current);
	}, []);

	const update = (patch: Partial<HtmlDocParts>) => {
		const next = { ...parts, ...patch };
		setParts(next);
		if (debounceRef.current) window.clearTimeout(debounceRef.current);
		debounceRef.current = window.setTimeout(() => onChange(next), 500);
	};

	// Preview는 탭 바가 아니라 뷰 헤더의 아이콘으로 접근 — 여기 탭 바에는 HTML/CSS/JS만.
	const tabs: { key: Tab; label: string }[] = [
		{ key: 'html', label: 'HTML' },
		{ key: 'css', label: 'CSS' },
		{ key: 'js', label: 'JS' },
	];

	return (
		<div className="ramen-html-editor">
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

	constructor(leaf: WorkspaceLeaf, locale: Locale, defaultTab: Tab) {
		super(leaf);
		this.locale = locale;
		this.defaultTab = defaultTab;
		this.tab = defaultTab;
		this.lastCodeTab = defaultTab === 'preview' ? 'html' : defaultTab;
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

		this.root.render(
			<HtmlEditorPanel
				key={this.file.path}
				initial={parts}
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
			/>
		);
	}

	private async persist(frontmatter: string, parts: HtmlDocParts): Promise<void> {
		if (!this.file) return;
		await this.app.vault.modify(this.file, `${frontmatter}${wrapHtmlModeBody(joinHtmlDoc(parts))}`);
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
