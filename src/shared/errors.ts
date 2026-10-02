import type { AppError, Result } from './contracts';
export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = <T = never>(code: string, message: string, retryable = false, detail?: string): Result<T> => ({ ok: false, error: { code, message, retryable, detail } });
export function toAppError(error: unknown): AppError {
  const value = error as { code?: string; message?: string; detail?: unknown; retryable?: boolean };
  let detail:string|undefined;try{detail=value?.detail===undefined?undefined:typeof value.detail==='string'?value.detail:JSON.stringify(value.detail);}catch{detail=String(value?.detail);}
  return { code: value?.code ?? 'UNEXPECTED', message: value?.message ?? String(error), retryable: value?.retryable??['EBUSY','EACCES','EXTERNAL_CONFLICT','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(value?.code??''), ...(detail?{detail}:{}) };
}
