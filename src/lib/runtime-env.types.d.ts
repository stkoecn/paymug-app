export type RuntimeEnvironmentKey =
  | "AUTH_SECRET"
  | "ENCRYPTION_SECRET"
  | "NEXT_PUBLIC_APP_URL"
  | "EMAIL_FROM"
  | "EMAIL_REPLY_TO"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USER"
  | "SMTP_PASS"
  | "SMTP_SECURE";

export type RuntimeEnvironment = Record<
  RuntimeEnvironmentKey,
  string | undefined
>;

export interface RuntimeBindingStatus {
  database: boolean;
  email: boolean;
  storage: boolean;
}

export interface RuntimeConfiguration {
  values: RuntimeEnvironment;
  bindings: RuntimeBindingStatus;
}
