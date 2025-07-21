import PouchDB from 'pouchdb';
import { INodeModule, Ramen } from 'src/interface';
import { LocalDB, Post } from '../pouch-db/type';

export type RemoteDB = PouchDB.Database<Post>;

export class ModuleRemoteDB extends INodeModule {
  private remote: RemoteDB;
  private local: LocalDB;

  private username = 'myhome'; //
  private password = '12341234';

  async $everyOnLoad() {
    console.log('run');
    this.local = this.core.$$getLocalDB();
    this.remote = new PouchDB<Post>(
      `http://${this.username}:${this.password}@localhost:5984/posts`
    );
    const opts = { live: true, retry: true };
    console.log('test', await this.remote.info());
    this.local.replicate.to(this.remote, opts, this.onSyncError);
    this.local.replicate.from(this.remote, opts, this.onSyncError);
  }

  onSyncError(msg: unknown): void {
    console.log(msg);
  }

  $$getRemoteDB(): RemoteDB {
    return this.remote;
  }

  constructor(core: Ramen) {
    super(core);
  }
}
