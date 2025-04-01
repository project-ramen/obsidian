import { Plugin } from 'obsidian';
// Remember to rename these classes and interfaces!
// import SettingTabModal from './src/SettingTabModal';
// import SettingTabContainer from './SettingTabContainer';
import { injectModules } from 'src/modules/Module';
import { EventModule } from 'src/modules/events';
import { CommandModule } from './modules/command/CommandModule';

interface MyPluginSettings {
  mySetting: string;
}

export const VIEW_TYPE_EXAMPLE = 'example-view';
const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: 'default',
};

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings = DEFAULT_SETTINGS;

  modules = [new EventModule(this), new CommandModule(this)];

  async onload() {
    // await this.loadSettings();
    // this.registerView(VIEW_TYPE_EXAMPLE, (leaf) => new SettingTabModal(leaf));
    // This creates an icon in the left ribbon.
    // const ribbonIconEl = this.addRibbonIcon(
    //   'dice',
    //   'Retiblo Obsidian',
    //   (evt: MouseEvent) => {
    //     // Called when the user clicks the icon.
    //     new Notice('This is a notice!');
    //     // this.activateView();
    //   }
    // );
    // // Perform additional things with the ribbon
    // ribbonIconEl.addClass('my-plugin-ribbon-class');
    //
    // // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    // const statusBarItemEl = this.addStatusBarItem();
    // statusBarItemEl.setText('Status Bar Text');
    // This adds a simple command that can be triggered anywhere
    // to here
    // This adds a settings tab so the user can configure various aspects of the plugin
    // this.addSettingTab(new SettingTabContainer(this.app, this));
    // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
    // Using this function will automatically remove the event listener when this plugin is disabled.
    injectModules(this, [...this.modules]);
  }

  $$onLoad() {}

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
