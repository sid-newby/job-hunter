import type { Job } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function formatDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{ loc: [...], msg }]
    return detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d
        ? `${Array.isArray(d.loc) ? d.loc.join('.') + ': ' : ''}${d.msg}`
        : JSON.stringify(d)))
      .join('\n');
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return null;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(`Cannot reach the API server (${String(err)}). Is the backend running?`, 0);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const detail = data && typeof data === 'object' ? formatDetail((data as { detail?: unknown }).detail) : null;
    const fallback = res.status >= 500 && !text ? ' (is the backend running?)' : '';
    throw new ApiError(detail || `${method} ${url} failed: ${res.status} ${res.statusText}${fallback}`, res.status);
  }
  return data as T;
}

export const getJSON = <T>(url: string) => request<T>('GET', url);
export const postJSON = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
export const putJSON = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
export const del = <T>(url: string) => request<T>('DELETE', url);
export const postForm = <T>(url: string, form: FormData) => request<T>('POST', url, form);

export const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function pollJob<T>(
  jobId: string,
  onLog?: (lines: string[]) => void,
  intervalMs = 2500,
): Promise<Job<T>> {
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const job = await getJSON<Job<T>>(`/api/jobs/${jobId}`);
    onLog?.(job.log || []);
    if (job.status !== 'running') return job;
  }
}
