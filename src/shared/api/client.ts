import { ApiErrorResponse } from './errors';

export class ClientApiError extends Error {
  public code: string;
  public details?: { field: string; message: string }[];
  public requestId?: string;
  public status: number;

  constructor(status: number, response: ApiErrorResponse) {
    super(response.error.message);
    this.name = 'ClientApiError';
    this.status = status;
    this.code = response.error.code;
    this.details = response.error.details;
    this.requestId = response.error.request_id;
  }
}

export const ApiClient = {
  async fetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type');
    
    if (!res.ok) {
      if (contentType && contentType.includes('application/json')) {
        const errorData = await res.json() as ApiErrorResponse;
        throw new ClientApiError(res.status, errorData);
      }
      throw new Error(`HTTP Error ${res.status}`);
    }
    
    if (res.status === 204) {
      return {} as T;
    }
    
    if (contentType && contentType.includes('application/json')) {
      return res.json() as Promise<T>;
    }
    
    return res.text() as Promise<unknown> as Promise<T>;
  },

  /**
   * Utility to map field errors to a record for easy form binding
   */
  mapFieldErrors(error: unknown): Record<string, string> {
    if (error instanceof ClientApiError && error.details) {
      const fieldErrors: Record<string, string> = {};
      for (const detail of error.details) {
        fieldErrors[detail.field] = detail.message;
      }
      return fieldErrors;
    }
    return {};
  }
};
