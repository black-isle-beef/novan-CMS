/** The logo as the header shows it, sized by `SiteLayout`. */
export interface ChromeLogo {
  src: string;
  width: number | null;
  height: number;
}

/** The contact details, with the address as lines and the phone number as a `tel:` link. */
export interface ChromeContact {
  email: string | null;
  phone: string | null;
  tel: string | null;
  address: string[];
}
