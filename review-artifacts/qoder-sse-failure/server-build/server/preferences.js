import { AppError, text, } from "../shared/protocol.js";
export class Preferences {
    store;
    constructor(store) {
        this.store = store;
        store.db.exec("CREATE TABLE IF NOT EXISTS model_favorites(provider TEXT NOT NULL,model TEXT NOT NULL,PRIMARY KEY(provider,model))");
    }
    favorites() {
        return this.store.db
            .prepare("SELECT provider,model AS id FROM model_favorites ORDER BY rowid")
            .all();
    }
    prune(config) {
        for (const favorite of this.favorites())
            if (!config.providers.some((p) => p.providerId === favorite.provider &&
                p.models.some((m) => m.id === favorite.id)))
                this.store.db
                    .prepare("DELETE FROM model_favorites WHERE provider=? AND model=?")
                    .run(favorite.provider, favorite.id);
    }
    async command(c, config) {
        if (c.op === "favorites.get")
            return this.favorites();
        if (c.op !== "favorites.set")
            throw new AppError("UNKNOWN_OPERATION", "不支持的收藏操作");
        return this.store.external(c, async () => {
            const provider = text(c.params?.provider, "供应商"), id = text(c.params?.id, "模型");
            if (typeof c.params?.favorite !== "boolean")
                throw new AppError("INVALID_INPUT", "收藏状态无效");
            if (c.params.favorite) {
                if (!config.available.some((m) => m.provider === provider && m.id === id))
                    throw new AppError("MODEL_UNAVAILABLE", "模型不可用");
                this.store.db
                    .prepare("INSERT OR IGNORE INTO model_favorites VALUES(?,?)")
                    .run(provider, id);
            }
            else
                this.store.db
                    .prepare("DELETE FROM model_favorites WHERE provider=? AND model=?")
                    .run(provider, id);
            return this.favorites();
        });
    }
}
//# sourceMappingURL=preferences.js.map