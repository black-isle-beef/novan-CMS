import packageJson from '../../package.json';
import { CMS_ANGULAR_PACKAGE_NAME, CMS_ANGULAR_VERSION } from './package-info';

describe('package info', () => {
  it('matches the published package name and version', () => {
    expect(CMS_ANGULAR_PACKAGE_NAME).toBe('@black-isle-beef/cms-angular');
    expect(CMS_ANGULAR_VERSION).toBe(packageJson.version);
  });
});
