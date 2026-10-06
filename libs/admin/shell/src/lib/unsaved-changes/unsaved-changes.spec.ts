import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Confirm } from '../confirm/confirm';
import { type HasUnsavedChanges, unsavedChangesGuard, warnBeforeUnload } from './unsaved-changes';

const leave = (component: HasUnsavedChanges) =>
  TestBed.runInInjectionContext(() =>
    unsavedChangesGuard(component, {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot, {} as RouterStateSnapshot),
  );

describe('unsavedChangesGuard', () => {
  it('lets the person leave a screen with nothing unsaved without asking', () => {
    expect(leave({ hasUnsavedChanges: () => false })).toBe(true);
    expect(TestBed.inject(Confirm).request()).toBeNull();
  });

  it('asks first when there are unsaved changes, and stays unless they choose to leave', async () => {
    const confirm = TestBed.inject(Confirm);
    const stay = leave({ hasUnsavedChanges: () => true }) as Promise<boolean>;
    expect(confirm.request()).toMatchObject({ heading: 'Leave without saving?', confirmLabel: 'Leave without saving', destructive: true });
    confirm.request()?.answer(false);
    await expect(stay).resolves.toBe(false);

    const go = leave({ hasUnsavedChanges: () => true }) as Promise<boolean>;
    confirm.request()?.answer(true);
    await expect(go).resolves.toBe(true);
  });
});

@Component({ template: '' })
class Form {
  dirty = false;
  constructor() {
    warnBeforeUnload(() => this.dirty);
  }
}

describe('warnBeforeUnload', () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('has the browser ask only while there are unsaved changes, until the screen is gone', () => {
    const fixture = TestBed.createComponent(Form);
    expect(unload()).toBe(false);
    fixture.componentInstance.dirty = true;
    expect(unload()).toBe(true);

    fixture.destroy();
    expect(unload()).toBe(false);
  });
});
