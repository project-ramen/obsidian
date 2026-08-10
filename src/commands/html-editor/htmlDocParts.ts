/**
 * html_mode 노트의 body_md(완결된 raw HTML 문서)를 HTML/CSS/JS 세 부분으로 나누고 다시 합치는 유틸.
 * HtmlEditorView의 3탭 편집기 + 미리보기가 이걸로 body_md ↔ 탭별 내용을 왕복 변환한다.
 */

export interface HtmlDocParts {
	html: string;
	css: string;
	js: string;
}

const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
// src="..." 외부 스크립트는 편집할 코드가 없으므로 html 쪽에 그대로 둠 — inline 스크립트만 추출.
const INLINE_SCRIPT_BLOCK_RE = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** raw HTML 문서를 style/script를 뽑아낸 html과, css, js로 분리. */
export function splitHtmlDoc(raw: string): HtmlDocParts {
	const cssParts: string[] = [];
	const jsParts: string[] = [];

	let html = raw.replace(STYLE_BLOCK_RE, (_match, inner: string) => {
		const trimmed = inner.trim();
		if (trimmed) cssParts.push(trimmed);
		return '';
	});
	html = html.replace(INLINE_SCRIPT_BLOCK_RE, (_match, inner: string) => {
		const trimmed = inner.trim();
		if (trimmed) jsParts.push(trimmed);
		return '';
	});
	html = html.replace(/\n{3,}/g, '\n\n').trim();

	return {
		html,
		css: cssParts.join('\n\n'),
		js: jsParts.join('\n\n'),
	};
}

/** HtmlDocParts를 다시 하나의 raw HTML 문서로 합침. css는 문서 맨 위, js는 맨 아래에 배치. */
export function joinHtmlDoc(parts: HtmlDocParts): string {
	const sections: string[] = [];
	if (parts.css.trim()) sections.push(`<style>\n${parts.css.trim()}\n</style>`);
	if (parts.html.trim()) sections.push(parts.html.trim());
	if (parts.js.trim()) sections.push(`<script>\n${parts.js.trim()}\n</script>`);
	return sections.join('\n\n');
}
