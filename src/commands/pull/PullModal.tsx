import { App, FuzzySuggestModal, Notice } from 'obsidian';
import { BlogConfig } from '../../settings/types';
import { pullBlog } from '../../sync';
import { Locale, t } from '../../i18n';
import { debugLog } from '../../logger';

interface BlogOption {
	blog: BlogConfig | null;
	label: string;
}

export class PullModal extends FuzzySuggestModal<BlogOption> {
	constructor(
		app: App,
		private blogs: BlogConfig[],
		private onApply: (path: string) => void,
		private locale: Locale = 'ko',
	) {
		super(app);
		this.setPlaceholder(t(locale, 'pullModalPlaceholder'));
	}

	getItems(): BlogOption[] {
		const items: BlogOption[] = this.blogs.map(blog => ({
			blog,
			label: `${blog.rootFolder || 'Untitled'}  ${blog.link}`,
		}));
		if (this.blogs.length > 1) {
			items.push({ blog: null, label: t(this.locale, 'pullModalAllBlogs') });
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
			await this.doPull(blog);
		}
	}

	private async doPull(blog: BlogConfig): Promise<void> {
		const name = blog.rootFolder || blog.link;
		const notice = new Notice(t(this.locale, 'pullConnecting', { name }), 0);

		debugLog(`[ramen pull] ${name}`);
		try {
			const { created, updated, skipped, log } = await pullBlog(
				this.app,
				blog,
				this.onApply,
				(msg) => {
					notice.setMessage(`[${name}] ${msg}`);
					debugLog(msg);
				},
				this.locale,
			);

			notice.hide();

			const summary = t(this.locale, 'pullSummary', { created, updated, skipped });
			debugLog(summary);
			if (log.length > 0) debugLog('변경 파일:\n' + log.join('\n'));

			new Notice(`[${name}] ${summary}`, 6000);
		} catch (e) {
			console.error('Pull 실패:', e);
			notice.hide();
			new Notice(t(this.locale, 'pullFailed', { name, e: String(e) }), 8000);
		}
	}
}
