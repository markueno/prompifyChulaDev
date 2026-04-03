/** Allowed enquiry values for /api/contact (Salesforce-style routing). */
export const CONTACT_ENQUIRY_VALUES = [
  'sales',
  'demo',
  'subscribe',
  'support',
  'enterprise',
  'partnership',
  'billing',
  'privacy',
  'press',
  'general',
  'other',
] as const;

export type ContactEnquiryValue = (typeof CONTACT_ENQUIRY_VALUES)[number];

export const CONTACT_ENQUIRY_OPTIONS: { value: ContactEnquiryValue; label: string }[] = [
  { value: 'general', label: 'General inquiry' },
  { value: 'sales', label: 'Sales & pricing' },
  { value: 'demo', label: 'Product demo / trial' },
  { value: 'subscribe', label: "I'm interested in subscribing" },
  { value: 'support', label: 'Technical support' },
  { value: 'enterprise', label: 'Enterprise, security & compliance' },
  { value: 'partnership', label: 'Partnerships & alliances' },
  { value: 'billing', label: 'Billing & subscriptions' },
  { value: 'privacy', label: 'Privacy & data protection' },
  { value: 'press', label: 'Media & press' },
  { value: 'other', label: 'Other' },
];

/** One row per ISO option; `dialCode` is ITU-T country calling code (empty for unknown / Other). */
export type ContactCountryOption = { value: string; label: string; dialCode: string };

/**
 * ISO 3166-1 alpha-2 values. Labels show dial codes; stored separately in DB as `country` + `country_code`.
 * "Other" uses XX (private-use per ISO).
 */
export const CONTACT_COUNTRY_OPTIONS: ContactCountryOption[] = [
  { value: 'US', label: 'United States +1', dialCode: '+1' },
  { value: 'GB', label: 'United Kingdom +44', dialCode: '+44' },
  { value: 'CA', label: 'Canada +1', dialCode: '+1' },
  { value: 'AU', label: 'Australia +61', dialCode: '+61' },
  { value: 'NZ', label: 'New Zealand +64', dialCode: '+64' },
  { value: 'IE', label: 'Ireland +353', dialCode: '+353' },
  { value: 'DE', label: 'Germany +49', dialCode: '+49' },
  { value: 'FR', label: 'France +33', dialCode: '+33' },
  { value: 'NL', label: 'Netherlands +31', dialCode: '+31' },
  { value: 'SE', label: 'Sweden +46', dialCode: '+46' },
  { value: 'CH', label: 'Switzerland +41', dialCode: '+41' },
  { value: 'JP', label: 'Japan +81', dialCode: '+81' },
  { value: 'KR', label: 'South Korea +82', dialCode: '+82' },
  { value: 'SG', label: 'Singapore +65', dialCode: '+65' },
  { value: 'HK', label: 'Hong Kong +852', dialCode: '+852' },
  { value: 'CN', label: 'China +86', dialCode: '+86' },
  { value: 'IN', label: 'India +91', dialCode: '+91' },
  { value: 'BR', label: 'Brazil +55', dialCode: '+55' },
  { value: 'MX', label: 'Mexico +52', dialCode: '+52' },
  { value: 'AE', label: 'United Arab Emirates +971', dialCode: '+971' },
  { value: 'SA', label: 'Saudi Arabia +966', dialCode: '+966' },
  { value: 'ZA', label: 'South Africa +27', dialCode: '+27' },
  { value: 'XX', label: 'Other', dialCode: '' },
];

/** Lookup ITU-T dial code for a stored ISO country value (empty string if none / Other). */
export function getContactDialCodeForCountry(iso: string): string {
  const o = CONTACT_COUNTRY_OPTIONS.find((x) => x.value === iso);
  return o?.dialCode ?? '';
}
