import { Ramen } from '../interface';
import { INodeModule as Core } from 'src/interface/module';

export type OverridableFunctionsKeys<T> = {
  [K in keyof T as K extends `$${string}` ? K : never]: T[K];
};
export type Prettify<T> = {
  [K in keyof T]: T[K];
  // deno-lint-ignore ban-types
};

export type INodeModuleBase = OverridableFunctionsKeys<Core>;

export type INodeModule = Prettify<Partial<INodeModuleBase>>;

function isOverridable(name: string) {
  return name.startsWith('$');
}
function isInjectable(name: string) {
  return name.startsWith('$$');
}

function isExecutable(name: string) {
  return name.startsWith('$every');
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
  const moduleMap = new Map<string, INodeModule[]>();
  modules.forEach((module) => {
    allKeys.forEach((key) => {
      if (key in module) {
        const list = moduleMap.get(key) || [];
        // const moduleProperty = module[key];
        if (isOverridable(key) && typeof module[key] === 'function') {
          module[key] = module[key]?.bind(module);
        }
        list.push(module);
        moduleMap.set(key, list);
      }
    });

    for (const key of allKeys) {
      const modules = moduleMap.get(key) ?? [];
      if (modules.length <= 0) continue;

      switch (true) {
        case isInjectable(key):
          {
            const injectModule = modules[0][key];
            if (injectModule) target[key] = injectModule;
          }
          break;
        case isExecutable(key):
          {
            target[key] = async (...args) => {
              for (const executeModule of modules) {
                const mo = executeModule[key];
                if (!mo) continue;

                await mo(...args);
                // if(!ret){
                //
                // }
              }
            };
          }
          break;
      }
    }
  });
  return true;
}
