// High-risk URL policy for the web-research sandbox.
// The extension cannot spawn subagents, so for high-risk URLs it blocks the
// direct web_fetch result and returns a JSON message telling the main agent
// to use the WebResearch subagent instead.

const SUSPICIOUS_HOSTS = new Set([
  "pastebin.com",
  "pastebin.pl",
  "hastebin.com",
  "ghostbin.com",
  "zerobin.net",
  "privatebin.net",
  "tinyurl.com",
  "bit.ly",
  "t.co",
  "short.link",
  "ow.ly",
  "is.gd",
  "rb.gy",
  "qr.ae",
  "urlzs.com",
  "file.io",
  "anonfiles.com",
  "bayfiles.com",
]);

const SUSPICIOUS_PATH_EXTENSIONS = new Set([
  ".exe", ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".dmg", ".pkg",
  ".sh", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".mjs", ".cjs", ".wsf",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

const URL_SHORTENER_PATTERN = /^[a-z0-9]{2,6}\.[a-z]{2,6}$/i;

function looksLikeIp(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith("[") && hostname.endsWith("]");
}

export function isHighRiskUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    // Plain IP address hostnames (including IPv6 literals).
    if (looksLikeIp(hostname)) return true;

    // Non-standard ports are unusual for public documentation and APIs.
    if (parsed.port && parsed.port !== "80" && parsed.port !== "443") return true;

    // Credentials in the URL are a clear red flag.
    if (parsed.username || parsed.password) return true;

    // Known suspicious hosts (pastebin-like services, shorteners, file dumps).
    if (SUSPICIOUS_HOSTS.has(hostname)) return true;
    for (const host of SUSPICIOUS_HOSTS) {
      if (hostname.endsWith("." + host)) return true;
    }

    // URL shortener heuristic: short hostname + short TLD.
    if (URL_SHORTENER_PATTERN.test(hostname)) return true;

    // Suspicious file extensions.
    for (const ext of SUSPICIOUS_PATH_EXTENSIONS) {
      if (pathname.endsWith(ext)) return true;
    }

    return false;
  } catch {
    // If the URL cannot be parsed, treat it as high-risk rather than letting it
    // through untrusted.
    return true;
  }
}
