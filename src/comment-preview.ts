import { App, MarkdownView, Modal, Notice, TFile, requestUrl, setIcon } from 'obsidian';
import RamenPlugin from './main';
import { slugFromPath } from './sync';
import { normalizeBlogUrl } from './settings/blogs/blog';
import { BlogConfig } from './settings/types';
import { Locale, t } from './i18n';

interface CommentItem {
	id: number;
	content: string;
	user_id: string | null;
	created_at: string;
}

export class DeleteCommentModal extends Modal {
	private passwordInput!: HTMLInputElement;

	constructor(
		app: App,
		private onDelete: (password: string) => Promise<void>,
		private locale: Locale = 'ko',
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(t(this.locale, 'deleteCommentTitle'));
		this.contentEl.createEl('p', { text: t(this.locale, 'deleteCommentPrompt') });

		this.passwordInput = this.contentEl.createEl('input', { cls: 'ramen-comment-password-input' });
		this.passwordInput.type = 'password';
		this.passwordInput.placeholder = t(this.locale, 'passwordPlaceholder');
		this.passwordInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') void this.submit();
		});

		const btnRow = this.contentEl.createEl('div', { cls: 'modal-button-container' });
		btnRow.createEl('button', { text: t(this.locale, 'cancel') }).addEventListener('click', () => this.close());
		const confirmBtn = btnRow.createEl('button', { text: t(this.locale, 'delete'), cls: 'mod-warning' });
		confirmBtn.addEventListener('click', () => void this.submit());

		setTimeout(() => this.passwordInput.focus(), 50);
	}

	private async submit() {
		const pw = this.passwordInput.value.trim();
		if (!pw) return;
		await this.onDelete(pw);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class CommentPreviewManager {
	private renderTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private plugin: RamenPlugin) {}

	register() {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', (file) => {
				if (file) this.scheduleRender(file);
				else this.clearStrip();
			})
		);

		this.plugin.app.workspace.onLayoutReady(() => {
			const file = this.plugin.app.workspace.getActiveFile();
			if (file) this.scheduleRender(file);
		});
	}

	private scheduleRender(file: TFile) {
		if (this.renderTimer) clearTimeout(this.renderTimer);
		this.renderTimer = setTimeout(() => {
			this.renderTimer = null;
			void this.renderStrip(file);
		}, 400);
	}

	private clearStrip() {
		document.querySelectorAll('.ramen-comment-strip').forEach(el => el.remove());
	}

	private async renderStrip(noteFile: TFile) {
		this.clearStrip();

		// 같은 rootFolder를 여러 블로그가 공유할 수 있어(예: 같은 폴더를 두 블로그에 각각 게시),
		// 매칭되는 모든 블로그의 댓글을 가져와 블로그별 섹션으로 나눠 보여준다.
		const blogs = this.plugin.settings.blogs.filter(b => {
			if (!b.rootFolder || !b.link || !b.connectedAt) return false;
			const root = b.rootFolder.replace(/\/+$/, '');
			return noteFile.path.startsWith(root + '/');
		});
		if (!blogs.length) return;

		const results = await Promise.all(blogs.map(async (blog) => {
			const slug = slugFromPath(noteFile.path, blog.rootFolder);
			const base = normalizeBlogUrl(blog.link);
			try {
				const res = await requestUrl({
					url: `${base}/api/posts/by-slug/${encodeURIComponent(slug)}/comments`,
					method: 'GET',
					throw: false,
				});
				if (res.status !== 200) return { blog, comments: [] as CommentItem[] };
				return { blog, comments: res.json as CommentItem[] };
			} catch {
				return { blog, comments: [] as CommentItem[] };
			}
		}));

		// 비동기 fetch 이후 다른 파일로 이동했을 수 있음
		const currentFile = this.plugin.app.workspace.getActiveFile();
		if (!currentFile || currentFile.path !== noteFile.path) return;

		this.clearStrip();

		const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
		const targetLeaf = leaves.find(l => (l.view as MarkdownView).file?.path === noteFile.path);
		if (!targetLeaf) return;
		const view = targetLeaf.view as MarkdownView;
		const anchor = view.containerEl.querySelector('.cm-contentContainer');
		if (!anchor) return;

		const strip = createEl('div', { cls: 'ramen-comment-strip' });

		const locale = this.plugin.settings.language;
		const totalCount = results.reduce((sum, r) => sum + r.comments.length, 0);
		const header = strip.createEl('div', { cls: 'ramen-comment-header' });
		header.createEl('span', { cls: 'ramen-strip-label', text: t(locale, 'commentsCountLabel', { count: totalCount }) });

		const refreshBtn = header.createEl('button', { cls: 'ramen-comment-refresh-btn' });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.setAttribute('aria-label', t(locale, 'refreshAria'));
		refreshBtn.addEventListener('click', () => this.scheduleRender(noteFile));

		const showBlogLabels = blogs.length > 1;
		for (const { blog, comments } of results) {
			const section = strip.createEl('div', { cls: 'ramen-comment-blog-section' });

			if (showBlogLabels) {
				const sectionHeader = section.createEl('div', { cls: 'ramen-comment-blog-header' });
				sectionHeader.createEl('span', {
					cls: 'ramen-comment-blog-name',
					text: blog.link.replace(/^https?:\/\//, ''),
				});
				sectionHeader.createEl('span', { cls: 'ramen-comment-blog-count', text: t(locale, 'countSuffix', { count: comments.length }) });
			}

			const list = section.createEl('div', { cls: 'ramen-comment-list' });
			if (comments.length === 0) {
				list.createEl('div', { cls: 'ramen-comment-empty', text: t(locale, 'noCommentsYet') });
			} else {
				for (const comment of comments) {
					this.renderCommentItem(list, comment, blog, noteFile);
				}
			}
		}

		anchor.after(strip);
	}

	private renderCommentItem(
		container: HTMLElement,
		comment: CommentItem,
		blog: BlogConfig,
		noteFile: TFile,
	) {
		const locale = this.plugin.settings.language;
		const item = container.createEl('div', { cls: 'ramen-comment-item' });

		const meta = item.createEl('div', { cls: 'ramen-comment-meta' });
		meta.createEl('span', { cls: 'ramen-comment-user', text: comment.user_id || t(locale, 'anonymous') });
		meta.createEl('span', { cls: 'ramen-comment-date', text: formatDate(comment.created_at, locale) });

		const deleteBtn = meta.createEl('button', { cls: 'ramen-comment-delete-btn' });
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.setAttribute('aria-label', t(locale, 'deleteCommentAria'));
		deleteBtn.addEventListener('click', () => {
			new DeleteCommentModal(this.plugin.app, async (password) => {
				await this.deleteComment(comment, blog, password, noteFile);
			}, locale).open();
		});

		item.createEl('div', { cls: 'ramen-comment-content', text: comment.content });
	}

	private async deleteComment(
		comment: CommentItem,
		blog: BlogConfig,
		password: string,
		noteFile: TFile,
	) {
		const locale = this.plugin.settings.language;
		const base = normalizeBlogUrl(blog.link);
		try {
			const res = await requestUrl({
				url: `${base}/api/comments/${comment.id}`,
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password }),
				throw: false,
			});
			const body = res.json as { deleted?: boolean };
			if (res.status === 200 && body.deleted) {
				new Notice(t(locale, 'commentDeleted'), 3000);
				this.scheduleRender(noteFile);
			} else if (res.status === 403) {
				new Notice(t(locale, 'passwordMismatch'), 4000);
			} else {
				new Notice(t(locale, 'deleteFailed', { status: res.status }), 4000);
			}
		} catch (e) {
			new Notice(t(locale, 'errorGeneric', { e: String(e) }), 4000);
		}
	}

	unload() {
		this.clearStrip();
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
	}
}

export function formatDate(iso: string, locale: Locale = 'ko'): string {
	try {
		const d = new Date(iso);
		return d.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
	} catch {
		return iso;
	}
}
