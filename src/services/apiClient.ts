import { appendDiagnosticLog } from './offlineDb.ts';

let memoryAccessToken = '';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

export function setMemoryToken(token: string) {
  memoryAccessToken = typeof token === 'string' ? token : '';
}

export function getMemoryToken(): string {
  return memoryAccessToken;
}

export function getDeviceDescriptor(): { deviceId: string; deviceName: string } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
  let os = 'Web Browser';
  if (/Windows/i.test(ua)) os = 'Windows PC';
  else if (/Android/i.test(ua)) os = /Mobile/i.test(ua) ? 'Android Mobile' : 'Android Tablet';
  else if (/iPad/i.test(ua)) os = 'iPadOS';
  else if (/iPhone/i.test(ua)) os = 'iOS Mobile';
  else if (/Mac/i.test(ua)) os = 'macOS Desktop';

  const isStandalone =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(display-mode: standalone)').matches;

  const deviceName = `${os}${isStandalone ? ' (Installed App)' : ' (Browser)'}`;
  const deviceId = `${os.toLowerCase().replace(/\s+/g, '-')}-${
    typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'std'
  }`;

  return { deviceId, deviceName };
}

function normalizeHeaders(headersInit?: HeadersInit): Record<string, string> {
  if (!headersInit) return {};
  if (headersInit instanceof Headers) {
    const out: Record<string, string> = {};
    headersInit.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headersInit)) {
    return Object.fromEntries(headersInit);
  }
  return { ...headersInit };
}

async function fetchWithTimeout(
  path: string,
  options: RequestInit,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Request URL path is required.');
  }

  const useOwnAbort = !options.signal && typeof AbortController !== 'undefined';
  const controller = useOwnAbort ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    return await fetch(path, {
      ...options,
      signal: options.signal ?? controller?.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. Check your connection and try again.');
    }
    throw new Error('Network error: unable to reach the server.');
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...normalizeHeaders(options.headers),
  };
  if (memoryAccessToken) {
    headers.Authorization = `Bearer ${memoryAccessToken}`;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(path, {
      ...options,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    void appendDiagnosticLog({
      level: 'error',
      category: 'sync',
      message: `${options.method || 'GET'} ${path}: ${message}`,
    });
    throw err;
  }

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const errObj = data && typeof data === 'object' ? (data as { error?: string; message?: string }) : null;
    const errMsg =
      errObj?.error ||
      errObj?.message ||
      `Request failed (${res.status})`;
    void appendDiagnosticLog({
      level: res.status >= 500 ? 'error' : 'warn',
      category: res.status === 401 ? 'auth' : 'sync',
      message: `${options.method || 'GET'} ${path}: ${errMsg}`,
    });
    throw new Error(errMsg);
  }

  return data as T;
}

export async function fetchAuthorizedBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (memoryAccessToken) {
    headers.Authorization = `Bearer ${memoryAccessToken}`;
  }
  const res = await fetchWithTimeout(path, { headers });
  if (!res.ok) {
    let message = `Failed to download file (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string; message?: string };
      message = json.error || json.message || message;
    } catch {
      // Ignore parse failure
    }
    throw new Error(message);
  }
  return res.blob();
}
