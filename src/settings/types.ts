export interface BlogConfig {
	id: string;
	rootFolder: string;
	link: string;
	password: string;
	connectedAt?: string;
	attachmentFolder: string;
	/** 이 태그가 붙은 글은 블로그에서 /post 대신 /project에 노출됨. 서버 설정값의 로컬 캐시. */
	projectTag?: string;
}

export interface RamenPluginSettings {
	blogs: BlogConfig[];
	themeColor: 'system' | 'dark' | 'light';
	attachmentLocation: 'bottom' | 'top';
	showDotfiles: boolean;
	dotfilesSync: boolean;
	hideAttachmentFolder: boolean;
	language: 'ko' | 'en';
	debugMode: boolean;
	/** 시작 시 GitHub 릴리즈를 자동으로 확인할지 여부 (12시간에 한 번) */
	autoUpdateCheck: boolean;
	/** 마지막으로 업데이트를 확인한 시각 (ms epoch) */
	lastUpdateCheckAt: number;
	/** 마지막 확인에서 알아낸 최신 버전 (설정 UI 표시용 캐시) */
	latestKnownVersion?: string;
	/** html_mode 노트를 열 때 처음 보여줄 탭 (HtmlEditorView.Tab과 동일한 값 집합). */
	htmlEditorDefaultTab: 'preview' | 'html' | 'css' | 'js';
	/** html_mode 노트를 열 때 HTML 편집기로 자동 전환할지. 꺼두면 일반 마크다운 편집기로 열리고,
	 *  "..." 메뉴나 헤더 아이콘으로 수동으로만 HTML 편집기로 전환할 수 있음. */
	htmlEditorAutoSwitch: boolean;
}

export const DEFAULT_SETTINGS: RamenPluginSettings = {
	blogs: [],
	themeColor: 'system',
	attachmentLocation: 'bottom',
	showDotfiles: false,
	dotfilesSync: false,
	hideAttachmentFolder: false,
	language: 'ko',
	debugMode: false,
	autoUpdateCheck: true,
	lastUpdateCheckAt: 0,
	htmlEditorDefaultTab: 'html',
	htmlEditorAutoSwitch: true,
};

export interface SectionProps {
	settings: RamenPluginSettings;
	save: (patch: Partial<RamenPluginSettings>) => Promise<void>;
	app: import('obsidian').App;
}
