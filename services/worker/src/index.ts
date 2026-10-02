export interface JobEnvelope<TPayload> {
  id: string;
  type: string;
  attempt: number;
  traceId: string;
  payload: TPayload;
}

export interface JobQueue {
  publish<TPayload>(queue: string, job: JobEnvelope<TPayload>): Promise<void>;
  close(): Promise<void>;
}

export interface JobHandler<TPayload> {
  handle(job: JobEnvelope<TPayload>): Promise<void>;
}
