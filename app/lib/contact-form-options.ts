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

/**
 * ISO 3166-1 alpha-2 values (optional field). Labels show ITU-T dial codes.
 * "Other" uses XX (private-use per ISO).
 */
export const CONTACT_COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Country (optional)' },
  { value: 'US', label: 'United States +1' },
  { value: 'GB', label: 'United Kingdom +44' },
  { value: 'CA', label: 'Canada +1' },
  { value: 'AU', label: 'Australia +61' },
  { value: 'NZ', label: 'New Zealand +64' },
  { value: 'IE', label: 'Ireland +353' },
  { value: 'DE', label: 'Germany +49' },
  { value: 'FR', label: 'France +33' },
  { value: 'NL', label: 'Netherlands +31' },
  { value: 'SE', label: 'Sweden +46' },
  { value: 'CH', label: 'Switzerland +41' },
  { value: 'JP', label: 'Japan +81' },
  { value: 'KR', label: 'South Korea +82' },
  { value: 'SG', label: 'Singapore +65' },
  { value: 'HK', label: 'Hong Kong +852' },
  { value: 'CN', label: 'China +86' },
  { value: 'IN', label: 'India +91' },
  { value: 'BR', label: 'Brazil +55' },
  { value: 'MX', label: 'Mexico +52' },
  { value: 'AE', label: 'United Arab Emirates +971' },
  { value: 'SA', label: 'Saudi Arabia +966' },
  { value: 'ZA', label: 'South Africa +27' },
  { value: 'XX', label: 'Other' },
];
