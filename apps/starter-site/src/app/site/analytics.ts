/** What gtag.js reads from the page. */
interface AnalyticsWindow extends Window {
  dataLayer?: unknown[];
}

/**
 * Starts Google Analytics 4 for the measurement ID from site settings, in the browser, after the page has loaded (so
 * it never slows the first render). Consent mode starts with storage denied: GA4 then sends cookieless pings and
 * sets no cookies until a consent banner (not part of the starter site) grants it. Loads once per page.
 */
export function startAnalytics(document: Document, measurementId: string): void {
  const window = document.defaultView as AnalyticsWindow | null;
  if (!window || !/^G-[A-Z0-9]{4,16}$/.test(measurementId) || document.getElementById('novan-analytics')) return;

  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads the `arguments` objects it is given, not arrays; the parameter list only types the calls.
  // eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-unused-vars
  const gtag = function (..._args: unknown[]) { window.dataLayer?.push(arguments); };
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  gtag('js', new Date());
  gtag('config', measurementId);

  const script = document.createElement('script');
  script.id = 'novan-analytics';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}
