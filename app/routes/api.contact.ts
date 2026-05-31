import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { contactEmailLooksUnsafe, normalizeContactPlainText } from '~/lib/contact-input-sanitize';
import {
  CONTACT_COUNTRY_OPTIONS,
  CONTACT_ENQUIRY_VALUES,
  getContactDialCodeForCountry,
  type ContactEnquiryValue,
} from '~/lib/contact-form-options';
import { insertContactSubmission } from '~/lib/database';

type ContactResponse = { error?: string; success?: string };

/** Plain-text name & message: same cap so nothing long enough to hide payloads. */
const CONTACT_TEXT_MAX = 125;
const MESSAGE_MIN = 10;
const MAX_PHONE = 40;
const ALLOWED_COUNTRIES = new Set(CONTACT_COUNTRY_OPTIONS.map(o => o.value).filter(Boolean));

function isContactEnquiryValue(v: string): v is ContactEnquiryValue {
  return (CONTACT_ENQUIRY_VALUES as readonly string[]).includes(v);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json<ContactResponse>({ error: 'Method not allowed' }, { status: 405 });
  }

  const formData = await request.formData();
  const enquiryTypeRaw = String(formData.get('enquiryType') ?? '').trim();
  const name = normalizeContactPlainText(String(formData.get('name') ?? ''), false);
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const phoneRaw = normalizeContactPlainText(String(formData.get('phone') ?? ''), false);
  const countryRaw = String(formData.get('country') ?? '').trim();
  const message = normalizeContactPlainText(String(formData.get('message') ?? ''), true);

  if (!enquiryTypeRaw || !isContactEnquiryValue(enquiryTypeRaw)) {
    return json<ContactResponse>({ error: 'Please select a valid topic for your enquiry.' }, { status: 400 });
  }

  if (!name || !email || !message) {
    return json<ContactResponse>({ error: 'Please fill in all required fields.' }, { status: 400 });
  }

  if (name.length > CONTACT_TEXT_MAX) {
    return json<ContactResponse>({ error: `Name must be ${CONTACT_TEXT_MAX} characters or fewer.` }, { status: 400 });
  }

  if (message.length < MESSAGE_MIN) {
    return json<ContactResponse>({ error: `Message must be at least ${MESSAGE_MIN} characters.` }, { status: 400 });
  }

  if (message.length > CONTACT_TEXT_MAX) {
    return json<ContactResponse>(
      { error: `Message must be ${CONTACT_TEXT_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return json<ContactResponse>({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  if (contactEmailLooksUnsafe(email)) {
    return json<ContactResponse>({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  if (!countryRaw || !ALLOWED_COUNTRIES.has(countryRaw)) {
    return json<ContactResponse>({ error: 'Please select the country for your phone (dial code).' }, { status: 400 });
  }

  if (!phoneRaw) {
    return json<ContactResponse>({ error: 'Please enter your phone number.' }, { status: 400 });
  }

  if (phoneRaw.length > MAX_PHONE) {
    return json<ContactResponse>({ error: 'Phone number is too long.' }, { status: 400 });
  }

  if (!/^[\d\s\-+().]{7,40}$/.test(phoneRaw)) {
    return json<ContactResponse>({ error: 'Please enter a valid phone number.' }, { status: 400 });
  }

  const dial = getContactDialCodeForCountry(countryRaw);
  const countryCodeDb = dial.length > 0 ? dial : null;

  const ip =
    request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;
  const userAgent = request.headers.get('User-Agent');

  const insertedId = await insertContactSubmission({
    enquiryType: enquiryTypeRaw,
    name,
    email,
    phone: phoneRaw,
    country: countryRaw,
    countryCode: countryCodeDb,
    message,
    ipAddress: ip,
    userAgent,
  });

  if (!insertedId) {
    return json<ContactResponse>({ error: 'Could not save your message. Please try again later.' }, { status: 500 });
  }

  console.log('[contact form] saved', { id: insertedId, enquiryType: enquiryTypeRaw });

  return json<ContactResponse>({
    success: 'Thank you for reaching out. We will get back to you soon.',
  });
}
