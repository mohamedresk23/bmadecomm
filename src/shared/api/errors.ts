export type ErrorDetail = {
  field: string;
  message: string;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    request_id?: string;
  };
};

export class ApiError extends Error {
  public statusCode: number;
  public code: string;
  public details?: ErrorDetail[];
  public requestId?: string;

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: ErrorDetail[]) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message: string = 'Unauthorized') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message: string = 'Forbidden') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message: string = 'Not Found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string) {
    return new ApiError(409, 'CONFLICT', message);
  }

  static unprocessableEntity(message: string, details?: ErrorDetail[]) {
    return new ApiError(422, 'UNPROCESSABLE_ENTITY', message, details);
  }

  static internal(message: string = 'Internal Server Error', requestId?: string) {
    const err = new ApiError(500, 'INTERNAL_SERVER_ERROR', message);
    err.requestId = requestId;
    return err;
  }

  toResponse(requestId?: string): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        request_id: requestId || this.requestId,
      }
    };
  }
}
