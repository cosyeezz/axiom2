import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { AuthState } from "../shared/models.js";
import { AppError, text } from "../shared/protocol.js";
import { usageProviderId, type UsageAccount } from "../shared/model-usage.js";
import { Logins } from "./auth.js";
import { openAuthBrowser } from "./auth-browser.js";
import { providerProxyView, readProviderProxy } from "./integrations/model-proxy-env.js";
import { modelNetwork } from "./model-network.js";
import { ModelService } from "./model-service.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/** The usage account is NOT a model connection and is never included in execution snapshots. */
export class UsageAccounts {
  readonly models: ModelService;
  readonly logins: Logins;
  private readonly network: typeof modelNetwork;
  constructor(
    readonly root: string,
    private readonly mainModels: ModelService,
    publish: (owner: object, state: AuthState) => void,
    changed: () => Promise<void>,
    dependencies: { network?: typeof modelNetwork; openBrowser?: typeof openAuthBrowser } = {},
  ) {
    this.network = dependencies.network ?? modelNetwork;
    this.models = new ModelService(root, this.network, join(root, "model-usage", "pi"));
    this.logins = new Logins(this.models, publish, changed, dependencies.openBrowser, this.network, () => {
      this.assertIsolation();
      if (mainModels.authActive) throw new AppError("AUTH_BUSY", "模型服务已有认证流程，请先完成或取消，再授权用量账号。");
    });
  }
  get authActive() { return this.models.authActive; }
  /** Fail closed for accidental symlink/hardlink aliases, including external changes since startup. */
  private assertIsolation() {
    const fail = () => { throw new AppError("USAGE_STORAGE_INVALID", "用量授权目录必须独立于模型服务，且不能使用链接文件。"); };
    for (const directory of [join(this.root, "model-usage"), this.models.dir]) {
      try { if (lstatSync(directory).isSymbolicLink()) fail(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const canonical = (path: string, depth = 0): string => {
      if (depth > 64) return fail();
      try { return realpathSync.native(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      // A reverse symlink may target a not-yet-created usage auth.json: resolve
      // links and existing parent aliases even while the final file is absent.
      try {
        if (lstatSync(path).isSymbolicLink()) return canonical(resolve(dirname(path), readlinkSync(path)), depth + 1);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const parent = dirname(path);
      return parent === path ? resolve(path) : join(canonical(parent, depth + 1), basename(path));
    };
    if (canonical(this.models.dir) === canonical(this.mainModels.dir)) fail();
    for (const name of ["auth.json", "models.json", "models-store.json"]) {
      const usageFile = join(this.models.dir, name), mainFile = join(this.mainModels.dir, name);
      // Metadata only: never read primary credentials to establish isolation.
      if (canonical(mainFile) === canonical(usageFile)) fail();
      try {
        const stat = lstatSync(usageFile);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) fail();
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  async state(): Promise<UsageAccount> {
    this.assertIsolation();
    const raw = await this.models.raw();
    const credential = readStoredCredential(usageProviderId, join(this.models.dir, "auth.json"));
    return {
      providerId: usageProviderId,
      configured: credential?.type === "oauth",
      expired: credential?.type === "oauth" && (!Number.isFinite(credential.expires) || credential.expires <= Date.now()),
      revision: digest(raw),
      generation: digest(JSON.stringify(credential ?? null)),
      proxy: providerProxyView(readProviderProxy(join(this.models.dir, "models.json"), usageProviderId)),
    };
  }
  start(owner: object, provider: unknown, type: unknown, revision: unknown, proxy?: unknown) {
    this.assertIsolation();
    if (provider !== usageProviderId || type !== "oauth")
      throw new AppError("AUTH_UNSUPPORTED", "用量账号目前仅支持单独的 Codex OAuth 授权。");
    return this.logins.start(owner, usageProviderId, "oauth", revision, proxy);
  }
  async configureProxy(value: unknown, revision: unknown) {
    this.assertIsolation();
    if (this.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消用量授权，再修改查询网络。");
    // This method acquires the instance's serial writer itself. It touches only usage models.json.
    await this.models.configureLoginProxy(usageProviderId, value, text(revision, "配置版本"));
    return this.state();
  }
  query(refresh = false, signal?: AbortSignal) {
    this.assertIsolation();
    return this.models.usage(usageProviderId, refresh, signal);
  }
  async logout(revision: unknown, generation: unknown, signal?: AbortSignal) {
    this.assertIsolation();
    return this.models.serial(async () => {
      if (this.authActive) throw new AppError("AUTH_BUSY", "请先完成或取消用量授权。");
      const current = await this.state();
      if (revision !== current.revision || generation !== current.generation)
        throw new AppError("REVISION_CONFLICT", "用量授权已改变，请重新读取后退出。");
      await this.network(this.root, this.models.dir, usageProviderId, join(this.models.dir, "models.json"), "logout", {},
        { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
      return this.state();
    });
  }
  disconnect(owner: object) { this.logins.disconnect(owner); }
  close() { return this.logins.close(); }
}
