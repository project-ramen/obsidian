export type Locale = 'ko' | 'en';

const ko = {
	cmdInsertImage: '이미지 삽입',
	cmdViewAllComments: '전체 댓글 보기 (블로그별 그룹)',
	cmdSyncPosts: '블로그에 포스트 동기화',
	cmdReconnectBlog: '블로그 재연결',
	cmdPullPosts: '블로그에서 포스트 가져오기',

	tooltipPublishedAt: '{label}에 공개됨',
	tooltipUploadedAt: '{label}에 업로드됨 (비공개)',

	menuSwitchToPublic: '공개로 전환',
	menuSwitchToPrivate: '비공개로 전환',
	menuRemoveFromBlog: '블로그에서 제거',

	noticeMoveApplied: '이동 반영됨: {name}',
	noticeFolderMoveApplied: '폴더 이동 반영: {count}개 파일 동기화됨',
	noticeSyncFailed: '[{name}] 동기화 실패: {message}',
	noticeTogglingPublic: '[{name}] 공개 전환 중…',
	noticeTogglingPrivate: '[{name}] 비공개 전환 중…',
	noticeSwitchedToPublic: '공개로 전환됨',
	noticeSwitchedToPrivate: '비공개로 전환됨',
	noticeToggleFailed: '전환 실패: {e}',
	noticeRemoving: '[{name}] 제거 중…',
	noticeRemoved: '[{name}] 블로그에서 제거됨',
	noticeRemoveFailed: '[{name}] 제거 실패 ({status})',
	noticeRemoveError: '[{name}] 제거 오류: {e}',

	publishModalPlaceholderPublic: '공개로 전환할 블로그 선택…',
	publishModalPlaceholderPrivate: '비공개로 전환할 블로그 선택…',
	publishModalAllBlogsPublic: '모든 블로그에 공개',
	publishModalAllBlogsPrivate: '모든 블로그에서 비공개',
	publishModalToggling: '[{name}] {state} 전환 중…',
	publishModalToggled: '[{name}] {state}',
	publishModalFailed: '[{name}] 전환 실패: {e}',
	statePublic: '공개',
	statePrivate: '비공개',
	statePublicDone: '공개로 전환됨',
	statePrivateDone: '비공개로 전환됨',

	pullModalPlaceholder: '가져올 블로그 선택…',
	pullModalAllBlogs: '모든 블로그에서 가져오기',
	pullConnecting: '[{name}] 연결 중…',
	pullFetchingList: '서버에서 문서 목록 가져오는 중…',
	pullDocsReceived: '총 {total}개 문서 수신 (deleted 포함 {all}개)',
	pullUpdated: '[업데이트] {slug}',
	pullSkipped: '[스킵] {slug} (로컬이 최신)',
	pullCreated: '[생성] {slug}',
	pullSummary: '완료 — +{created} 생성 / ~{updated} 업데이트 / {skipped} 스킵',
	pullFailed: '[{name}] Pull 실패: {e}',

	reconnectModalPlaceholder: '재연결할 블로그 선택…',
	reconnectModalAllBlogs: '모든 블로그 재연결',
	reconnectConnecting: '[{name}] 연결 중…',
	reconnectSuccess: '[{name}] 연결 성공',
	reconnectFailed: '[{name}] 연결 실패 ({status})',
	reconnectError: '[{name}] 연결 오류: {e}',

	insertImageTitle: '이미지 삽입',
	insertImageSearchPlaceholder: '이미지 검색…',
	insertImageNoneFound: '이미지를 찾을 수 없습니다',

	deleteCommentTitle: '댓글 삭제',
	deleteCommentPrompt: '댓글 작성 시 입력한 비밀번호를 입력하세요.',
	passwordPlaceholder: '비밀번호',
	cancel: '취소',
	delete: '삭제',
	commentsCountLabel: '댓글 ({count}개)',
	refreshAria: '새로고침',
	noCommentsYet: '아직 댓글이 없습니다.',
	anonymous: '익명',
	deleteCommentAria: '댓글 삭제',
	commentDeleted: '댓글이 삭제되었습니다.',
	passwordMismatch: '비밀번호가 일치하지 않습니다.',
	deleteFailed: '삭제 실패 ({status})',
	errorGeneric: '오류: {e}',
	countSuffix: '{count}개',

	allCommentsTitle: '전체 댓글',
	noBlogsConnected: '연결된 블로그가 없습니다.',
	loading: '불러오는 중…',
	requestFailed: '요청 실패 ({status})',
	noComments: '댓글 없음',
	postFileNotFound: 'vault에서 해당 포스트 파일을 찾을 수 없습니다.',

	tagsFixedNotice: '"{basename}"의 tags 속성은 목록이어야 합니다. 자동으로 고쳤어요: {tags}',
	descriptionFixedNotice: '"{basename}"에 description 속성이 없어 자동으로 추가했어요: {description}',
	noBlogConnectionInfo: '블로그 연결 정보 없음',

	settingsLanguageName: 'Language',
	settingsLanguageDesc: 'Plugin display language',
} as const;

type TranslationKey = keyof typeof ko;

const en: Record<TranslationKey, string> = {
	cmdInsertImage: 'Insert image',
	cmdViewAllComments: 'View all comments (grouped by blog)',
	cmdSyncPosts: 'Sync posts to blog',
	cmdReconnectBlog: 'Reconnect to blog',
	cmdPullPosts: 'Pull posts from blog',

	tooltipPublishedAt: 'Published on {label}',
	tooltipUploadedAt: 'Uploaded to {label} (private)',

	menuSwitchToPublic: 'Switch to public',
	menuSwitchToPrivate: 'Switch to private',
	menuRemoveFromBlog: 'Remove from blog',

	noticeMoveApplied: 'Move applied: {name}',
	noticeFolderMoveApplied: 'Folder move applied: {count} file(s) synced',
	noticeSyncFailed: '[{name}] Sync failed: {message}',
	noticeTogglingPublic: '[{name}] Switching to public…',
	noticeTogglingPrivate: '[{name}] Switching to private…',
	noticeSwitchedToPublic: 'Switched to public',
	noticeSwitchedToPrivate: 'Switched to private',
	noticeToggleFailed: 'Switch failed: {e}',
	noticeRemoving: '[{name}] Removing…',
	noticeRemoved: '[{name}] Removed from blog',
	noticeRemoveFailed: '[{name}] Remove failed ({status})',
	noticeRemoveError: '[{name}] Remove error: {e}',

	publishModalPlaceholderPublic: 'Select a blog to switch to public…',
	publishModalPlaceholderPrivate: 'Select a blog to switch to private…',
	publishModalAllBlogsPublic: 'Publish to all blogs',
	publishModalAllBlogsPrivate: 'Unpublish from all blogs',
	publishModalToggling: '[{name}] Switching to {state}…',
	publishModalToggled: '[{name}] {state}',
	publishModalFailed: '[{name}] Switch failed: {e}',
	statePublic: 'public',
	statePrivate: 'private',
	statePublicDone: 'Switched to public',
	statePrivateDone: 'Switched to private',

	pullModalPlaceholder: 'Select a blog to pull from…',
	pullModalAllBlogs: 'Pull all blogs',
	pullConnecting: '[{name}] Connecting…',
	pullFetchingList: 'Fetching document list from server…',
	pullDocsReceived: 'Received {total} documents ({all} including deleted)',
	pullUpdated: '[updated] {slug}',
	pullSkipped: '[skipped] {slug} (local is newer)',
	pullCreated: '[created] {slug}',
	pullSummary: 'Done — +{created} created / ~{updated} updated / {skipped} skipped',
	pullFailed: '[{name}] Pull failed: {e}',

	reconnectModalPlaceholder: 'Select a blog to reconnect…',
	reconnectModalAllBlogs: 'Reconnect all blogs',
	reconnectConnecting: '[{name}] Connecting…',
	reconnectSuccess: '[{name}] Connected',
	reconnectFailed: '[{name}] Connection failed ({status})',
	reconnectError: '[{name}] Connection error: {e}',

	insertImageTitle: 'Insert image',
	insertImageSearchPlaceholder: 'Search images…',
	insertImageNoneFound: 'No images found',

	deleteCommentTitle: 'Delete comment',
	deleteCommentPrompt: 'Enter the password you used when posting this comment.',
	passwordPlaceholder: 'Password',
	cancel: 'Cancel',
	delete: 'Delete',
	commentsCountLabel: 'Comments ({count})',
	refreshAria: 'Refresh',
	noCommentsYet: 'No comments yet.',
	anonymous: 'Anonymous',
	deleteCommentAria: 'Delete comment',
	commentDeleted: 'Comment deleted.',
	passwordMismatch: 'Password does not match.',
	deleteFailed: 'Delete failed ({status})',
	errorGeneric: 'Error: {e}',
	countSuffix: '{count}',

	allCommentsTitle: 'All comments',
	noBlogsConnected: 'No blogs connected.',
	loading: 'Loading…',
	requestFailed: 'Request failed ({status})',
	noComments: 'No comments',
	postFileNotFound: 'Could not find the post file in the vault.',

	tagsFixedNotice: 'The "tags" field in "{basename}" must be a list. Fixed automatically: {tags}',
	descriptionFixedNotice: 'Added a "description" property to "{basename}" automatically: {description}',
	noBlogConnectionInfo: 'Missing blog connection info',

	settingsLanguageName: 'Language',
	settingsLanguageDesc: 'Plugin display language',
};

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { ko, en };

export function t(locale: Locale, key: TranslationKey, vars?: Record<string, string | number>): string {
	let str = dictionaries[locale]?.[key] ?? dictionaries.ko[key];
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			str = str.split(`{${k}}`).join(String(v));
		}
	}
	return str;
}
