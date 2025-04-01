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
    await this.db.put({
      content: 'test',
      _id: filePath,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  update() {}

  remove() {}

  move() {}

  find() {}
}
