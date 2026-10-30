export interface ModelAccount {
  id: string;
  providerId: string;
  label: string;
  region: string;
  active: boolean;
  legacy: boolean;
  type?: "api_key" | "oauth";
  expiresAt?: number;
  /** Display-only metadata; never used for authentication, selection or credential routing. */
  email?: string;
  emailSource?: "token";
  /** Explicit saved value or bounded token claim; the live usage response may be newer. */
  plan?: string;
  accountId?: string;
  login?: { method?: "builder-id" | "identity-center" | "social"; startUrl?: string; authRegion?: string; flow?: "pkce" | "device" };
  createdAt: number;
}
export interface ModelAccounts {
  revision: string;
  accounts: ModelAccount[];
}
export interface AddModelAccount {
  label: string;
  region?: string;
}
