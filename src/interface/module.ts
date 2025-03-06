import { Ramen } from '.';

export abstract class INodeModule {
  constructor(public core: Ramen) {
    console.log(this.core);
  }

  abstract $$onLoad(): void;
}
