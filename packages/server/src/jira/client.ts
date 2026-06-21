export interface JiraCreds {
  siteUrl: string; // e.g. https://your-site.atlassian.net
  email: string;
  token: string; // Atlassian API token
}

export type JiraErrorKind = "auth" | "forbidden" | "rate" | "notfound" | "http" | "network";

export class JiraError extends Error {
  constructor(
    public kind: JiraErrorKind,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "JiraError";
  }
}

/** Thin Jira Cloud client using API-token basic auth, hitting the site domain directly. */
export class JiraClient {
  constructor(private creds: JiraCreds) {}

  private root() {
    return this.creds.siteUrl.replace(/\/+$/, "");
  }
  private base(api: "v3" | "agile") {
    return api === "v3" ? `${this.root()}/rest/api/3` : `${this.root()}/rest/agile/1.0`;
  }
  private authHeader() {
    const b64 = Buffer.from(`${this.creds.email}:${this.creds.token}`).toString("base64");
    return `Basic ${b64}`;
  }

  async req<T = any>(api: "v3" | "agile", path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base(api) + path, {
        ...init,
        headers: {
          Authorization: this.authHeader(),
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (e: any) {
      throw new JiraError("network", 0, e?.message ?? "network error");
    }
    if (res.status === 401) throw new JiraError("auth", 401, "Unauthorized — token invalid or revoked");
    if (res.status === 403) throw new JiraError("forbidden", 403, "Forbidden — insufficient project permission");
    if (res.status === 404) throw new JiraError("notfound", 404, "Not found");
    if (res.status === 429) throw new JiraError("rate", 429, "Rate limited");
    if (!res.ok) throw new JiraError("http", res.status, (await res.text().catch(() => "")) || `HTTP ${res.status}`);
    if (res.status === 204) return null as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  get<T = any>(api: "v3" | "agile", path: string) {
    return this.req<T>(api, path);
  }
  post<T = any>(api: "v3" | "agile", path: string, body: unknown) {
    return this.req<T>(api, path, { method: "POST", body: JSON.stringify(body) });
  }
  put<T = any>(api: "v3" | "agile", path: string, body: unknown) {
    return this.req<T>(api, path, { method: "PUT", body: JSON.stringify(body) });
  }
}
