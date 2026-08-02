import { App, PluginSettingTab } from 'obsidian';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { SettingsPage } from './SettingsPage';
import MyPlugin from '../main';

export type { BlogConfig, MyPluginSettings } from './types';
export { DEFAULT_SETTINGS } from './types';

export class RamenSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	private root: Root | null = null;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();
		this.root = createRoot(this.containerEl);
		this.root.render(React.createElement(SettingsPage, { plugin: this.plugin }));
	}

	hide(): void {
		this.root?.unmount();
		this.root = null;
	}
}
