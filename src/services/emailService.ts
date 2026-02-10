import { Resend } from 'resend';
import { db } from '../config/database';
import { pdfService } from './pdfService';
import { logger } from '../utils/logger';

// Initialize Resend client (will be null if no API key)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const BASE_URL = process.env.BASE_URL || 'https://stablepay-nine.vercel.app';
const FROM_EMAIL = process.env.FROM_EMAIL || 'StablePay <noreply@stablepay.io>';

class EmailService {
  /**
   * Check if email service is configured
   */
  isConfigured(): boolean {
    return resend !== null;
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
                Powered by <a href="https://stablepay.io" style="color: #000000; text-decoration: none;">StablePay</a> - Stablecoin Payment Infrastructure
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
                Powered by <a href="https://stablepay.io" style="color: #000000; text-decoration: none;">StablePay</a> - Stablecoin Payment Infrastructure
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
                Powered by <a href="https://stablepay.io" style="color: #000000; text-decoration: none;">StablePay</a> - Stablecoin Payment Infrastructure
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
}

export const emailService = new EmailService();
