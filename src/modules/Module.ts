import { Ramen } from '../interface';
import { INodeModule } from 'src/interface/module';

function isCoreModule(name: string) {
  return name.startsWith('$$');
}

function getCoreModule(module: INodeModule, key: keyof INodeModule) {
  const coreMethod = module[key];
  if (isCoreModule(key) && key in module && typeof coreMethod === 'function')
    return coreMethod;
  return undefined;
}

function getOverridableKeys<T extends Ramen>(target: T): (keyof INodeModule)[] {
  const result = [
    ...Object.keys(Object.getOwnPropertyDescriptors(target)),
    ...Object.keys(
      Object.getOwnPropertyDescriptors(Object.getPrototypeOf(target))
    ),
  ].filter((key) => key.startsWith('$'));

  return result as (keyof INodeModule)[];
}

export function injectModules<T extends Ramen>(
  target: T,
  modules: INodeModule[]
) {
  const allKeys = getOverridableKeys(target);
  // const moduleMap = new Map<string, INodeModule>();
  modules.forEach((module) => {
    allKeys.forEach((key) => {
      const coreModule = getCoreModule(module, key);
      if (coreModule) {
        coreModule.bind(module)();
      }
    });
  });
  // allKeys.forEach((key) => {
  //   switch (true) {
  //     case isCoreModule(key):
  //       {
  //         target[key]();
  //       }
  //       break;
  //   }
  // });
}
