import PouchDB from 'pouchdb';
import type { Post, PouchDbOptionParams, PouchDbOptions } from './type';

const defaultValue: PouchDbOptions = {
  name: 'post',
  prefix: '',
};

export class PouchDb {
  private db;
  constructor(props?: PouchDbOptionParams) {
    const options = { ...defaultValue, ...props };
    this.db = new PouchDB<Post>(undefined, { ...options });
  }

  initial() {}

  create() {
    this.db.put({
      content: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  update() {}

  remove() {}

  move() {}

  find() {}
}
