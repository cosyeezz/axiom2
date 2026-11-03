import { useEffect } from "react";

/** Compatibility entry: account management now lives with its connection. */
export default function ModelAccounts() {
  const target = `/model-config.html${location.search}`;
  useEffect(() => { location.replace(target); }, [target]);
  return <p role="status">账号管理已并入模型服务。<a href={target}>前往账号与认证</a></p>;
}
