import { CMS_ANGULAR_PACKAGE_NAME } from './package-info';

describe('CMS_ANGULAR_PACKAGE_NAME', () => {
  it('matches the published package name', () => {
    expect(CMS_ANGULAR_PACKAGE_NAME).toBe('@black-isle-beef/cms-angular');
  });
});
