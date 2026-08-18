import React, { useEffect, useRef, useState } from "react";
import { App, Component, MarkdownRenderer, setIcon } from "obsidian";
import { Locale, t } from "../../i18n";
import { fetchReleaseHistory, ReleaseHistoryEntry } from "../../update-checker";

function formatDate(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toISOString().slice(0, 10);
}

function ChangelogItem({ app, release, locale }: { app: App; release: ReleaseHistoryEntry; locale: Locale }) {
	const [expanded, setExpanded] = useState(false);
	const caretRef = useRef<HTMLSpanElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (caretRef.current) setIcon(caretRef.current, "chevron-right");
	}, []);

	// 펼쳤을 때만 렌더링 — MarkdownRenderer.render는 Component 하나가 자기 lifecycle을 관리해야 해서,
	// 접힌 항목까지 미리 다 렌더링해두지 않고 펼칠 때 그때그때 만들고 접으면 unload.
	useEffect(() => {
		if (!expanded || !bodyRef.current) return;
		const container = bodyRef.current;
		container.empty();
		const component = new Component();
		component.load();
		void MarkdownRenderer.render(
			app,
			release.body.trim() || t(locale, "settingsChangelogNoNotes"),
			container,
			"",
			component,
		);
		return () => {
			component.unload();
		};
	}, [expanded, app, release.body, locale]);

	return (
		<div className={`ramen-changelog-item${expanded ? " is-expanded" : ""}`}>
			<button
				type="button"
				className="ramen-changelog-header"
				onClick={() => setExpanded((v) => !v)}
			>
				<span ref={caretRef} className="ramen-changelog-caret" />
				<span className="ramen-changelog-version">{release.version}</span>
				<span className="ramen-changelog-date">{formatDate(release.publishedAt)}</span>
			</button>
			{expanded && <div ref={bodyRef} className="ramen-changelog-body markdown-rendered" />}
		</div>
	);
}

/** 설정 > 일반 > 업데이트 내역 — GitHub 릴리즈(태그 푸시마다 release.yml이 자동 생성)를
 *  버전별 아코디언으로 보여줌. 릴리즈 노트 본문은 release.yml의 --generate-notes가 만든 마크다운. */
export function ChangelogAccordion({ app, locale }: { app: App; locale: Locale }) {
	const [releases, setReleases] = useState<ReleaseHistoryEntry[] | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void fetchReleaseHistory().then((list) => {
			if (cancelled) return;
			if (!list) setFailed(true);
			else setReleases(list);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	if (failed) return <p className="ramen-changelog-status">{t(locale, "settingsChangelogFailed")}</p>;
	if (!releases) return <p className="ramen-changelog-status">{t(locale, "settingsChangelogLoading")}</p>;
	if (releases.length === 0) return <p className="ramen-changelog-status">{t(locale, "settingsChangelogEmpty")}</p>;

	return (
		<div className="ramen-changelog">
			{releases.map((release) => (
				<ChangelogItem key={release.version} app={app} release={release} locale={locale} />
			))}
		</div>
	);
}
