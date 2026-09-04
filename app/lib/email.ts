/*
 * Email service for Prompify.
 *
 * Sends real emails via Resend when RESEND_API_KEY is set; otherwise logs to console (dev).
 * Dependency-free on purpose — Resend's REST API is one POST, and the same reasoning that keeps
 * `stripe.server.ts` SDK-less applies here: fewer packages to keep current in the deploy image.
 */

import { FREE_TIER_ID, getPlan } from '~/lib/billing/plans';

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

export async function sendVerificationEmail(email: string, token: string): Promise<boolean> {
  // Use /api/auth/verify?token=... so a single GET verifies and redirects (no loader POST needed)
  const verificationUrl = `${process.env.APP_URL || 'http://localhost:5173'}/api/auth/verify?token=${token}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Verify your Prompify account</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #007bff; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to Prompify!</h1>
        </div>
        <div class="content">
          <h2>Verify your email address</h2>
          <p>Thank you for creating your Prompify account. To complete your registration, please click the button below to verify your email address:</p>
          <p style="text-align: center;">
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
          </p>
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
          <p><strong>This link will expire in 24 hours.</strong></p>
          <p>If you didn't create a Prompify account, you can safely ignore this email.</p>
        </div>
        <div class="footer">
          <p>This email was sent by Prompify. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Welcome to Prompify!
    
    Verify your email address
    
    Thank you for creating your Prompify account. To complete your registration, please visit this link:
    
    ${verificationUrl}
    
    This link will expire in 24 hours.
    
    If you didn't create a Prompify account, you can safely ignore this email.
  `;

  return await sendEmail({
    to: email,
    subject: 'Verify your Prompify account',
    html: htmlContent,
    text: textContent,
  });
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  const resetUrl = `${process.env.APP_URL || 'http://localhost:5173'}/auth/reset-password?token=${token}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Reset your Prompify password</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .button { display: inline-block; padding: 12px 24px; background: #dc3545; color: white; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Reset your password</h1>
        </div>
        <div class="content">
          <h2>Password reset requested</h2>
          <p>We received a request to reset your Prompify password. Click the button below to create a new password:</p>
          <p style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </p>
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${resetUrl}</p>
          <p><strong>This link will expire in 1 hour.</strong></p>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
        </div>
        <div class="footer">
          <p>This email was sent by Prompify. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Reset your Prompify password
    
    Password reset requested
    
    We received a request to reset your Prompify password. Please visit this link to create a new password:
    
    ${resetUrl}
    
    This link will expire in 1 hour.
    
    If you didn't request a password reset, you can safely ignore this email.
  `;

  return await sendEmail({
    to: email,
    subject: 'Reset your Prompify password',
    html: htmlContent,
    text: textContent,
  });
}

/**
 * Warn a free-tier account that rolled-over tokens are at (or over) the carry-over ceiling.
 *
 * Sent from the monthly refresh job, so it reaches people who are not opening the app — which is
 * the entire population this matters to. An in-app banner can only warn someone who logs in, and
 * someone who logs in is spending tokens rather than stockpiling them.
 */
export async function sendTokenCarryOverWarningEmail(params: {
  email: string;
  carriedTokens: number;
  forfeitedTokens: number;
  capTokens: number;
  nextRenewal: Date;
  /** 1-based position in the warning streak, for the sign-off. */
  warningNumber: number;
  /** True on the last warning we will send, so the reader knows the reminders stop here. */
  finalWarning: boolean;
}): Promise<boolean> {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const renewalDate = params.nextRenewal.toISOString().slice(0, 10);
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  const lostLine =
    params.forfeitedTokens > 0
      ? `<p><strong>${fmt(params.forfeitedTokens)} unused tokens expired this month</strong> because your balance was over the ${fmt(params.capTokens)} carry-over ceiling.</p>`
      : `<p>Your balance has reached the <strong>${fmt(params.capTokens)} carry-over ceiling</strong>. Any unused tokens above that will expire at your next renewal.</p>`;

  const signOff = params.finalWarning
    ? `<p style="color: #666; font-size: 13px;">This is the last reminder we'll send about this — your monthly top-up carries on either way, and your account stays open.</p>`
    : '';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Your Prompify tokens are stacking up</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f0ad4e; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your tokens are stacking up</h1>
        </div>
        <div class="content">
          <p>Your free Prompify plan tops up every month, and unused tokens roll over — but only up to a limit.</p>
          ${lostLine}
          <p>You currently have <strong>${fmt(params.carriedTokens)} rolled-over tokens</strong>, and your next top-up lands on <strong>${renewalDate}</strong>.</p>
          <p>Your projects are safe and untouched — this only affects unused tokens.</p>
          <p style="text-align: center;">
            <a href="${appUrl}/app" class="button">Pick up where you left off</a>
          </p>
          ${signOff}
        </div>
        <div class="footer">
          <p>This email was sent by Prompify. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Your tokens are stacking up

    Your free Prompify plan tops up every month, and unused tokens roll over — but only up to a limit.

    ${
      params.forfeitedTokens > 0
        ? `${fmt(params.forfeitedTokens)} unused tokens expired this month because your balance was over the ${fmt(params.capTokens)} carry-over ceiling.`
        : `Your balance has reached the ${fmt(params.capTokens)} carry-over ceiling. Any unused tokens above that will expire at your next renewal.`
    }

    You currently have ${fmt(params.carriedTokens)} rolled-over tokens, and your next top-up lands on ${renewalDate}.

    Your projects are safe and untouched — this only affects unused tokens.

    ${appUrl}/app
    ${params.finalWarning ? "\n    This is the last reminder we'll send about this — your monthly top-up carries on either way, and your account stays open." : ''}
  `;

  return await sendEmail({
    to: params.email,
    subject: 'Your Prompify tokens are about to expire',
    html: htmlContent,
    text: textContent,
  });
}

/**
 * Greet a new account once its email is confirmed.
 *
 * Sent on verification rather than at signup so it doesn't land in the same breath as the
 * verification mail, and so only confirmed addresses are ever mailed — a fresh sending domain
 * builds reputation on delivered mail, and unverified signups are where the bad addresses are.
 */
export async function sendWelcomeEmail(email: string): Promise<boolean> {
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const freePlan = getPlan(FREE_TIER_ID);
  const monthlyTokens = (freePlan?.tokens ?? 150_000).toLocaleString('en-US');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome to Prompify</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #007bff; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>You're in</h1>
        </div>
        <div class="content">
          <h2>Welcome to Prompify</h2>
          <p>Your email is verified and your account is ready to use.</p>
          <p>You're on the <strong>Free plan</strong>, which tops up <strong>${monthlyTokens} tokens</strong> every month. Unused tokens roll over, up to a limit — so there's no rush to spend them.</p>
          <p>The quickest way to see what Prompify does is to describe something you want built and let it draft the prompt for you.</p>
          <p style="text-align: center;">
            <a href="${appUrl}/app" class="button">Start building</a>
          </p>
          <p>If you ever need more room, the paid plans are on the <a href="${appUrl}/app/pricing">pricing page</a>, monthly or annual.</p>
        </div>
        <div class="footer">
          <p>This email was sent by Prompify. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Welcome to Prompify

    Your email is verified and your account is ready to use.

    You're on the Free plan, which tops up ${monthlyTokens} tokens every month. Unused tokens roll over, up to a limit — so there's no rush to spend them.

    The quickest way to see what Prompify does is to describe something you want built and let it draft the prompt for you.

    Start building: ${appUrl}/app

    If you ever need more room, the paid plans are at ${appUrl}/app/pricing, monthly or annual.
  `;

  return await sendEmail({
    to: email,
    subject: 'Welcome to Prompify',
    html: htmlContent,
    text: textContent,
  });
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
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  const signOff = params.finalNudge
    ? `<p style="color: #666; font-size: 13px;">This is the last reminder we'll send — your account and your projects stay exactly where they are either way.</p>`
    : '';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Your Prompify projects are waiting</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #007bff; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Still here when you are</h1>
        </div>
        <div class="content">
          <p>It's been about <strong>${params.daysInactive} days</strong> since you last signed in to Prompify.</p>
          <p>Your projects, chats and history are all still there, untouched. Your free tokens have kept topping up each month while you've been away.</p>
          <p style="text-align: center;">
            <a href="${appUrl}/app" class="button">Pick up where you left off</a>
          </p>
          ${signOff}
        </div>
        <div class="footer">
          <p>This email was sent by Prompify. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Still here when you are

    It's been about ${params.daysInactive} days since you last signed in to Prompify.

    Your projects, chats and history are all still there, untouched. Your free tokens have kept topping up each month while you've been away.

    Pick up where you left off: ${appUrl}/app
    ${params.finalNudge ? "\n    This is the last reminder we'll send — your account and your projects stay exactly where they are either way." : ''}
  `;

  return await sendEmail({
    to: params.email,
    subject: 'Your Prompify projects are waiting',
    html: htmlContent,
    text: textContent,
  });
}

export async function sendInvitationEmail(
  inviteeEmail: string,
  inviterEmail: string,
  projectName: string,
  acceptUrl: string
): Promise<boolean> {
  const displayProjectName = projectName?.trim() || 'a project';
  const inviterDisplay = inviterEmail.split('@')[0].replace(/[._]/g, ' ');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Project invitation - Prompify</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #007bff; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Project invitation</h1>
        </div>
        <div class="content">
          <h2>You've been invited to collaborate</h2>
          <p><strong>${inviterDisplay}</strong> (${inviterEmail}) has invited you to join the project <strong>${displayProjectName}</strong> on Prompify.</p>
          <p>You'll be able to access the chat history, code, and preview. Click the button below to accept the invitation:</p>
          <p style="text-align: center;">
            <a href="${acceptUrl}" class="button">Accept invitation</a>
          </p>
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${acceptUrl}</p>
          <p><strong>This link will expire in 7 days.</strong></p>
          <p>If you don't have a Prompify account, you'll need to sign up first. If you weren't expecting this invitation, you can safely ignore this email.</p>
        </div>
        <div class="footer">
          <p>This email was sent by Prompify. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Project invitation - Prompify

    You've been invited to collaborate

    ${inviterDisplay} (${inviterEmail}) has invited you to join the project "${displayProjectName}" on Prompify.

    You'll be able to access the chat history, code, and preview. Accept the invitation by visiting:

    ${acceptUrl}

    This link will expire in 7 days.

    If you don't have a Prompify account, you'll need to sign up first. If you weren't expecting this invitation, you can safely ignore this email.
  `;

  return await sendEmail({
    to: inviteeEmail,
    subject: `You've been invited to "${displayProjectName}" on Prompify`,
    html: htmlContent,
    text: textContent,
  });
}
