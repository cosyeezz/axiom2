import { useEffect, useState } from "react";
import { command, useConnection } from "../transport.js";
import { defaultBudgets, type TaskBudgets } from "../../shared/tasks.js";
const fields = [
  ["concurrency", "同时运行的子任务", 1, 16, 1],
  ["workMs", "工作预算（秒）", 1, 86400, 1000],
  ["wrapMs", "收尾预算（秒）", 0, 3600, 1000],
  ["summaryMs", "停止总结上限（秒）", 1, 60, 1000],
  ["cleanupMs", "清理等待上限（秒）", 1, 10, 1000],
] as const;
export function TaskSettings() {
  const connection = useConnection();
  const [budgets, setBudgets] = useState<TaskBudgets>(defaultBudgets),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = async () => {
    setBusy(true);
    try {
      setBudgets(await command<TaskBudgets>("task.preferences.get"));
      setLoaded(true);
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (connection === "已连接本地服务" && !loaded) void load();
  }, [connection]);
  return (
    <section className="overview-section">
      <details>
        <summary>子任务并发与预算</summary>
        <p className="meta">
          并发上限影响队列；预算在创建任务时固定，追问不延长当前执行。不会重启中断任务。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              setBudgets(
                await command<TaskBudgets>("task.preferences.save", {
                  budgets,
                }),
              );
              setMessage("已保存，仅影响后续任务预算。");
            } catch (e) {
              setLoaded(false);
              setMessage((e as Error).message + "；请重新读取后核实。");
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset
            disabled={!loaded || busy || connection !== "已连接本地服务"}
            style={{ border: 0, padding: 0 }}
          >
            <dl className="scope-list">
              {fields.map(([key, label, min, max, scale]) => (
                <div className="scope-row" key={key}>
                  <dt>
                    <label htmlFor={`budget-${key}`}>{label}</label>
                  </dt>
                  <dd>
                    <input
                      id={`budget-${key}`}
                      className="input"
                      type="number"
                      required
                      min={min}
                      max={max}
                      step="1"
                      value={budgets[key] / scale}
                      onChange={(e) =>
                        setBudgets({
                          ...budgets,
                          [key]: e.target.valueAsNumber * scale,
                        })
                      }
                    />
                  </dd>
                </div>
              ))}
            </dl>
            <button className="btn" type="submit">
              保存子任务设置
            </button>
          </fieldset>
          <button
            className="btn"
            type="button"
            disabled={busy || connection !== "已连接本地服务"}
            onClick={() => void load()}
          >
            重新读取预算
          </button>
          <p role="status">{message}</p>
        </form>
      </details>
    </section>
  );
}
