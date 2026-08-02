import { App, FuzzySuggestModal, Notice, requestUrl } from 'obsidian';
import { BlogConfig } from '../../settings/types';
import { normalizeBlogUrl, persistBlogConnection } from '../../settings/blogs/blog';

interface BlogOption {
	blog: BlogConfig | null;
	label: string;
}

export class ReconnectModal extends FuzzySuggestModal<BlogOption> {
	constructor(
		app: App,
		private blogs: BlogConfig[],
		private onReconnected: (blogId: string, connectedAt: string) => void,
	) {
		super(app);
		this.setPlaceholder('Select a blog to reconnect…');
	}

	getItems(): BlogOption[] {
		const items: BlogOption[] = this.blogs.map(blog => ({
			blog,
			label: `${blog.rootFolder || 'Untitled'}  ${blog.link}`,
		}));
		if (this.blogs.length > 1) {
			items.push({ blog: null, label: 'Reconnect all blogs' });
		}
		return items;
	}

	getItemText(item: BlogOption): string {
		return item.label;
	}

	async onChooseItem(item: BlogOption): Promise<void> {
		const targets = item.blog ? [item.blog] : this.blogs;
		for (const blog of targets) {
			await this.doReconnect(blog);
		}
	}

	private async doReconnect(blog: BlogConfig): Promise<void> {
		const name = blog.rootFolder || blog.link;
		const notice = new Notice(`[${name}] 연결 중…`, 0);
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
				new Notice(`[${name}] 연결 성공`, 4000);
				console.log(`[ramen] reconnect 성공: ${name}`);
			} else {
				new Notice(`[${name}] 연결 실패 (${res.status})`, 6000);
				console.warn(`[ramen] reconnect 실패 (${res.status}): ${name}`);
			}
		} catch (e) {
			notice.hide();
			new Notice(`[${name}] 연결 오류: ${String(e)}`, 6000);
			console.error(`[ramen] reconnect 오류: ${name}`, e);
		}
	}
}
