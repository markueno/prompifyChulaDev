// Email service for Prompify using Twilio SendGrid
import sgMail from '@sendgrid/mail';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

// Initialize SendGrid with API key from environment
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'noreply@prompify.com';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    // If SendGrid API key is not configured, log to console (development mode)
    if (!SENDGRID_API_KEY) {
      console.warn('⚠️  SENDGRID_API_KEY not configured - email will be logged to console only');
      console.log('=== EMAIL SENT (NOT ACTUALLY SENT - NO API KEY) ===');
      console.log('To:', options.to);
      console.log('Subject:', options.subject);
      console.log('HTML:', options.html);
      console.log('===================================================');
      return true; // Return true so registration doesn't fail
    }

    // Send email via Twilio SendGrid
    const msg = {
      to: options.to,
      from: options.from || FROM_EMAIL,
      subject: options.subject,
      text: options.text || options.html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
      html: options.html,
    };

    await sgMail.send(msg);
    
    console.log(`✅ Email sent successfully to ${options.to}`);
    return true;
  } catch (error: any) {
    console.error('❌ Email sending failed:', error);
    
    // Log detailed error information
    if (error.response) {
      console.error('SendGrid Error Response:', {
        status: error.response.status,
        body: error.response.body,
        headers: error.response.headers,
      });
    }
    
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