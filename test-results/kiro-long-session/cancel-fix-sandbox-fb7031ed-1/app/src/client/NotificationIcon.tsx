import { Icon } from "./Icon.js";
/** Shared message family; errors retain their warning mark. */
export function NotificationIcon({ error = false }: { error?: boolean }) {
  return <Icon name={error ? "message-square-warning" : "message-square-text"} width="24" height="24" />;
}
