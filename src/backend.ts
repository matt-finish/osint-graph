// Thin bridge to the native layer. Inside the Tauri app everything goes through
// Rust commands; in a plain browser (`pnpm dev`) it falls back to web APIs so the
// UI can still be worked on, with the limits noted below.

import { invoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface HttpRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export async function httpFetch(req: HttpRequest): Promise<HttpResponse> {
  if (isTauri) {
    return invoke<HttpResponse>("http_fetch", {
      req: { method: req.method ?? "GET", url: req.url, headers: req.headers ?? {}, body: req.body, timeout_ms: req.timeoutMs },
    });
  }
  // Browser fallback: subject to CORS, so most third-party APIs will fail here.
  const r = await fetch(req.url, { method: req.method ?? "GET", headers: req.headers, body: req.body });
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  return { status: r.status, url: r.url, headers, body: await r.text() };
}

// ---- secrets (macOS Keychain via Rust; localStorage only in browser dev mode) ----

const DEV_PREFIX = "osint-graph.dev-secret.";

export async function secretGet(name: string): Promise<string | null> {
  if (isTauri) return invoke<string | null>("secret_get", { name });
  return localStorage.getItem(DEV_PREFIX + name);
}

export async function secretSet(name: string, value: string): Promise<void> {
  if (isTauri) return invoke("secret_set", { name, value });
  localStorage.setItem(DEV_PREFIX + name, value);
}

export async function secretDelete(name: string): Promise<void> {
  if (isTauri) return invoke("secret_delete", { name });
  localStorage.removeItem(DEV_PREFIX + name);
}

// ---- files ----

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function pickOpenPath(filters: FileFilter[]): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ multiple: false, directory: false, filters });
  return typeof p === "string" ? p : null;
}

export async function pickSavePath(defaultPath: string, filters: FileFilter[]): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters });
}

export async function readText(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export async function writeText(path: string, contents: string): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

export async function readBinary(path: string): Promise<Uint8Array> {
  const b64 = await invoke<string>("read_binary_file", { path });
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return invoke("write_binary_file", { path, base64: btoa(bin) });
}

/** Browser-mode fallback for exports: trigger a download. */
export function downloadBlob(name: string, data: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Browser-mode fallback for opening files: show a file picker. */
export function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank", "noopener");
}
