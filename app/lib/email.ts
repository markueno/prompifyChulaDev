/*
 * Email service for Prompify.
 *
 * Sends real emails via Resend when RESEND_API_KEY is set; otherwise logs to console (dev).
 * Dependency-free on purpose — Resend's REST API is one POST, and the same reasoning that keeps
 * `stripe.server.ts` SDK-less applies here: fewer packages to keep current in the deploy image.
 */

import { TRIAL_PROMPT_LIMIT } from '~/lib/billing/plans';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/*
 * Read env at call time, not module load. The cron routes assign process.env.DATABASE_URL from the
 * Cloudflare context before running a job, and email keys arrive by the same route — a value
 * captured at import would be the one present when the module was first pulled in, not when the
 * mail is actually sent.
 */
function resendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY?.trim() || undefined;
}

/**
 * Resend requires the sender to be on a domain verified in the account. FROM_NAME is optional and
 * only affects how the sender renders in a mail client.
 */
function fromAddress(): string {
  const email = process.env.FROM_EMAIL?.trim() || 'noreply@prompify.com';
  const name = process.env.FROM_NAME?.trim();

  return name ? `${name} <${email}>` : email;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const apiKey = resendApiKey();

  try {
    if (apiKey) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        /*
         * Resend reports refusals (unverified domain, invalid recipient, rate limit) as a non-2xx
         * with a JSON body, not a thrown error. Surfacing that body is the difference between a
         * diagnosable failure and a silent one.
         */
        const detail = await response.text().catch(() => '');
        console.error(`Email sending failed: Resend returned ${response.status}`, detail);

        return false;
      }

      console.log('[Email] Sent via Resend to:', options.to, 'Subject:', options.subject);

      return true;
    }

    // No API key: log only (development)
    console.log('=== EMAIL SENT (log only, no Resend) ===');
    console.log('To:', options.to);
    console.log('Subject:', options.subject);
    console.log('HTML:', options.html);
    console.log('==================');

    return true;
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('Email sending failed:', err.message ?? error);

    return false;
  }
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * Branded shell
 *
 * Every template below is the same chrome with different content, so the chrome lives in one
 * place: change the palette or the footer once and all five follow.
 *
 * Written as nested tables with inline styles, which looks archaic and is not negotiable —
 * Outlook renders mail through Word's HTML engine, which ignores flexbox, grid and most of a
 * <style> block. Tables with explicit widths and attribute-level colours are what survives.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Matches the app's palette (see UserProfile.tsx and landing.css). */
const BRAND = {
  page: '#f7f3ee',
  card: '#ffffff',
  band: '#f0e4d5',
  ink: '#231710',
  muted: '#7a6a58',
  accent: '#f97316',
} as const;

/** Webfonts are unreliable in mail clients, so a system stack is the honest choice. */
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const COMPANY_LINES = [
  'Basic Concept Limited',
  'Room 2702, Convention and Exhibition Plaza, Office Building',
  '1 Harbour Road, Wan Chai',
];

function appUrl(): string {
  return process.env.APP_URL || 'http://localhost:5173';
}

/*
 * The wordmark is served from the app's own public/ directory, so it needs no separate hosting —
 * but that also means it only loads once APP_URL is publicly reachable.
 *
 * It is black on a transparent background, which is why the band behind it is always painted
 * cream: left transparent, a dark-mode client would render it black on black.
 */
function logoUrl(): string {
  return `${appUrl()}/logo-light.png`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface EmailLayout {
  title: string;
  /** Grey text shown next to the subject in the inbox. Without it, clients scrape raw markup. */
  preheader: string;
  heading: string;
  /** Body paragraphs, already HTML. */
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Small print under the button — the paste-this-link fallback, expiry notes, opt-outs. */
  afterCtaHtml?: string;
}

function renderEmail(layout: EmailLayout): string {
  const cta = layout.cta
    ? `
          <tr>
            <td align="center" style="padding: 4px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${BRAND.accent}" style="border-radius: 10px;">
                    <a href="${layout.cta.url}" style="display: inline-block; padding: 13px 30px; font-family: ${FONT}; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px;">${escapeHtml(layout.cta.label)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const afterCta = layout.afterCtaHtml
    ? `
          <tr>
            <td style="padding: 12px 32px 0; font-family: ${FONT}; font-size: 13px; line-height: 1.6; color: ${BRAND.muted};">
              ${layout.afterCtaHtml}
            </td>
          </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(layout.title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.page};">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; height: 0; width: 0;">${escapeHtml(layout.preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${BRAND.page};">
    <tr>
      <td align="center" style="padding: 32px 12px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; background-color: ${BRAND.card}; border: 1px solid ${BRAND.band}; border-radius: 16px; overflow: hidden;">

          <tr>
            <td align="center" bgcolor="${BRAND.band}" style="padding: 26px 24px;">
              <img src="${logoUrl()}" width="140" alt="Prompify" style="display: block; border: 0; outline: none; width: 140px; max-width: 140px; height: auto;">
            </td>
          </tr>

          <tr>
            <td style="padding: 32px 32px 4px; font-family: ${FONT}; font-size: 15px; line-height: 1.65; color: ${BRAND.ink};">
              <h1 style="margin: 0 0 18px; font-family: ${FONT}; font-size: 22px; line-height: 1.3; font-weight: 700; color: ${BRAND.ink};">${escapeHtml(layout.heading)}</h1>
              ${layout.bodyHtml}
            </td>
          </tr>
${cta}${afterCta}

          <tr>
            <td style="padding: 26px 32px 8px; font-family: ${FONT}; font-size: 15px; line-height: 1.65; color: ${BRAND.ink};">
              <p style="margin: 0;">Warmly,<br><strong>The Prompify Team</strong></p>
            </td>
          </tr>

          <tr>
            <td style="padding: 22px 32px 28px; font-family: ${FONT}; font-size: 12px; line-height: 1.65; color: ${BRAND.muted};">
              <div style="border-top: 1px solid ${BRAND.band}; padding-top: 18px;">
                <p style="margin: 0 0 10px;">${COMPANY_LINES.map(escapeHtml).join('<br>')}</p>
                <p style="margin: 0;">This message was sent by Prompify. Please don't reply to this address &mdash; it isn't monitored.</p>
              </div>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text twin of renderEmail. Sent with every message; some clients show only this. */
function renderText(parts: {
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  after?: string;
}): string {
  const lines = [parts.heading, '', parts.body.trim()];

  if (parts.ctaUrl) {
    lines.push('', `${parts.ctaLabel ?? 'Open'}: ${parts.ctaUrl}`);
  }

  if (parts.after) {
    lines.push('', parts.after.trim());
  }

  lines.push(
    '',
    'Warmly,',
    'The Prompify Team',
    '',
    ...COMPANY_LINES,
    '',
    "This message was sent by Prompify. Please don't reply to this address — it isn't monitored."
  );

  return lines.join('\n');
}

/** The "if the button doesn't work" fallback every transactional email needs. */
function linkFallback(url: string): string {
  return `<p style="margin: 0;">If the button doesn't work, paste this into your browser:</p>
              <p style="margin: 6px 0 0; word-break: break-all;"><a href="${url}" style="color: ${BRAND.accent};">${escapeHtml(url)}</a></p>`;
}

export async function sendVerificationEmail(email: string, token: string): Promise<boolean> {
  // Use /api/auth/verify?token=... so a single GET verifies and redirects (no loader POST needed)
  const verificationUrl = `${appUrl()}/api/auth/verify?token=${token}`;

  const html = renderEmail({
    title: 'Confirm your email',
    preheader: 'One quick click and your Prompify account is ready.',
    heading: 'Welcome — one quick step',
    bodyHtml: `<p style="margin: 0 0 14px;">Thanks for signing up to Prompify. Confirm your email address and your account is ready to use.</p>
              <p style="margin: 0 0 4px;">This link works for the next 24 hours.</p>`,
    cta: { label: 'Confirm my email', url: verificationUrl },
    afterCtaHtml: `${linkFallback(verificationUrl)}
              <p style="margin: 14px 0 0;">If you didn't create a Prompify account, you can safely ignore this — nothing will happen.</p>`,
  });

  const text = renderText({
    heading: 'Welcome — one quick step',
    body: 'Thanks for signing up to Prompify. Confirm your email address and your account is ready to use.\n\nThis link works for the next 24 hours.',
    ctaLabel: 'Confirm my email',
    ctaUrl: verificationUrl,
    after: "If you didn't create a Prompify account, you can safely ignore this — nothing will happen.",
  });

  return await sendEmail({ to: email, subject: 'Confirm your Prompify email', html, text });
}

/**
 * Greet a new account once its email is confirmed.
 *
 * Sent on verification rather than at signup so it doesn't land in the same breath as the
 * verification mail, and so only confirmed addresses are ever mailed — a fresh sending domain
 * builds reputation on delivered mail, and unverified signups are where the bad addresses are.
 */
export async function sendWelcomeEmail(email: string): Promise<boolean> {
  // Read from the catalog so the copy can never contradict what the gate actually enforces.
  const prompts = TRIAL_PROMPT_LIMIT;

  const html = renderEmail({
    title: 'Welcome to Prompify',
    preheader: "You're all set — here's the quickest way to start.",
    heading: "You're all set",
    bodyHtml: `<p style="margin: 0 0 14px;">Your email is confirmed and your account is ready.</p>
              <p style="margin: 0 0 14px;">You're on the free trial, which includes <strong>${prompts} prompts</strong> — enough to see what Prompify does with a real idea rather than a toy one.</p>
              <p style="margin: 0 0 4px;">The quickest start is to describe something you actually want built, in plain words, and let Prompify draft the prompt for you.</p>`,
    cta: { label: 'Start building', url: `${appUrl()}/app` },
    afterCtaHtml: `<p style="margin: 0;">When you're ready for more room, the plans are on your <a href="${appUrl()}/app/pricing" style="color: ${BRAND.accent};">pricing page</a> — monthly or annual.</p>`,
  });

  const text = renderText({
    heading: "You're all set",
    body: `Your email is confirmed and your account is ready.\n\nYou're on the free trial, which includes ${prompts} prompts — enough to see what Prompify does with a real idea rather than a toy one.\n\nThe quickest start is to describe something you actually want built, in plain words, and let Prompify draft the prompt for you.`,
    ctaLabel: 'Start building',
    ctaUrl: `${appUrl()}/app`,
    after: `When you're ready for more room, the plans are at ${appUrl()}/app/pricing — monthly or annual.`,
  });

  return await sendEmail({ to: email, subject: 'Welcome to Prompify', html, text });
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  const resetUrl = `${appUrl()}/auth/reset-password?token=${token}`;

  const html = renderEmail({
    title: 'Reset your password',
    preheader: 'A link to choose a new Prompify password.',
    heading: 'Choose a new password',
    bodyHtml: `<p style="margin: 0 0 14px;">We received a request to reset the password on your Prompify account. Use the button below to set a new one.</p>
              <p style="margin: 0 0 4px;">For your security, this link expires in one hour.</p>`,
    cta: { label: 'Set a new password', url: resetUrl },
    afterCtaHtml: `${linkFallback(resetUrl)}
              <p style="margin: 14px 0 0;">If you didn't ask for this, you can ignore it — your current password stays exactly as it is.</p>`,
  });

  const text = renderText({
    heading: 'Choose a new password',
    body: 'We received a request to reset the password on your Prompify account. Use the link below to set a new one.\n\nFor your security, this link expires in one hour.',
    ctaLabel: 'Set a new password',
    ctaUrl: resetUrl,
    after: "If you didn't ask for this, you can ignore it — your current password stays exactly as it is.",
  });

  return await sendEmail({ to: email, subject: 'Reset your Prompify password', html, text });
}

/**
 * Nudge an account that hasn't signed in for a while.
 *
 * Deliberately quiet about billing — someone who stopped showing up is not a lead to upsell, and
 * a win-back that opens with a price is the one that gets marked as spam. Reassuring them their
 * work is still there is the part that actually brings people back.
 */
export async function sendInactivityEmail(params: {
  email: string;
  /** Whole days since last sign-in, as measured by the job that sends this. */
  daysInactive: number;
  /** True on the last nudge we will send, so the reader knows the reminders stop here. */
  finalNudge: boolean;
}): Promise<boolean> {
  const signOff = params.finalNudge
    ? `<p style="margin: 0;">This is the last reminder we'll send about this — your account and everything in it stay exactly where they are either way.</p>`
    : '';

  const html = renderEmail({
    title: 'Your projects are waiting',
    preheader: 'Everything you built is still here, exactly as you left it.',
    heading: 'Still here whenever you are',
    bodyHtml: `<p style="margin: 0 0 14px;">It's been about <strong>${params.daysInactive} days</strong> since you last signed in to Prompify.</p>
              <p style="margin: 0 0 4px;">Your projects, chats and history are all still there, exactly as you left them. Nothing has been archived or removed.</p>`,
    cta: { label: 'Pick up where you left off', url: `${appUrl()}/app` },
    afterCtaHtml: signOff || undefined,
  });

  const text = renderText({
    heading: 'Still here whenever you are',
    body: `It's been about ${params.daysInactive} days since you last signed in to Prompify.\n\nYour projects, chats and history are all still there, exactly as you left them. Nothing has been archived or removed.`,
    ctaLabel: 'Pick up where you left off',
    ctaUrl: `${appUrl()}/app`,
    after: params.finalNudge
      ? "This is the last reminder we'll send about this — your account and everything in it stay exactly where they are either way."
      : undefined,
  });

  return await sendEmail({ to: params.email, subject: 'Your Prompify projects are waiting', html, text });
}

export async function sendInvitationEmail(
  inviteeEmail: string,
  inviterEmail: string,
  projectName: string,
  acceptUrl: string
): Promise<boolean> {
  const displayProjectName = projectName?.trim() || 'a project';
  const inviterDisplay = inviterEmail.split('@')[0].replace(/[._]/g, ' ');

  const html = renderEmail({
    title: 'You have been invited',
    preheader: `${inviterDisplay} invited you to collaborate on ${displayProjectName}.`,
    heading: "You've been invited to collaborate",
    bodyHtml: `<p style="margin: 0 0 14px;"><strong>${escapeHtml(inviterDisplay)}</strong> (${escapeHtml(inviterEmail)}) has invited you to join <strong>${escapeHtml(displayProjectName)}</strong> on Prompify.</p>
              <p style="margin: 0 0 4px;">You'll be able to see the chat history, the code and the live preview, and work on it together.</p>`,
    cta: { label: 'Accept invitation', url: acceptUrl },
    afterCtaHtml: `${linkFallback(acceptUrl)}
              <p style="margin: 14px 0 0;">This invitation expires in 7 days. If you don't have a Prompify account yet, you'll be asked to create one first. Weren't expecting this? You can safely ignore it.</p>`,
  });

  const text = renderText({
    heading: "You've been invited to collaborate",
    body: `${inviterDisplay} (${inviterEmail}) has invited you to join "${displayProjectName}" on Prompify.\n\nYou'll be able to see the chat history, the code and the live preview, and work on it together.`,
    ctaLabel: 'Accept invitation',
    ctaUrl: acceptUrl,
    after:
      "This invitation expires in 7 days. If you don't have a Prompify account yet, you'll be asked to create one first. Weren't expecting this? You can safely ignore it.",
  });

  return await sendEmail({
    to: inviteeEmail,
    subject: `You've been invited to "${displayProjectName}" on Prompify`,
    html,
    text,
  });
}
