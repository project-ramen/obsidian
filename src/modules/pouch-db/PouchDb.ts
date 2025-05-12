import PouchDB from 'pouchdb';
import { INodeModule, Ramen } from 'src/interface';
import type { Post, PouchDbOptionParams, PouchDbOptions } from './type';

const defaultValue: PouchDbOptions = {
  name: 'post',
  prefix: '',
};

export class ModulePouchDb extends INodeModule {
  public db;
  constructor(
    public core: Ramen,
    props?: PouchDbOptionParams
  ) {
    super(core);
    const options = { ...defaultValue, ...props };
    this.db = new PouchDB<Post>(options.name, { ...options });
  }

  $$onLoad(): void {}

  initial() {}

  async create(filePath: string) {
    console.log(filePath, process.cwd());

    const tFile = this.core.app.vault.getFileByPath(filePath);
    const content = await this.core.app.vault.read(tFile);

    const prev = await this.db.get(filePath).catch(() => null);
    await this.db.put({
      content: content,
      _id: filePath,
      createdAt: new Date(),
      updatedAt: new Date(),
      _rev: prev?._rev,
    });
    console.log('asdf: ', await this.db.get(filePath));
  }

  update() {}

  remove() {}

  move() {}

  find() {}
}
