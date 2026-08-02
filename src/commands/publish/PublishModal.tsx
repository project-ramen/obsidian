import { App, FuzzySuggestModal, Notice, TFile } from 'obsidian';
import { BlogConfig } from '../../settings/types';
import { publishToBlog } from '../../sync';

interface BlogOption {
	blog: BlogConfig | null;
	label: string;
}

// 파일 경로가 겹치는 블로그가 여러 개일 때, 공개/비공개 전환을 어느 블로그에 적용할지 선택.
export class PublishModal extends FuzzySuggestModal<BlogOption> {
	constructor(
		app: App,
		private blogs: BlogConfig[],
		private file: TFile,
		private publish: boolean,
		private onResult: (blog: BlogConfig, ok: boolean) => void,
	) {
		super(app);
		this.setPlaceholder(publish ? '공개로 전환할 블로그 선택…' : '비공개로 전환할 블로그 선택…');
	}

	getItems(): BlogOption[] {
		const items: BlogOption[] = this.blogs.map(blog => ({
			blog,
			label: `${blog.rootFolder || 'Untitled'}  ${blog.link}`,
		}));
		if (this.blogs.length > 1) {
			items.push({ blog: null, label: this.publish ? '모든 블로그에 공개' : '모든 블로그에서 비공개' });
		}
		return items;
	}

	getItemText(item: BlogOption): string {
		return item.label;
	}

	async onChooseItem(item: BlogOption): Promise<void> {
		const targets = item.blog ? [item.blog] : this.blogs;
		for (const blog of targets) {
			await this.doToggle(blog);
		}
	}

	private async doToggle(blog: BlogConfig): Promise<void> {
		const name = blog.rootFolder || blog.link;
		const notice = new Notice(`[${name}] ${this.publish ? '공개' : '비공개'} 전환 중…`, 0);
		try {
			await publishToBlog(this.app, blog, this.file, this.publish);
			notice.hide();
			new Notice(`[${name}] ${this.publish ? '공개로 전환됨' : '비공개로 전환됨'}`, 4000);
			this.onResult(blog, true);
		} catch (e) {
			notice.hide();
			new Notice(`[${name}] 전환 실패: ${String(e)}`, 8000);
			this.onResult(blog, false);
		}
	}
}
