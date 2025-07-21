import { App, Modal } from 'obsidian';
import Component from '../src/component/SettingTabCompo.svelte';

export default class SettingTabModal extends Modal {
  private component: Component;
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.component = new Component({
      target: contentEl,
      props: {
        variable: 1,
      },
    });
  }

  onClose() {
    const { contentEl } = this;
    this.component.$destroy();
    contentEl.empty();
  }
}
