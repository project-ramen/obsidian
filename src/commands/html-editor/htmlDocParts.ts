/**
 * html_mode 노트의 body_md(완결된 raw HTML 문서)를 HTML/CSS/JS 세 부분으로 나누고 다시 합치는 유틸.
 * HtmlEditorView의 3탭 편집기 + 미리보기가 이걸로 body_md ↔ 탭별 내용을 왕복 변환한다.
 */

export interface HtmlDocParts {
	html: string;
	css: string;
	js: string;
}

// <svg>는 자기 안에 스코프된 <style>/<script>를 가질 수 있는데, 예전엔 문서 전체에서 위치 상관없이
// 뽑아내서 그런 중첩된 블록까지 최상위로 끌어올려버렸음(= svg가 스타일을 잃고 깨짐). 태그 중첩 깊이를
// 추적해서 depth === 0(최상위)일 때만 뽑아내고, svg 등 다른 요소 안에 있는 건 원문 그대로 둔다.
const TOKEN_RE = new RegExp(
	[
		'<!--[\\s\\S]*?-->', // 주석 — depth에 영향 없이 그대로 보존
		'(<style\\b[^>]*>)([\\s\\S]*?)(<\\/style\\s*>)', // style: raw-text 요소라 내부 태그는 무시하고 통째로 한 토큰
		'(<script\\b[^>]*>)([\\s\\S]*?)(<\\/script\\s*>)', // script도 마찬가지
		'<\\/?[a-zA-Z][a-zA-Z0-9:-]*\\b[^>]*?\\/?>', // 그 외 일반 태그 — depth 추적용
	].join('|'),
	'gi',
);
const VOID_ELEMENTS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** raw HTML 문서를 style/script를 뽑아낸 html과, css, js로 분리. */
export function splitHtmlDoc(raw: string): HtmlDocParts {
	const cssParts: string[] = [];
	const jsParts: string[] = [];
	let html = '';
	let depth = 0;
	let lastIndex = 0;
	let m: RegExpExecArray | null;

	TOKEN_RE.lastIndex = 0;
	while ((m = TOKEN_RE.exec(raw)) !== null) {
		html += raw.slice(lastIndex, m.index);
		lastIndex = TOKEN_RE.lastIndex;
		const token = m[0];

		if (m[1] !== undefined) {
			// style 블록: m[1]=여는 태그, m[2]=내용, m[3]=닫는 태그
			if (depth === 0) {
				const trimmed = m[2]!.trim();
				if (trimmed) cssParts.push(trimmed);
			} else {
				html += token; // svg 등 다른 요소 안에 중첩된 style은 원문 그대로 보존
			}
			continue;
		}

		if (m[4] !== undefined) {
			// script 블록: m[4]=여는 태그, m[5]=내용, m[6]=닫는 태그
			// src="..." 외부 스크립트는 편집할 코드가 없으므로 html 쪽에 그대로 둠 — inline만 추출.
			const hasSrc = /\bsrc\s*=/i.test(m[4]);
			if (depth === 0 && !hasSrc) {
				const trimmed = m[5]!.trim();
				if (trimmed) jsParts.push(trimmed);
			} else {
				html += token;
			}
			continue;
		}

		if (token.startsWith('<!--')) {
			html += token;
			continue;
		}

		// 그 외 일반 태그 — 원문 그대로 보존하면서 중첩 깊이만 갱신
		html += token;
		const isClosing = token.startsWith('</');
		const isSelfClosing = /\/>\s*$/.test(token);
		const tagNameMatch = /^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/.exec(token);
		const tagName = tagNameMatch ? tagNameMatch[1]!.toLowerCase() : '';
		if (isClosing) {
			depth = Math.max(0, depth - 1);
		} else if (!isSelfClosing && !VOID_ELEMENTS.has(tagName)) {
			depth += 1;
		}
	}
	html += raw.slice(lastIndex);
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

// html_mode 노트의 로컬 vault 파일은 본문 전체가 CSS 색상 코드(#000000 등)투성이라, Obsidian이
// 노트 전체 텍스트를 스캔해서 만드는 태그 패널/자동완성이 그 색상 코드들을 죄다 "#태그"로 잡아버림
// (실측 확인함). Obsidian은 코드펜스(```) 안의 텍스트는 태그로 안 잡으므로, 로컬 파일에 저장할 때만
// 본문을 코드펜스로 감싸서 이 오염을 막는다. 서버로 보내는 body_md(실제 raw HTML)는 이 펜스와 무관하게
// 항상 순수 HTML — push 직전에 벗기고, pull로 받은 내용을 로컬에 쓸 때만 새로 감싼다.
const FENCE_LANG = 'html';

/** content 안에 있는 백틱 연속 중 가장 긴 것보다 하나 더 긴 펜스를 써서, 내용 중간의 백틱이
 *  실수로 펜스를 조기 종료시키지 않게 함 (마크다운 표준 중첩 코드펜스 관례와 동일). 최소 3개. */
function fenceFor(content: string): string {
	const runs = content.match(/`+/g) ?? [];
	const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
	return '`'.repeat(Math.max(3, longest + 1));
}

/** html_mode 노트 본문을 로컬 vault 파일 저장용 코드펜스로 감쌈. */
export function wrapHtmlModeBody(content: string): string {
	const fence = fenceFor(content);
	return `${fence}${FENCE_LANG}\n${content}\n${fence}`;
}

/** 코드펜스로 감싼 형식이면 벗겨서 순수 본문만 반환. 예전 형식(펜스 없이 raw HTML 그대로 저장된
 *  노트)이면 그대로 반환 — 기존 html_mode 노트와 하위 호환. 다음에 저장될 때 새 형식으로 자연스럽게 바뀜. */
export function unwrapHtmlModeBody(content: string): string {
	const match = /^(`{3,})html\n([\s\S]*)\n\1\s*$/.exec(content.trim());
	return match ? match[2]! : content;
}
