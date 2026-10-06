import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ViewAs } from './view-as';
import { throwError } from 'rxjs';

/** What a refused write answers while viewing as: a problem like the API's, so screens show it the usual way. */
export const viewAsReadOnlyProblem = {
  type: 'about:blank',
  title: 'Read only',
  status: 403,
  code: 'view_as_read_only',
  detail: 'You are viewing this space as another role, so changes are turned off. Stop viewing as to make changes.',
};

/**
 * No impersonated writes: while agency staff view a space as a role, every request that could change something
 * is refused here, before it leaves the browser. Screens hide their buttons as well; this is the backstop.
 * Only the audit record of viewing as itself goes through.
 */
export const viewAsReadOnlyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!inject(ViewAs).current() || req.method === 'GET' || req.method === 'HEAD' || /\/view-as$/.test(req.url)) {
    return next(req);
  }
  return throwError(
    () => new HttpErrorResponse({ status: 403, statusText: 'Forbidden', url: req.url, error: viewAsReadOnlyProblem }),
  );
};
