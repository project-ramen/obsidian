import { App, FuzzySuggestModal, Notice, requestUrl } from 'obsidian';
import { BlogConfig } from '../../settings/types';
import { normalizeBlogUrl, persistBlogConnection } from '../../settings/blogs/blog';
import { Locale, t } from '../../i18n';
import { debugLog } from '../../logger';

interface BlogOption {
	blog: BlogConfig | null;
	label: string;
}

export class ReconnectModal extends FuzzySuggestModal<BlogOption> {
	constructor(
		app: App,
		private blogs: BlogConfig[],
		private onReconnected: (blogId: string, connectedAt: string) => void,
		private locale: Locale = 'ko',
	) {
		super(app);
		this.setPlaceholder(t(locale, 'reconnectModalPlaceholder'));
	}

	getItems(): BlogOption[] {
		const items: BlogOption[] = this.blogs.map(blog => ({
			blog,
			label: `${blog.rootFolder || 'Untitled'}  ${blog.link}`,
		}));
		if (this.blogs.length > 1) {
			items.push({ blog: null, label: t(this.locale, 'reconnectModalAllBlogs') });
		}
		return items;
	}

	getItemText(item: BlogOption): string {
		return item.label;
	}

	onChooseItem(item: BlogOption): void {
		void this.handleChooseItem(item);
	}

	private async handleChooseItem(item: BlogOption): Promise<void> {
		const targets = item.blog ? [item.blog] : this.blogs;
		for (const blog of targets) {
			await this.doReconnect(blog);
		}
	}

	private async doReconnect(blog: BlogConfig): Promise<void> {
		const name = blog.rootFolder || blog.link;
		const notice = new Notice(t(this.locale, 'reconnectConnecting', { name }), 0);
		try {
			const base = normalizeBlogUrl(blog.link);
			const res = await requestUrl({
				url: `${base}/api/posts`,
				method: 'GET',
				headers: { Authorization: `Bearer ${blog.password}` },
				throw: false,
			});
			notice.hide();
			if (res.status >= 200 && res.status < 300) {
				const connectedAt = new Date().toISOString();
				persistBlogConnection(blog.rootFolder, base, blog.password);
				this.onReconnected(blog.id, connectedAt);
				new Notice(t(this.locale, 'reconnectSuccess', { name }), 4000);
				debugLog(`[ramen] reconnect 성공: ${name}`);
			} else {
				new Notice(t(this.locale, 'reconnectFailed', { name, status: res.status }), 6000);
				console.warn(`[ramen] reconnect 실패 (${res.status}): ${name}`);
			}
		} catch (e) {
			notice.hide();
			new Notice(t(this.locale, 'reconnectError', { name, e: String(e) }), 6000);
			console.error(`[ramen] reconnect 오류: ${name}`, e);
		}
	}
}
