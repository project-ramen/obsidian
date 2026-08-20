import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';

export type CodeEditorLang = 'html' | 'css' | 'js';

function languageExtension(lang: CodeEditorLang): Extension {
	switch (lang) {
		case 'html': return html();
		case 'css': return css();
		case 'js': return javascript();
	}
}

// Obsidian 테마 CSS 변수를 그대로 써서 사용자가 쓰는 라이트/다크 테마에 자동으로 맞는 하이라이트 색상.
const ramenHighlightStyle = HighlightStyle.define([
	{ tag: tags.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
	{ tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: 'var(--color-purple)' },
	{ tag: tags.tagName, color: 'var(--color-red)' },
	{ tag: tags.attributeName, color: 'var(--color-orange)' },
	{ tag: [tags.attributeValue, tags.string], color: 'var(--color-green)' },
	{ tag: [tags.number, tags.bool, tags.null], color: 'var(--color-cyan)' },
	{ tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--color-blue)' },
	{ tag: [tags.className, tags.typeName], color: 'var(--color-yellow)' },
	{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--color-blue)' },
	{ tag: tags.variableName, color: 'var(--text-normal)' },
	{ tag: [tags.operator, tags.punctuation, tags.angleBracket, tags.bracket], color: 'var(--text-muted)' },
]);

const baseTheme = EditorView.theme({
	'&': {
		height: '100%',
		fontSize: 'var(--font-ui-small)',
		backgroundColor: 'var(--background-primary)',
		color: 'var(--text-normal)',
	},
	// .cm-sizer는 Obsidian이 자체 확장으로 추가하는 DOM이라 순정 CM6(우리 에디터)에는 애초에 없음 —
	// 그 역할(읽기 편한 줄 길이 제한)은 .cm-content의 max-width로 대체하되, gutter+content를 하나의
	// 묶음으로 가운데 정렬해야 해서(.cm-content만 margin:auto로 따로 센터링하면 gutter와 content 사이에
	// 뜬 간격이 생김) 센터링 자체는 부모 .cm-scroller의 justify-content로 처리.
	'.cm-content': {
		fontFamily: 'var(--font-monospace)',
		maxWidth: 'var(--file-line-width)',
		caretColor: 'var(--caret-color)',
	},
	// CM6 기본 테마는 커서를 검정/#ddd로 하드코딩해서 Obsidian의 실제 캐럿 색(--caret-color, 보통
	// --text-normal)과 달라 보임 — 실제 에디터와 같은 변수로 덮어씀.
	'.cm-cursor, .cm-dropCursor': {
		borderLeftColor: 'var(--caret-color)',
	},
	'.cm-gutters': {
		backgroundColor: 'var(--background-primary)',
		color: 'var(--text-faint)',
		border: 'none',
	},
	'&.cm-focused': { outline: 'none' },
	// 일반 마크다운 에디터의 .cm-scroller와 정확히 같은 방식(--file-margins) — 사이드바에서 열면 자동으로
	// 더 좁은 여백(--size-4-5)으로도 똑같이 맞춰짐. justify-content: center로 gutter+content 묶음 전체를 가운데로.
	'.cm-scroller': { overflow: 'auto', padding: 'var(--file-margins)', justifyContent: 'center' },
});

interface CodeEditorProps {
	lang: CodeEditorLang;
	value: string;
	onChange: (value: string) => void;
	/** Obsidian 설정(편집기 > 줄 번호 표시)과 동일하게 맞출지 여부. */
	showLineNumbers: boolean;
}

/** HTML/CSS/JS 탭 하나를 담당하는 CodeMirror 6 기반 문법 강조 에디터. Obsidian이 런타임에 제공하는
 *  @codemirror/state·view·language·commands·@lezer/* 모듈을 그대로 사용(esbuild external 설정 참고). */
export function CodeEditor({ lang, value, onChange, showLineNumbers }: CodeEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	// 줄 번호는 마운트 이후에도 Obsidian 설정(편집기 > 줄 번호 표시)이 바뀌면 다시 그려야 해서,
	// extensions 배열 안에 그냥 넣지 않고 Compartment로 감싸 나중에 reconfigure로 켜고 끌 수 있게 함.
	const lineNumberCompartmentRef = useRef(new Compartment());

	useEffect(() => {
		if (!containerRef.current) return;

		const state = EditorState.create({
			doc: value,
			extensions: [
				lineNumberCompartmentRef.current.of(showLineNumbers ? [lineNumbers()] : []),
				history(),
				bracketMatching(),
				indentOnInput(),
				indentUnit.of('  '),
				syntaxHighlighting(ramenHighlightStyle),
				languageExtension(lang),
				search(),
				// Cmd/Ctrl+F로 이 코드 탭 안에서 찾기 — searchKeymap을 안 넣으면 일반 에디터의
				// Cmd/Ctrl+F가 여기선 그냥 아무 동작도 안 함(브라우저 기본 찾기도 Obsidian이 가로챔).
				keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
				EditorView.lineWrapping,
				baseTheme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) onChangeRef.current(update.state.doc.toString());
				}),
			],
		});

		const view = new EditorView({ state, parent: containerRef.current });
		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
		// lang은 탭별로 고정이라(같은 CodeEditor 인스턴스가 언어를 바꿔 재사용되는 일이 없음) 마운트 시 1회만 구성.
		// value 동기화는 아래 별도 useEffect가 담당.
	}, []);

	// Obsidian 설정에서 줄 번호 표시를 껐다 켰다 하면(탭을 새로 마운트하지 않아도) 그 즉시 반영.
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: lineNumberCompartmentRef.current.reconfigure(showLineNumbers ? [lineNumbers()] : []),
		});
	}, [showLineNumbers]);

	// 탭 전환·파일 전환 등 외부 요인으로 value가 바뀌면 에디터 내용도 동기화.
	// 사용자가 타이핑해서 생긴 변경(이미 onChange로 반영된 값)까지 되돌리지 않도록 실제로 다를 때만 반영.
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const current = view.state.doc.toString();
		if (current === value) return;
		view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
	}, [value]);

	return <div ref={containerRef} className="ramen-code-editor" />;
}
