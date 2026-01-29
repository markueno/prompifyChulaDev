// Email service for Prompify
// Sends real emails via SendGrid when SENDGRID_API_KEY is set; otherwise logs to console (dev).

import sgMail from '@sendgrid/mail';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY?.trim();
const FROM_EMAIL = process.env.FROM_EMAIL?.trim() || 'noreply@prompify.com';

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    if (SENDGRID_API_KEY) {
      sgMail.setApiKey(SENDGRID_API_KEY);
      await sgMail.send({
        to: options.to,
        from: FROM_EMAIL,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      console.log('[Email] Sent via SendGrid to:', options.to, 'Subject:', options.subject);
      return true;
    }

    // No API key: log only (development)
    console.log('=== EMAIL SENT (log only, no SendGrid) ===');
    console.log('To:', options.to);
    console.log('Subject:', options.subject);
    console.log('HTML:', options.html);
    console.log('==================');
    return true;
  } catch (error: unknown) {
    const err = error as { response?: { body?: unknown }; message?: string };
    console.error('Email sending failed:', err.message ?? error);
    if (err.response?.body) console.error('SendGrid response:', err.response.body);
    return false;
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<boolean> {
  const verificationUrl = `${process.env.APP_URL || 'http://localhost:5173'}/auth/verify?token=${token}`;
  
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
    text: textContent
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
    text: textContent
  });
} 