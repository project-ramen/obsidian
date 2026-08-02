import { App, FuzzySuggestModal, Notice } from 'obsidian';
import { BlogConfig } from '../../settings/types';
import { pullBlog } from '../../sync';

interface BlogOption {
	blog: BlogConfig | null;
	label: string;
}

export class PullModal extends FuzzySuggestModal<BlogOption> {
	constructor(
		app: App,
		private blogs: BlogConfig[],
		private onApply: (path: string) => void,
	) {
		super(app);
		this.setPlaceholder('Select a blog to pull from…');
	}

	getItems(): BlogOption[] {
		const items: BlogOption[] = this.blogs.map(blog => ({
			blog,
			label: `${blog.rootFolder || 'Untitled'}  ${blog.link}`,
		}));
		if (this.blogs.length > 1) {
			items.push({ blog: null, label: 'Pull all blogs' });
		}
		return items;
	}

	getItemText(item: BlogOption): string {
		return item.label;
	}

	async onChooseItem(item: BlogOption): Promise<void> {
		const targets = item.blog ? [item.blog] : this.blogs;
		for (const blog of targets) {
			await this.doPull(blog);
		}
	}

	private async doPull(blog: BlogConfig): Promise<void> {
		const name = blog.rootFolder || blog.link;
		const notice = new Notice(`[${name}] 연결 중…`, 0);

		console.group(`[ramen pull] ${name}`);
		try {
			const { created, updated, skipped, log } = await pullBlog(
				this.app,
				blog,
				this.onApply,
				(msg) => {
					notice.setMessage(`[${name}] ${msg}`);
					console.log(msg);
				},
			);

			notice.hide();

			const summary = `완료 — +${created} 생성 / ~${updated} 업데이트 / ${skipped} 스킵`;
			console.log(summary);
			if (log.length > 0) console.log('변경 파일:\n' + log.join('\n'));
			console.groupEnd();

			new Notice(`[${name}] ${summary}`, 6000);
		} catch (e) {
			console.error('Pull 실패:', e);
			console.groupEnd();
			notice.hide();
			new Notice(`[${name}] Pull 실패: ${String(e)}`, 8000);
		}
	}
}
