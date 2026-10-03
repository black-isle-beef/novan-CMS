/** Body of `GET /health` on the Novan API. */
export interface HealthResponse {
  status: 'ok';
  /** Release version of the running API (git tag or SHA; `0.0.0-dev` locally). */
  version: string;
}
