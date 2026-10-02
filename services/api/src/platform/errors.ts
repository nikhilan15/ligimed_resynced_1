export interface FieldError {
  path: string;
  code: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  traceId: string;
  fieldErrors?: FieldError[];
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly type = 'application-error',
  ) {
    super(message);
    this.name = 'AppError';
  }

  get statusCode(): number {
    return this.status;
  }
}
