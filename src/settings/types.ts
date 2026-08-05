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
};

export interface SectionProps {
	settings: RamenPluginSettings;
	save: (patch: Partial<RamenPluginSettings>) => Promise<void>;
	app: import('obsidian').App;
}
