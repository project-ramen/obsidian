import { App, Modal, Notice, requestUrl, setIcon } from 'obsidian';
import MyPlugin from '../../main';
import { slugFromPath } from '../../sync';
import { normalizeBlogUrl } from '../../settings/blogs/blog';
import { BlogConfig } from '../../settings/types';
import { DeleteCommentModal, formatDate } from '../../comment-preview';
import { t } from '../../i18n';

interface AllCommentItem {
	id: number;
	post_id: number;
	post_slug: string;
	post_title: string;
	content: string;
	user_id: string | null;
	created_at: string;
}

interface BlogCommentsResult {
	blog: BlogConfig;
	comments: AllCommentItem[];
	error: string | null;
}

export class AllCommentsModal extends Modal {
	constructor(app: App, private plugin: MyPlugin) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(t(this.plugin.settings.language, 'allCommentsTitle'));
		this.modalEl.addClass('ramen-all-comments-modal');
		void this.render();
	}

	private async render() {
		const { contentEl } = this;
		const locale = this.plugin.settings.language;
		contentEl.empty();

		const blogs = this.plugin.settings.blogs.filter(b => b.link && b.password && b.connectedAt);
		if (!blogs.length) {
			contentEl.createEl('p', { cls: 'ramen-comment-empty', text: t(locale, 'noBlogsConnected') });
			return;
		}

		contentEl.createEl('p', { cls: 'ramen-all-comments-loading', text: t(locale, 'loading') });

		const results: BlogCommentsResult[] = await Promise.all(
			blogs.map(async (blog): Promise<BlogCommentsResult> => {
				try {
					const base = normalizeBlogUrl(blog.link);
					const res = await requestUrl({
						url: `${base}/api/comments`,
						method: 'GET',
						headers: { Authorization: `Bearer ${blog.password}` },
						throw: false,
					});
					if (res.status !== 200) return { blog, comments: [], error: t(locale, 'requestFailed', { status: res.status }) };
					return { blog, comments: res.json as AllCommentItem[], error: null };
				} catch (e) {
					return { blog, comments: [], error: String(e) };
				}
			}),
		);

		// 비동기 fetch 중 모달이 닫혔을 수 있음
		if (!this.contentEl.isConnected) return;

		contentEl.empty();

		const totalCount = results.reduce((sum, r) => sum + r.comments.length, 0);
		if (totalCount === 0 && results.every(r => !r.error)) {
			contentEl.createEl('p', { cls: 'ramen-comment-empty', text: t(locale, 'noCommentsYet') });
		}

		for (const result of results) {
			this.renderBlogSection(contentEl, result);
		}
	}

	private renderBlogSection(container: HTMLElement, { blog, comments, error }: BlogCommentsResult) {
		const locale = this.plugin.settings.language;
		const section = container.createEl('div', { cls: 'ramen-all-comments-section' });

		const header = section.createEl('div', { cls: 'ramen-all-comments-blog-header' });
		header.createEl('span', {
			cls: 'ramen-all-comments-blog-name',
			text: blog.rootFolder || blog.link,
		});
		header.createEl('span', {
			cls: 'ramen-all-comments-blog-count',
			text: error ? error : t(locale, 'countSuffix', { count: comments.length }),
		});

		if (error) return;

		if (comments.length === 0) {
			section.createEl('div', { cls: 'ramen-comment-empty', text: t(locale, 'noComments') });
			return;
		}

		const list = section.createEl('div', { cls: 'ramen-comment-list' });
		for (const comment of comments) {
			this.renderCommentItem(list, comment, blog);
		}
	}

	private renderCommentItem(container: HTMLElement, comment: AllCommentItem, blog: BlogConfig) {
		const locale = this.plugin.settings.language;
		const item = container.createEl('div', { cls: 'ramen-comment-item' });

		const postRow = item.createEl('div', { cls: 'ramen-all-comments-post-row' });
		const postTitle = postRow.createEl('span', {
			cls: 'ramen-all-comments-post-title',
			text: comment.post_title || comment.post_slug,
		});
		postTitle.addEventListener('click', () => void this.openPost(blog, comment.post_slug));

		const meta = item.createEl('div', { cls: 'ramen-comment-meta' });
		meta.createEl('span', { cls: 'ramen-comment-user', text: comment.user_id || t(locale, 'anonymous') });
		meta.createEl('span', { cls: 'ramen-comment-date', text: formatDate(comment.created_at, locale) });

		const deleteBtn = meta.createEl('button', { cls: 'ramen-comment-delete-btn' });
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.setAttribute('aria-label', t(locale, 'deleteCommentAria'));
		deleteBtn.addEventListener('click', () => {
			new DeleteCommentModal(this.app, async (password) => {
				await this.deleteComment(comment, blog, password);
			}, locale).open();
		});

		item.createEl('div', { cls: 'ramen-comment-content', text: comment.content });
	}

	private async openPost(blog: BlogConfig, slug: string) {
		const root = blog.rootFolder.replace(/\/+$/, '');
		if (!root) return;
		const match = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(root + '/'))
			.find(f => slugFromPath(f.path, blog.rootFolder) === slug);
		if (!match) {
			new Notice(t(this.plugin.settings.language, 'postFileNotFound'), 4000);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(match);
		this.close();
	}

	private async deleteComment(comment: AllCommentItem, blog: BlogConfig, password: string) {
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
				void this.render();
			} else if (res.status === 403) {
				new Notice(t(locale, 'passwordMismatch'), 4000);
			} else {
				new Notice(t(locale, 'deleteFailed', { status: res.status }), 4000);
			}
		} catch (e) {
			new Notice(t(locale, 'errorGeneric', { e: String(e) }), 4000);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
