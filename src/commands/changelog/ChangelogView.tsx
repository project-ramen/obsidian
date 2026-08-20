import React, { useEffect, useRef, useState } from 'react';
import { App, Component, ItemView, MarkdownRenderer, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import { Locale, t } from '../../i18n';
import { fetchReleaseHistory, isNewerVersion, ReleaseHistoryEntry } from '../../update-checker';

export const CHANGELOG_VIEW_TYPE = 'ramen-changelog';

interface ChangelogViewState {
	fromVersion?: string;
	toVersion?: string;
}

function formatDate(iso: string): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toISOString().slice(0, 10);
}

/** 릴리즈 목록(최신순)에서 fromVersion보다 새 버전들만. fromVersion을 못 찾으면(더 예전 버전이거나
 *  기록 범위 밖) 안전하게 최신 1개만 보여줌 — 전체를 다 쏟아내는 것보다 나음. */
function releasesSince(all: ReleaseHistoryEntry[], fromVersion: string | undefined): ReleaseHistoryEntry[] {
	if (!fromVersion) return all.slice(0, 1);
	const idx = all.findIndex((r) => r.version === fromVersion);
	if (idx === -1) return all.filter((r) => isNewerVersion(r.version, fromVersion));
	return all.slice(0, idx);
}

function ReleaseNoteBlock({ app, release, locale }: { app: App; release: ReleaseHistoryEntry; locale: Locale }) {
	const bodyRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!bodyRef.current) return;
		const container = bodyRef.current;
		container.empty();
		const component = new Component();
		component.load();
		void MarkdownRenderer.render(
			app,
			release.body.trim() || t(locale, 'changelogNoNotes'),
			container,
			'',
			component,
		);
		return () => {
			component.unload();
		};
	}, [app, release.body, locale]);

	return (
		<div className="ramen-changelog-entry">
			<div className="ramen-changelog-entry-header">
				<span className="ramen-changelog-version">{release.version}</span>
				<span className="ramen-changelog-date">{formatDate(release.publishedAt)}</span>
			</div>
			<div ref={bodyRef} className="ramen-changelog-body markdown-rendered" />
		</div>
	);
}

function ChangelogPage({ app, locale, fromVersion, toVersion }: {
	app: App;
	locale: Locale;
	fromVersion?: string;
	toVersion?: string;
}) {
	const [releases, setReleases] = useState<ReleaseHistoryEntry[] | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void fetchReleaseHistory().then((list) => {
			if (cancelled) return;
			if (!list) setFailed(true);
			else setReleases(releasesSince(list, fromVersion));
		});
		return () => {
			cancelled = true;
		};
	}, [fromVersion]);

	return (
		<div className="ramen-changelog-page">
			<h1 className="ramen-changelog-page-title">
				{toVersion ? t(locale, 'changelogUpdatedTo', { version: toVersion }) : t(locale, 'changelogViewName')}
			</h1>
			{failed && <p className="ramen-changelog-status">{t(locale, 'changelogFailed')}</p>}
			{!failed && !releases && <p className="ramen-changelog-status">{t(locale, 'changelogLoading')}</p>}
			{!failed && releases && releases.length === 0 && (
				<p className="ramen-changelog-status">{t(locale, 'changelogEmpty')}</p>
			)}
			{releases && releases.length > 0 && (
				<div className="ramen-changelog">
					{releases.map((release) => (
						<ReleaseNoteBlock key={release.version} app={app} release={release} locale={locale} />
					))}
				</div>
			)}
		</div>
	);
}

/**
 * 플러그인이 새 버전으로 업데이트된 직후 자동으로 여는 "업데이트 내역" 페이지 — 설정 창이 아니라
 * 독립된 뷰(탭)로 뜬다. main.ts의 onLayoutReady에서 저장된 changelogLastSeenVersion과 현재
 * manifest.version이 다를 때만 열림(신규 설치 시엔 안 뜸).
 */
export class ChangelogView extends ItemView {
	private root: Root | null = null;
	private locale: Locale;
	private fromVersion?: string;
	private toVersion?: string;

	constructor(leaf: WorkspaceLeaf, locale: Locale) {
		super(leaf);
		this.locale = locale;
	}

	getViewType(): string {
		return CHANGELOG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t(this.locale, 'changelogViewName');
	}

	getIcon(): string {
		return 'sparkles';
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as ChangelogViewState;
		this.fromVersion = s.fromVersion;
		this.toVersion = s.toVersion;
		await super.setState(state, result);
		this.render();
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), fromVersion: this.fromVersion, toVersion: this.toVersion };
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('ramen-changelog-view');
		this.root = createRoot(this.contentEl);
		this.render();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	private render(): void {
		if (!this.root) return;
		this.root.render(
			<ChangelogPage app={this.app} locale={this.locale} fromVersion={this.fromVersion} toVersion={this.toVersion} />,
		);
	}
}

/** 새 leaf(탭)를 열어서 fromVersion~toVersion 사이 업데이트 내역을 보여줌. */
export async function openChangelogView(app: App, fromVersion: string | undefined, toVersion: string): Promise<void> {
	const leaf = app.workspace.getLeaf('tab');
	await leaf.setViewState({ type: CHANGELOG_VIEW_TYPE, state: { fromVersion, toVersion }, active: true });
}
