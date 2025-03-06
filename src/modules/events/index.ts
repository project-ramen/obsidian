import { INodeModule } from 'src/interface/module';
import { PouchDb } from 'src/modules/pouch-db';

export class EventModule extends INodeModule {
  private pouchDb: PouchDb;
  $$onLoad() {
    const plugin = this.core;
    const vault = plugin.app.vault;
    plugin.registerEvent(
      vault.on('create', () => {
        console.log('create');
      })
    );

    plugin.registerEvent(
      vault.on('delete', () => {
        console.log('delete');
      })
    );

    plugin.registerEvent(
      vault.on('rename', () => {
        console.log('rename');
      })
    );

    plugin.registerEvent(
      vault.on('modify', () => {
        console.log('modify');
      })
    );
    plugin.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      console.log('click', evt);
    });

    // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
    plugin.registerInterval(
      window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000)
    );
    // this.pouchDb = new PouchDb();
  }
}
