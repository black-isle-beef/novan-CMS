import { contactForm } from './contact.data';
import { CONSENT_COOKIE, consentCategories, storageRegister } from './cookies.data';
import { features } from './features.data';
import { accessibilityStatement, cookiePolicy, type LegalDocument, privacyPolicy } from './legal.data';
import { pricing } from './pricing.data';
import { footerLinks, pages, primaryCta, primaryNav } from './site.data';

const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const pagePaths = new Set(Object.values(pages).map((page) => page.path));

describe('marketing content', () => {
  describe('site', () => {
    it('links the header, footer and call to action to pages that exist', () => {
      const linked = [...primaryNav, primaryCta, ...footerLinks.flatMap((group) => group.links)];
      for (const link of linked) expect(pagePaths, link.label).toContain(link.path);
    });

    it('preselects an enquiry type the contact form offers', () => {
      const values = contactForm.enquiryTypes.map((type) => type.value as string);
      expect(values).toContain(primaryCta.queryParams?.['enquiry']);
      for (const plan of pricing.plans) {
        const enquiry = plan.cta.queryParams?.['enquiry'];
        if (enquiry) expect(values).toContain(enquiry);
      }
    });

    it('keeps every page title short enough for search results', () => {
      for (const page of Object.values(pages)) {
        expect(page.title.length, page.title).toBeLessThanOrEqual(60);
        expect(page.description.length, page.title).toBeLessThanOrEqual(160);
      }
    });
  });

  describe('features', () => {
    it('have unique kebab-case anchor ids', () => {
      const ids = features.map((feature) => feature.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(kebab);
    });

    it('highlight three to six available features on the home page', () => {
      const highlights = features.filter((feature) => feature.highlight);
      expect(highlights.length).toBeGreaterThanOrEqual(3);
      expect(highlights.length).toBeLessThanOrEqual(6);
      expect(highlights.every((feature) => feature.status === 'available')).toBe(true);
    });
  });

  describe('pricing', () => {
    it('is in pounds and says whether VAT is included', () => {
      expect(pricing.currency).toBe('GBP');
      expect(pricing.vatNote).toMatch(/VAT/);
    });

    it('highlights exactly one plan and gives prices as whole pounds or none', () => {
      expect(pricing.plans.filter((plan) => plan.highlighted)).toHaveLength(1);
      for (const plan of pricing.plans) {
        if (plan.price !== null) expect(Number.isInteger(plan.price) && plan.price >= 0).toBe(true);
      }
    });

    it('has a comparison value for every plan in every row', () => {
      const ids = pricing.plans.map((plan) => plan.id);
      for (const row of pricing.comparison) expect(Object.keys(row.values).sort(), row.feature).toEqual([...ids].sort());
    });
  });

  describe('legal documents', () => {
    const documents: LegalDocument[] = [privacyPolicy, cookiePolicy, accessibilityStatement];

    it('have a valid last-updated date and unique kebab-case section ids', () => {
      for (const document of documents) {
        expect(Number.isNaN(Date.parse(document.lastUpdated)), document.title).toBe(false);
        const ids = document.sections.map((section) => section.id);
        expect(new Set(ids).size, document.title).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(kebab);
      }
    });

    it('list the cookie register and a way to change choices in the cookie policy', () => {
      const kinds = cookiePolicy.sections.flatMap((section) => section.blocks.map((block) => block.kind));
      expect(kinds).toContain('storage-table');
      expect(kinds).toContain('cookie-settings');
    });
  });

  describe('cookies', () => {
    it('lists the consent cookie as strictly necessary', () => {
      expect(storageRegister.find((item) => item.name === CONSENT_COOKIE)?.category).toBe('necessary');
    });

    it('files every item under a known category, and only strictly necessary storage is required', () => {
      const ids = consentCategories.map((category) => category.id);
      for (const item of storageRegister) expect(ids).toContain(item.category);
      expect(consentCategories.filter((category) => category.required).map((category) => category.id)).toEqual(['necessary']);
    });
  });

  describe('contact form', () => {
    it('has unique enquiry types with short labels the CMS form can offer', () => {
      const values = contactForm.enquiryTypes.map((type) => type.value);
      expect(new Set(values).size).toBe(values.length);
      expect(values).toEqual(['general', 'sales', 'support', 'demo']);
    });
  });
});
