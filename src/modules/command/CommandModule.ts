import { Editor, MarkdownView } from 'obsidian';
import { INodeModule } from 'src/interface/module';
import SettingTabModal from 'src/SettingTabModal';

export class CommandModule extends INodeModule {
  $$onLoad() {
    const plugin = this.core;
    plugin.addCommand({
      id: 'open-sample-modal-simple',
      name: 'Open sample modal (simple)',
      callback: () => {
        new SettingTabModal(plugin.app).open();
      },
    });
    // This adds an editor command that can perform some operation on the current editor instance
    plugin.addCommand({
      id: 'sample-editor-command',
      name: 'Sample editor command',
      editorCallback: (editor: Editor, _) => {
        console.log(editor.getSelection());
        editor.replaceSelection('Sample Editor Command');
      },
    });
    // This adds a complex command that can check whether the current state of the app allows execution of the command
    plugin.addCommand({
      id: 'open-sample-modal-complex',
      name: 'Open sample modal (complex)',
      checkCallback: (checking: boolean) => {
        // Conditions to check
        const markdownView =
          plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView) {
          // If checking is true, we're simply "checking" if the command can be run.
          // If checking is false, then we want to actually perform the operation.
          if (!checking) {
            new SettingTabModal(plugin.app).open();
          }

          // This command will only show up in Command Palette when the check function returns true
          return true;
        }
      },
    });
  }
}
