export interface AiJobRequest<TInput> {
  jobId: string;
  organizationId: string;
  purpose: string;
  modelPolicy: string;
  promptVersion: string;
  input: TInput;
}

export interface AiJobResult<TOutput> {
  jobId: string;
  provider: string;
  model: string;
  output: TOutput;
  requiresHumanReview: boolean;
}

export interface AiProcessor<TInput, TOutput> {
  process(request: AiJobRequest<TInput>): Promise<AiJobResult<TOutput>>;
}
