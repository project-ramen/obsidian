import {
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  TAbstractFile,
  TFile,
} from 'obsidian';
import { INodeModule, Ramen } from 'src/interface';
import { PouchDb } from 'src/modules/pouch-db';

export function createTextBlob(data: string | string[]) {
  const d = Array.isArray(data) ? data : [data];
  return new Blob(d, { endings: 'transparent', type: 'text/plain' });
}

export function createBinaryBlob(data: Uint8Array | ArrayBuffer) {
  return new Blob([data], {
    endings: 'transparent',
    type: 'application/octet-stream',
  });
}

export function createBlob(
  data: string | string[] | Uint8Array | ArrayBuffer | Blob
) {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array || data instanceof ArrayBuffer)
    return createBinaryBlob(data);
  return createTextBlob(data);
}

export async function TFileToUXFileInfo(
  core: Ramen,
  file: TFile,
  deleted?: boolean
) {
  // const isPlain = isPlainText(file.name);
  // const possiblyLarge = !isPlain;

  const fullPath = core.app.vault.getAbstractFileByPath(file.path);
  let content: Blob;
  if (deleted) content = new Blob();
  else {
    // if (possiblyLarge) Logger(`Reading   : ${file.path}`, LOG_LEVEL_VERBOSE);
    content = createBlob(await core.app.vault.read(file));
    // if (possiblyLarge) Logger(`Processing: ${file.path}`, LOG_LEVEL_VERBOSE);
  }

  return {
    name: file.name,
    path: fullPath,
    stat: {
      size: content.size,
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
      type: 'file',
    },
    body: content,
  };
}

export class EventModule extends INodeModule {
  private pouchDb: PouchDb;
  $$onLoad() {
    const plugin = this.core;
    const vault = plugin.app.vault;
    this.onCreate = this.onCreate.bind(this);
    this.onModify = this.onModify.bind(this);
    this.onDelete = this.onDelete.bind(this);
    this.onRename = this.onRename.bind(this);
    this.onEditorChange = this.onEditorChange.bind(this);
    plugin.registerEvent(vault.on('create', this.onCreate));
    plugin.registerEvent(vault.on('delete', this.onDelete));
    plugin.registerEvent(vault.on('rename', this.onRename));
    plugin.registerEvent(vault.on('modify', this.onModify));

    plugin.registerEvent(
      //@ts-ignore
      plugin.app.vault.on('raw', (a) => {
        console.log('ste', a);
      })
    );
    plugin.registerEvent(
      plugin.app.workspace.on('editor-change', this.onEditorChange)
    );
    // plugin.registerDomEvent(document, 'click', (evt: MouseEvent) => {
    //   console.log('click', evt);
    // });

    // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
    // plugin.registerInterval(
    //   window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000)
    // );
    // this.pouchDb = new PouchDb();
  }

  onDelete() {}

  onRename(file: TAbstractFile, ctx?: any) {
    console.log('rename', file, ctx);
  }

  onCreate(file: TAbstractFile, ctx?: any) {
    console.log(file, ctx);
  }

  onModify(file: TAbstractFile, ctx?: any) {
    console.log('modify', file, ctx);
    // if (file instanceof TFolder) console.log('modify', file, ctx);
    // const a = TFileToUXFileInfo(this.core, file);
  }

  onEditorChange(editor: Editor, info: MarkdownFileInfo | MarkdownView) {
    if (!(info instanceof MarkdownView)) return;
    console.log('editor change', editor, info, info.data);
  }
}
