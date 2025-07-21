import { Plugin } from 'obsidian';
// Remember to rename these classes and interfaces!
// import SettingTabModal from './src/SettingTabModal';
import SettingTabContainer from './SettingTabContainer';
import { injectModules } from 'src/modules/Module';
import { ModuleEvent } from 'src/modules/events';
import { ModuleCommand } from './modules/command/CommandModule';
import { ModulePouchDB } from './modules/pouch-db';
import { LocalDB } from './modules/pouch-db/type';
import { ModuleRemoteDB } from './modules/remote-db/remoteDb';

interface MyPluginSettings {
  mySetting: string;
}

export const VIEW_TYPE_EXAMPLE = 'example-view';
const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: 'default',
};

function throwErrorIfNotOverride(): never {
  throw new Error('function should be override');
}

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings = DEFAULT_SETTINGS;

  modules = [
    new ModulePouchDB(this, { name: 'posts' }),
    new ModuleEvent(this),
    new ModuleCommand(this),
    new ModuleRemoteDB(this),
  ];

  injected = injectModules(this, [...this.modules]);

  $everyOnLoad() {
    throwErrorIfNotOverride();
  }

  $$getLocalDB(): LocalDB {
    throwErrorIfNotOverride();
  }

  $$getRemoteDB(): ModuleRemoteDB {
    throwErrorIfNotOverride();
  }

  async onload() {
    this.$everyOnLoad();
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
    this.addSettingTab(new SettingTabContainer(this.app, this));
    // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
    // Using this function will automatically remove the event listener when this plugin is disabled.
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
