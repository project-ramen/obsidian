import PouchDB from 'pouchdb';
import { INodeModule, Ramen } from 'src/interface';
import type {
  LocalDB,
  Post,
  PouchDbOptionParams,
  PouchDbOptions,
} from './type';

const defaultValue: PouchDbOptions = {
  name: 'posts',
  prefix: './data',
};

export class ModulePouchDB extends INodeModule {
  public db;
  constructor(
    public core: Ramen,
    props?: PouchDbOptionParams
  ) {
    super(core);
    const options = { ...defaultValue, ...props };
    this.db = new PouchDB<Post>(options.name, { ...options });
  }

  async $everyOnLoad() {}

  $$getLocalDB(): LocalDB {
    return this.db;
  }

  initial() {}

  async create(filePath: string) {
    const tFile = this.core.app.vault.getFileByPath(filePath);
    const content = tFile ? await this.core.app.vault.read(tFile) : '';

    const prev = await this.db.get(filePath).catch(() => null);
    console.log(content, prev);
    await this.db.put({
      content: content,
      _id: filePath,
      createdAt: new Date(),
      updatedAt: new Date(),
      _rev: prev?._rev,
    });
    console.log('finished');
  }

  update() {}

  remove() {}

  move() {}

  find() {}
}
