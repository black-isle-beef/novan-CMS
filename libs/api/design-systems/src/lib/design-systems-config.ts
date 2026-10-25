export const DESIGN_SYSTEMS_CONFIG = Symbol('DESIGN_SYSTEMS_CONFIG');

/** Limits on uploads (docs/build/24-design-systems.md); each has an environment variable for other plans. */
export interface DesignSystemsConfig {
  /** Largest stylesheet, uploaded or fetched (`DS_MAX_FILE_BYTES`, 5 MB). */
  maxFileBytes: number;
  /** New versions a person may start in ten minutes (`DS_UPLOAD_RATE_LIMIT`, 20). */
  uploadsPerTenMinutes: number;
}

export function designSystemsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DesignSystemsConfig {
  const read = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  return {
    maxFileBytes: read('DS_MAX_FILE_BYTES', 5 * 1024 * 1024),
    uploadsPerTenMinutes: read('DS_UPLOAD_RATE_LIMIT', 20),
  };
}
