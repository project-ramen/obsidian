import { Ramen } from '.';

export abstract class INodeModule {
  constructor(public core: Ramen) {}

  abstract $everyOnLoad(): Promise<void> | void;
}
