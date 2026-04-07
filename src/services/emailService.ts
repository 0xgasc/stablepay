import { Resend } from 'resend';
import { db } from '../config/database';
import { pdfService } from './pdfService';
import { logger } from '../utils/logger';

// Initialize Resend client (will be null if no API key)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const BASE_URL = (process.env.BASE_URL || 'https://wetakestables.shop').trim();
const FROM_EMAIL = (process.env.FROM_EMAIL || 'StablePay <hello@wetakestables.shop>').trim();

class EmailService {
  /**
   * Check if email service is configured
   */
  isConfigured(): boolean {
    return resend !== null;
  }

  /**
   * Send email verification code to new merchant
   */
  async sendVerificationEmail(email: string, code: string, contactName: string): Promise<boolean> {
    if (!resend) {
      logger.warn('Email service not configured, skipping verification email', { email });
      return false;
    }

    try {
      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `${code} is your StablePay verification code`,
        html: this.renderVerificationEmail(code, contactName)
      });

      if (error) {
        logger.error('Failed to send verification email', error as Error, { email });
        return false;
      }

      logger.info('Verification email sent', { email, messageId: data?.id });
      return true;
    } catch (error) {
      logger.error('Error sending verification email', error as Error, { email });
      return false;
    }
  }

  /**
   * Render verification email HTML
   */
  private renderVerificationEmail(code: string, contactName: string): string {
    const digits = code.split('');
    const digitBoxes = digits.map(d =>
      `<td style="width: 48px; height: 56px; text-align: center; font-size: 28px; font-weight: 700; font-family: monospace; border: 4px solid #000; background: #f4f4f5; margin: 0 4px;">${d}</td>`
    ).join('<td style="width: 8px;"></td>');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #000000; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;">STABLEPAY</h1>
              <p style="color: #a1a1aa; margin: 10px 0 0 0; font-size: 14px;">Verify your email address</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #18181b;">
                Hi${contactName ? ` ${contactName}` : ''},
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; color: #52525b;">
                Enter this verification code to activate your StablePay account:
              </p>

              <!-- Code Box -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto 30px auto;">
                <tr>${digitBoxes}</tr>
              </table>

              <p style="margin: 0 0 10px 0; font-size: 14px; color: #71717a; text-align: center;">
                This code expires in <strong>15 minutes</strong>.
              </p>
              <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">
                If you didn't sign up for StablePay, you can ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 20px 30px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #71717a;">
                Powered by <a href="https://wetakestables.shop" style="color: #000000; text-decoration: none;">StablePay</a> - Stablecoin Payment Infrastructure
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  /**
   * Send invoice email to customer
   */
  async sendInvoice(invoiceId: string): Promise<boolean> {
    if (!resend) {
      logger.warn('Email service not configured, skipping invoice email', { invoiceId });
      return false;
    }

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (!invoice.customerEmail) {
      throw new Error('Customer email is required');
    }

    try {
      // Generate PDF
      const pdfBuffer = await pdfService.generateInvoicePDF(invoice);
      const paymentUrl = `${BASE_URL}/pay/${invoice.id}`;

      // Send email
      const { data, error } = await resend.emails.send({
        from: `${invoice.merchant.companyName} via ${FROM_EMAIL}`,
        to: invoice.customerEmail,
        subject: `Invoice ${invoice.invoiceNumber} from ${invoice.merchant.companyName}`,
        html: this.renderInvoiceEmail(invoice, paymentUrl),
        attachments: [{
          filename: `invoice-${invoice.invoiceNumber}.pdf`,
          content: pdfBuffer.toString('base64')
        }]
      });

      if (error) {
        logger.error('Failed to send invoice email', error as Error, { invoiceId });
        return false;
      }

      logger.info('Invoice email sent', {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        to: invoice.customerEmail,
        messageId: data?.id
      });

      return true;
    } catch (error) {
      logger.error('Error sending invoice email', error as Error, { invoiceId });
      return false;
    }
  }

  /**
   * Send receipt email to customer
   */
  async sendReceipt(receiptId: string, overrideEmail?: string): Promise<boolean> {
    if (!resend) {
      logger.warn('Email service not configured, skipping receipt email', { receiptId });
      return false;
    }

    const receipt = await db.receipt.findUnique({
      where: { id: receiptId },
      include: {
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    if (!receipt) {
      throw new Error('Receipt not found');
    }

    const toEmail = overrideEmail || receipt.customerEmail;
    if (!toEmail) {
      throw new Error('Customer email is required');
    }

    try {
      // Generate PDF
      const pdfBuffer = await pdfService.generateReceiptPDF(receipt);

      // Send email
      const { data, error } = await resend.emails.send({
        from: `${receipt.merchantName} via ${FROM_EMAIL}`,
        to: toEmail,
        subject: `Payment Receipt ${receipt.receiptNumber} - ${receipt.merchantName}`,
        html: this.renderReceiptEmail(receipt),
        attachments: [{
          filename: `receipt-${receipt.receiptNumber}.pdf`,
          content: pdfBuffer.toString('base64')
        }]
      });

      if (error) {
        logger.error('Failed to send receipt email', error as Error, { receiptId });
        await this.updateReceiptEmailStatus(receiptId, 'FAILED');
        return false;
      }

      // Update receipt email status
      await this.updateReceiptEmailStatus(receiptId, 'SENT');

      logger.info('Receipt email sent', {
        receiptId,
        receiptNumber: receipt.receiptNumber,
        to: toEmail,
        messageId: data?.id
      });

      // Fire receipt.sent webhook
      if (receipt.merchantId) {
        try {
          const { webhookService } = await import('./webhookService');
          webhookService.sendWebhook(receipt.merchantId, 'receipt.sent', {
            receiptId,
            receiptNumber: receipt.receiptNumber,
            customerEmail: toEmail,
            amount: Number(receipt.amount),
          }).catch(() => {});
        } catch {}
      }

      return true;
    } catch (error) {
      logger.error('Error sending receipt email', error as Error, { receiptId });
      await this.updateReceiptEmailStatus(receiptId, 'FAILED');
      return false;
    }
  }

  /**
   * Send invoice reminder for overdue invoices
   */
  async sendInvoiceReminder(invoiceId: string): Promise<boolean> {
    if (!resend) {
      logger.warn('Email service not configured, skipping reminder email', { invoiceId });
      return false;
    }

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (!invoice.customerEmail) {
      throw new Error('Customer email is required');
    }

    try {
      const paymentUrl = `${BASE_URL}/pay/${invoice.id}`;

      const { data, error } = await resend.emails.send({
        from: `${invoice.merchant.companyName} via ${FROM_EMAIL}`,
        to: invoice.customerEmail,
        subject: `Reminder: Invoice ${invoice.invoiceNumber} is overdue`,
        html: this.renderReminderEmail(invoice, paymentUrl)
      });

      if (error) {
        logger.error('Failed to send reminder email', error as Error, { invoiceId });
        return false;
      }

      logger.info('Invoice reminder sent', {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        to: invoice.customerEmail,
        messageId: data?.id
      });

      return true;
    } catch (error) {
      logger.error('Error sending reminder email', error as Error, { invoiceId });
      return false;
    }
  }

  /**
   * Update receipt email status in database
   */
  private async updateReceiptEmailStatus(
    receiptId: string,
    status: 'SENT' | 'FAILED'
  ): Promise<void> {
    await db.receipt.update({
      where: { id: receiptId },
      data: {
        emailStatus: status,
        emailSentAt: status === 'SENT' ? new Date() : undefined
      }
    });
  }

  /**
   * Render invoice email HTML
   */
  private renderInvoiceEmail(invoice: any, paymentUrl: string): string {
    const formattedTotal = Number(invoice.total).toFixed(2);
    const dueText = invoice.dueDate
      ? `Due by ${new Date(invoice.dueDate).toLocaleDateString()}`
      : 'Due upon receipt';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoiceNumber}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #000000; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">INVOICE</h1>
              <p style="color: #a1a1aa; margin: 10px 0 0 0; font-size: 14px;">${invoice.invoiceNumber}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #18181b;">
                Hi${invoice.customerName ? ` ${invoice.customerName}` : ''},
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; color: #52525b;">
                ${invoice.merchant.companyName} has sent you an invoice for <strong style="color: #18181b;">$${formattedTotal} ${invoice.token}</strong>.
              </p>

              <!-- Amount Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; border-radius: 8px; margin-bottom: 30px;">
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 14px; color: #71717a;">Amount Due</td>
                        <td style="font-size: 14px; color: #71717a; text-align: right;">${dueText}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 10px;">
                          <span style="font-size: 32px; font-weight: 700; color: #18181b;">$${formattedTotal}</span>
                          <span style="font-size: 16px; color: #71717a;"> ${invoice.token}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Pay Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${paymentUrl}" style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                      Pay Invoice
                    </a>
                  </td>
                </tr>
              </table>

              ${invoice.customerNotes ? `
              <div style="margin-top: 30px; padding: 15px; background-color: #fef3c7; border-radius: 6px;">
                <p style="margin: 0; font-size: 14px; color: #92400e;">
                  <strong>Note:</strong> ${invoice.customerNotes}
                </p>
              </div>
              ` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 20px 30px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #71717a;">
                Powered by <a href="https://wetakestables.shop" style="color: #000000; text-decoration: none;">StablePay</a> - Stablecoin Payment Infrastructure
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  /**
   * Render receipt email HTML
   */
  private renderReceiptEmail(receipt: any): string {
    const formattedAmount = Number(receipt.amount).toFixed(2);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt ${receipt.receiptNumber}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #10b981; padding: 30px; text-align: center;">
              <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 15px auto; line-height: 60px;">
                <span style="color: #ffffff; font-size: 30px;">✓</span>
              </div>
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Payment Confirmed</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0; font-size: 14px;">${receipt.receiptNumber}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #18181b;">
                Hi${receipt.customerName ? ` ${receipt.customerName}` : ''},
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; color: #52525b;">
                Your payment to <strong style="color: #18181b;">${receipt.merchantName}</strong> has been confirmed.
              </p>

              <!-- Receipt Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">
                          <span style="font-size: 14px; color: #71717a;">Amount Paid</span>
                        </td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; text-align: right;">
                          <span style="font-size: 16px; font-weight: 600; color: #18181b;">$${formattedAmount} ${receipt.token}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">
                          <span style="font-size: 14px; color: #71717a;">Network</span>
                        </td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; text-align: right;">
                          <span style="font-size: 14px; color: #18181b;">${receipt.chain.replace('_', ' ')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7;">
                          <span style="font-size: 14px; color: #71717a;">Date</span>
                        </td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #e4e4e7; text-align: right;">
                          <span style="font-size: 14px; color: #18181b;">${new Date(receipt.paymentDate).toLocaleString()}</span>
                        </td>
                      </tr>
                      ${receipt.txHash ? `
                      <tr>
                        <td style="padding: 10px 0;">
                          <span style="font-size: 14px; color: #71717a;">Transaction</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="font-size: 12px; color: #18181b; word-break: break-all;">${receipt.txHash.slice(0, 20)}...${receipt.txHash.slice(-8)}</span>
                        </td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 30px 0 0 0; font-size: 14px; color: #71717a; text-align: center;">
                A PDF receipt is attached to this email for your records.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 20px 30px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #71717a;">
                Powered by <a href="https://wetakestables.shop" style="color: #000000; text-decoration: none;">StablePay</a> - Stablecoin Payment Infrastructure
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  /**
   * Render reminder email HTML
   */
  private renderReminderEmail(invoice: any, paymentUrl: string): string {
    const formattedTotal = Number(invoice.total).toFixed(2);
    const daysOverdue = invoice.dueDate
      ? Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Reminder - Invoice ${invoice.invoiceNumber}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #ef4444; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Payment Reminder</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0; font-size: 14px;">Invoice ${invoice.invoiceNumber} is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #18181b;">
                Hi${invoice.customerName ? ` ${invoice.customerName}` : ''},
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; color: #52525b;">
                This is a friendly reminder that your invoice from <strong style="color: #18181b;">${invoice.merchant.companyName}</strong> is overdue.
              </p>

              <!-- Amount Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; margin-bottom: 30px;">
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 14px; color: #dc2626;">Amount Overdue</td>
                      </tr>
                      <tr>
                        <td style="padding-top: 10px;">
                          <span style="font-size: 32px; font-weight: 700; color: #18181b;">$${formattedTotal}</span>
                          <span style="font-size: 16px; color: #71717a;"> ${invoice.token}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Pay Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${paymentUrl}" style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                      Pay Now
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 30px 0 0 0; font-size: 14px; color: #71717a; text-align: center;">
                If you've already paid, please disregard this reminder.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 20px 30px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #71717a;">
                Powered by <a href="https://wetakestables.shop" style="color: #000000; text-decoration: none;">StablePay</a> - Stablecoin Payment Infrastructure
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  /**
   * Send payment notification to merchant
   */
  async sendPaymentNotification(merchantId: string, order: {
    id: string; amount: number; token: string; chain: string; txHash?: string;
  }): Promise<boolean> {
    if (!resend) return false;

    try {
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        select: { email: true, companyName: true, emailOnPayment: true },
      });

      if (!merchant || !merchant.emailOnPayment) return false;

      const chainNames: Record<string, string> = {
        BASE_MAINNET: 'Base', ETHEREUM_MAINNET: 'Ethereum', POLYGON_MAINNET: 'Polygon',
        ARBITRUM_MAINNET: 'Arbitrum', BNB_MAINNET: 'BNB Chain', SOLANA_MAINNET: 'Solana', TRON_MAINNET: 'TRON',
      };
      const explorerUrls: Record<string, string> = {
        BASE_MAINNET: 'https://basescan.org/tx/', ETHEREUM_MAINNET: 'https://etherscan.io/tx/',
        POLYGON_MAINNET: 'https://polygonscan.com/tx/', ARBITRUM_MAINNET: 'https://arbiscan.io/tx/',
        BNB_MAINNET: 'https://bscscan.com/tx/', SOLANA_MAINNET: 'https://solscan.io/tx/',
        TRON_MAINNET: 'https://tronscan.org/#/transaction/',
      };

      const chainName = chainNames[order.chain] || order.chain;
      const explorerLink = order.txHash && explorerUrls[order.chain] ? explorerUrls[order.chain] + order.txHash : null;

      await resend.emails.send({
        from: FROM_EMAIL,
        to: merchant.email,
        subject: `Payment received: $${order.amount.toFixed(2)} ${order.token} on ${chainName}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="background: #000; color: #fff; padding: 16px 20px; margin-bottom: 20px;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7;">Payment Received</div>
              <div style="font-size: 28px; font-weight: 700; margin-top: 4px;">$${order.amount.toFixed(2)} ${order.token}</div>
            </div>
            <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #666;">Network</td><td style="padding: 8px 0; font-weight: 600;">${chainName}</td></tr>
              <tr><td style="padding: 8px 0; color: #666;">Order ID</td><td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${order.id}</td></tr>
              ${order.txHash ? `<tr><td style="padding: 8px 0; color: #666;">Transaction</td><td style="padding: 8px 0;"><a href="${explorerLink}" style="color: #2563eb; font-family: monospace; font-size: 12px;">${order.txHash.slice(0, 12)}...</a></td></tr>` : ''}
            </table>
            <div style="margin-top: 20px;">
              <a href="${BASE_URL}/dashboard#orders" style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; text-decoration: none; font-weight: 600; font-size: 13px;">View Dashboard</a>
            </div>
            <div style="margin-top: 24px; font-size: 11px; color: #999;">
              You received this because payment notifications are enabled. <a href="${BASE_URL}/dashboard#settings" style="color: #999;">Manage preferences</a>
            </div>
          </div>
        `,
      });

      logger.info('Payment notification email sent', { merchantId, orderId: order.id, event: 'email.payment_notification' });
      return true;
    } catch (err) {
      logger.error('Failed to send payment notification', err as Error, { merchantId });
      return false;
    }
  }

  /**
   * Send refund notification to merchant
   */
  async sendRefundNotification(merchantId: string, refund: {
    orderId: string; amount: number; txHash?: string;
  }): Promise<boolean> {
    if (!resend) return false;

    try {
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        select: { email: true, emailOnRefund: true },
      });

      if (!merchant || !merchant.emailOnRefund) return false;

      await resend.emails.send({
        from: FROM_EMAIL,
        to: merchant.email,
        subject: `Refund processed: $${refund.amount.toFixed(2)} for Order ${refund.orderId.slice(0, 10)}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="background: #7c3aed; color: #fff; padding: 16px 20px; margin-bottom: 20px;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7;">Refund Processed</div>
              <div style="font-size: 28px; font-weight: 700; margin-top: 4px;">$${refund.amount.toFixed(2)}</div>
            </div>
            <p style="font-size: 14px; color: #333;">A refund has been processed for order <strong>${refund.orderId}</strong>.</p>
            ${refund.txHash ? `<p style="font-size: 12px; color: #666;">TX: <code>${refund.txHash.slice(0, 20)}...</code></p>` : ''}
            <div style="margin-top: 20px;">
              <a href="${BASE_URL}/dashboard#orders" style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; text-decoration: none; font-weight: 600; font-size: 13px;">View Dashboard</a>
            </div>
          </div>
        `,
      });

      return true;
    } catch (err) {
      logger.error('Failed to send refund notification', err as Error, { merchantId });
      return false;
    }
  }
}

export const emailService = new EmailService();
