import { App, FuzzySuggestModal, Notice, TFile } from 'obsidian';
import { BlogConfig } from '../../settings/types';
import { publishToBlog } from '../../sync';
import { Locale, t } from '../../i18n';

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
		private locale: Locale = 'ko',
	) {
		super(app);
		this.setPlaceholder(publish
			? t(locale, 'publishModalPlaceholderPublic')
			: t(locale, 'publishModalPlaceholderPrivate'));
	}

	getItems(): BlogOption[] {
		const items: BlogOption[] = this.blogs.map(blog => ({
			blog,
			label: `${blog.rootFolder || 'Untitled'}  ${blog.link}`,
		}));
		if (this.blogs.length > 1) {
			items.push({
				blog: null,
				label: this.publish
					? t(this.locale, 'publishModalAllBlogsPublic')
					: t(this.locale, 'publishModalAllBlogsPrivate'),
			});
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
		const state = this.publish ? t(this.locale, 'statePublic') : t(this.locale, 'statePrivate');
		const notice = new Notice(t(this.locale, 'publishModalToggling', { name, state }), 0);
		try {
			await publishToBlog(this.app, blog, this.file, this.publish, this.locale);
			notice.hide();
			const doneState = this.publish ? t(this.locale, 'statePublicDone') : t(this.locale, 'statePrivateDone');
			new Notice(t(this.locale, 'publishModalToggled', { name, state: doneState }), 4000);
			this.onResult(blog, true);
		} catch (e) {
			notice.hide();
			new Notice(t(this.locale, 'publishModalFailed', { name, e: String(e) }), 8000);
			this.onResult(blog, false);
		}
	}
}
