const REDACTED = "[REDACTED]";
const credentialNames = new Set([
  "password",
  "passwd",
  "passphrase",
  "credentials",
  "secret",
  "apikey",
  "apitoken",
  "token",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "idtoken",
  "ssotoken",
  "wstoken",
  "clientsecret",
  "credentialkey",
  "credentialskey",
  "brokercredentialskey",
  "brokerservicetoken",
  "admintoken",
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "setcookie",
  "cookievalue",
  "cookieheader",
  "sessioncookie",
  "sessiontoken",
  "sesskey",
  "csrftoken",
  "totp",
  "totpsecret",
  "mfacode",
  "onetimecode",
  "codeverifier",
  "privatekey",
]);
const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
export const credentialKey = (key: string) =>
  credentialNames.has(normalize(key));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Per request/account. Excludes OAuth exchanges and the private session contract. */
export class OutputBoundary {
  private readonly secrets = new Set<string>();
  remember(...values: unknown[]) {
    for (const value of values) {
      if (typeof value !== "string" || !value) continue;
      this.secrets.add(value);
      this.secrets.add(encodeURIComponent(value));
      this.secrets.add(JSON.stringify(value).slice(1, -1));
      this.secrets.add(
        value.replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c]!,
        ),
      );
    }
  }
  rememberSession(value: any) {
    if (!value || typeof value !== "object") return;
    this.remember(
      value.token,
      value.cookie_value,
      value.sesskey,
      value.input?.password,
      value.input?.mfa_code,
      value.input?.totp?.secret,
    );
    for (const cookie of value.cookies ?? [])
      if (cookie.name !== "username") this.remember(cookie.value);
  }
  private text(value: string) {
    let text = value;
    text = text
      .replace(
        /([?&#](?:amp;)?)([A-Za-z_%][\w%.-]*)=([^\s&#<>"']*)/g,
        (whole, prefix: string, key: string) => {
          try {
            return credentialKey(decodeURIComponent(key))
              ? `${prefix}${key}=${REDACTED}`
              : whole;
          } catch {
            return whole;
          }
        },
      )
      .replace(/(https?:\/\/)[^\s/<>"'?#]+@/gi, `$1${REDACTED}@`);
    for (const secret of [...this.secrets].sort(
      (a, b) => b.length - a.length,
    )) {
      text =
        secret.length >= 8
          ? text.split(secret).join(REDACTED)
          : text.replace(
              new RegExp(
                `(?<![A-Za-z0-9])${escape(secret)}(?![A-Za-z0-9])`,
                "g",
              ),
              REDACTED,
            );
    }
    return text;
  }
  redact(value: unknown, depth = 0): any {
    if (depth > 64) return REDACTED;
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value))
      return value.map((v) => this.redact(v, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          this.text(key),
          credentialNames.has(normalize(key))
            ? REDACTED
            : this.redact(item, depth + 1),
        ]),
      );
    return value;
  }
}
