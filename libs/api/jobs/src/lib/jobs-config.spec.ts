import { jobsConfigFromEnv, retryDelaySeconds } from './jobs-config';

describe('jobs config', () => {
  it('backs off exponentially from the base, up to the maximum', () => {
    const config = { retryBaseSeconds: 10, retryMaxSeconds: 3600 };
    expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => retryDelaySeconds(attempt, config))).toEqual([10, 20, 40, 80, 160, 320, 640]);
    expect(retryDelaySeconds(20, config)).toBe(3600);
  });

  it('reads the environment, with defaults for what is missing or not a positive number', () => {
    expect(jobsConfigFromEnv({})).toMatchObject({ visibilitySeconds: 120, maxAttempts: 8, retryBaseSeconds: 10, pollMs: 1000, alertEmails: [] });
    expect(
      jobsConfigFromEnv({ JOBS_VISIBILITY_SECONDS: '5', JOBS_RETRY_BASE_SECONDS: '-1', JOBS_POLL_MS: 'soon', JOBS_ALERT_EMAILS: ' ops@novan.test, ,dev@novan.test ' }),
    ).toMatchObject({ visibilitySeconds: 5, retryBaseSeconds: 10, pollMs: 1000, alertEmails: ['ops@novan.test', 'dev@novan.test'] });
  });
});
