import { DefaultPackageManager, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
type DefaultResourceLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];

/** Pi 1.1.x compatibility boundary: resource discovery must never install packages.
 * Keep the SDK's scope/filter semantics. Fail closed if its private bridge changes. */
export function createInstalledResourceLoader(options: DefaultResourceLoaderOptions, warn: () => void) {
  const loader = new DefaultResourceLoader(options);
  const manager: unknown = Reflect.get(loader, "packageManager");
  if (!(manager instanceof DefaultPackageManager) || typeof Reflect.get(manager, "parseSource") !== "function")
    throw Error("资源加载器版本不兼容，无法保证只读取已安装资源。请更新应用后重试。");
  const parse = Reflect.get(manager, "parseSource") as (source: string) => { type: string };
  const resolve = manager.resolve.bind(manager), extensions = manager.resolveExtensionSources.bind(manager);
  manager.resolve = async () => {
    let warned = false;
    return resolve(async () => { if (!warned) { warned = true; warn(); } return "skip"; });
  };
  manager.resolveExtensionSources = async (sources, scope) => {
    // Temporary remote extensions also refresh existing git checkouts. They must
    // be explicitly prepared as packages in the resource page before discovery.
    const local = sources.filter(source => source.startsWith("builtin:") || parse.call(manager, source).type === "local");
    if (local.length !== sources.length) warn();
    return extensions(local, scope);
  };
  return loader;
}
