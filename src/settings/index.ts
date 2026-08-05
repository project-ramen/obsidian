import { App, PluginSettingTab } from 'obsidian';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { SettingsPage } from './SettingsPage';
import RamenPlugin from '../main';

export type { BlogConfig, RamenPluginSettings } from './types';
export { DEFAULT_SETTINGS } from './types';

export class RamenSettingTab extends PluginSettingTab {
	plugin: RamenPlugin;
	private root: Root | null = null;

	constructor(app: App, plugin: RamenPlugin) {
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
