import PDFDocument from 'pdfkit';
import { Invoice, InvoiceLineItem, Receipt, Merchant } from '@prisma/client';

type InvoiceWithItems = Invoice & {
  lineItems: InvoiceLineItem[];
  merchant: Pick<Merchant, 'companyName' | 'email' | 'website'>;
};

type ReceiptWithDetails = Receipt & {
  merchant: Pick<Merchant, 'companyName' | 'email' | 'website'>;
};

class PdfService {
  /**
   * Generate a professional PDF invoice
   */
  async generateInvoicePDF(invoice: InvoiceWithItems): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('INVOICE', { align: 'right' });
        doc.fontSize(10).font('Helvetica').text(invoice.invoiceNumber, { align: 'right' });
        doc.moveDown(0.5);

        // Status badge
        const statusColors: Record<string, string> = {
          DRAFT: '#6B7280',
          SENT: '#3B82F6',
          VIEWED: '#8B5CF6',
          PAID: '#10B981',
          OVERDUE: '#EF4444',
          CANCELLED: '#6B7280'
        };
        doc.fontSize(10).fillColor(statusColors[invoice.status] || '#6B7280')
          .text(invoice.status, { align: 'right' });
        doc.fillColor('#000000');

        doc.moveDown(2);

        // From section (Merchant)
        doc.fontSize(10).font('Helvetica-Bold').text('FROM');
        doc.font('Helvetica').fontSize(10);
        doc.text(invoice.merchant.companyName);
        if (invoice.merchant.email) doc.text(invoice.merchant.email);
        if (invoice.merchant.website) doc.text(invoice.merchant.website);

        // Bill To section
        const billToX = 300;
        doc.fontSize(10).font('Helvetica-Bold').text('BILL TO', billToX, doc.y - 60);
        doc.font('Helvetica').fontSize(10);
        doc.text(invoice.customerName || 'Customer', billToX);
        if (invoice.customerEmail) doc.text(invoice.customerEmail, billToX);
        if (invoice.customerAddress) doc.text(invoice.customerAddress, billToX);

        doc.moveDown(2);

        // Invoice details
        const detailsY = doc.y;
        doc.fontSize(10);
        doc.text(`Invoice Date: ${new Date(invoice.createdAt).toLocaleDateString()}`, 50, detailsY);
        if (invoice.dueDate) {
          doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`, 50);
        }
        doc.text(`Payment: ${invoice.token}${invoice.chain ? ` on ${invoice.chain.replace('_', ' ')}` : ''}`, 50);

        doc.moveDown(2);

        // Line items table header
        const tableTop = doc.y;
        const tableLeft = 50;
        const colWidths = { desc: 250, qty: 60, price: 80, amount: 80 };

        doc.font('Helvetica-Bold').fontSize(10);
        doc.rect(tableLeft, tableTop, 495, 20).fill('#F3F4F6');
        doc.fillColor('#000000');
        doc.text('Description', tableLeft + 5, tableTop + 5);
        doc.text('Qty', tableLeft + colWidths.desc + 5, tableTop + 5, { width: colWidths.qty, align: 'center' });
        doc.text('Price', tableLeft + colWidths.desc + colWidths.qty + 5, tableTop + 5, { width: colWidths.price, align: 'right' });
        doc.text('Amount', tableLeft + colWidths.desc + colWidths.qty + colWidths.price + 5, tableTop + 5, { width: colWidths.amount, align: 'right' });

        // Line items
        let itemY = tableTop + 25;
        doc.font('Helvetica').fontSize(10);

        for (const item of invoice.lineItems) {
          doc.text(item.description, tableLeft + 5, itemY, { width: colWidths.desc - 10 });
          doc.text(item.quantity.toString(), tableLeft + colWidths.desc + 5, itemY, { width: colWidths.qty, align: 'center' });
          doc.text(`$${Number(item.unitPrice).toFixed(2)}`, tableLeft + colWidths.desc + colWidths.qty + 5, itemY, { width: colWidths.price, align: 'right' });
          doc.text(`$${Number(item.amount).toFixed(2)}`, tableLeft + colWidths.desc + colWidths.qty + colWidths.price + 5, itemY, { width: colWidths.amount, align: 'right' });
          itemY += 20;
        }

        // Totals section
        doc.moveDown(2);
        const totalsX = 380;
        const totalsValueX = 480;

        doc.text('Subtotal:', totalsX, doc.y, { continued: false });
        doc.text(`$${Number(invoice.subtotal).toFixed(2)}`, totalsValueX, doc.y - 12, { align: 'right', width: 65 });

        if (Number(invoice.taxAmount) > 0) {
          doc.text(`Tax (${(Number(invoice.taxPercent) * 100).toFixed(1)}%):`, totalsX);
          doc.text(`$${Number(invoice.taxAmount).toFixed(2)}`, totalsValueX, doc.y - 12, { align: 'right', width: 65 });
        }

        if (Number(invoice.discountAmount) > 0) {
          doc.text(`Discount (${(Number(invoice.discountPercent) * 100).toFixed(1)}%):`, totalsX);
          doc.text(`-$${Number(invoice.discountAmount).toFixed(2)}`, totalsValueX, doc.y - 12, { align: 'right', width: 65 });
        }

        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('Total:', totalsX);
        doc.text(`$${Number(invoice.total).toFixed(2)}`, totalsValueX, doc.y - 14, { align: 'right', width: 65 });

        // Payment instructions
        if (invoice.status !== 'PAID' && invoice.status !== 'CANCELLED') {
          doc.moveDown(3);
          doc.font('Helvetica-Bold').fontSize(10).text('Payment Instructions');
          doc.font('Helvetica').fontSize(9);
          doc.text(`Pay online at: ${process.env.BASE_URL || 'https://stablepay-nine.vercel.app'}/pay/${invoice.id}`);
          if (invoice.paymentAddress) {
            doc.text(`Or send ${invoice.token} to: ${invoice.paymentAddress}`);
          }
        }

        // Notes
        if (invoice.customerNotes) {
          doc.moveDown(2);
          doc.font('Helvetica-Bold').fontSize(10).text('Notes');
          doc.font('Helvetica').fontSize(9).text(invoice.customerNotes);
        }

        // Footer
        doc.fontSize(8).fillColor('#6B7280');
        doc.text(
          'Powered by StablePay - Stablecoin Payment Infrastructure',
          50,
          doc.page.height - 50,
          { align: 'center', width: 495 }
        );

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate a payment receipt PDF
   */
  async generateReceiptPDF(receipt: ReceiptWithDetails): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header with checkmark
        doc.fontSize(24).font('Helvetica-Bold').fillColor('#10B981').text('PAYMENT RECEIPT', { align: 'center' });
        doc.fillColor('#000000');
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica').text(receipt.receiptNumber, { align: 'center' });

        doc.moveDown(2);

        // Success message
        doc.rect(50, doc.y, 495, 40).fill('#D1FAE5');
        doc.fillColor('#065F46').fontSize(12).font('Helvetica-Bold');
        doc.text('Payment Confirmed', 50, doc.y - 35, { align: 'center', width: 495 });
        doc.fillColor('#000000');

        doc.moveDown(3);

        // Receipt details in a nice box
        const boxY = doc.y;
        doc.rect(50, boxY, 495, 180).stroke('#E5E7EB');

        // Merchant section
        doc.font('Helvetica-Bold').fontSize(10).text('Paid To', 70, boxY + 15);
        doc.font('Helvetica').text(receipt.merchantName, 70, boxY + 30);
        if (receipt.merchant.email) doc.text(receipt.merchant.email, 70, boxY + 45);

        // Customer section
        doc.font('Helvetica-Bold').text('Received From', 320, boxY + 15);
        doc.font('Helvetica').text(receipt.customerName || 'Customer', 320, boxY + 30);
        if (receipt.customerEmail) doc.text(receipt.customerEmail, 320, boxY + 45);

        // Divider
        doc.moveTo(50, boxY + 70).lineTo(545, boxY + 70).stroke('#E5E7EB');

        // Payment details
        doc.font('Helvetica-Bold').fontSize(10).text('Payment Details', 70, boxY + 85);

        const detailsY = boxY + 105;
        doc.font('Helvetica').fontSize(10);
        doc.text('Amount:', 70, detailsY);
        doc.font('Helvetica-Bold').text(`$${Number(receipt.amount).toFixed(2)} ${receipt.token}`, 180, detailsY);

        doc.font('Helvetica').text('Network:', 70, detailsY + 18);
        doc.text(receipt.chain.replace('_', ' '), 180, detailsY + 18);

        doc.text('Date:', 70, detailsY + 36);
        doc.text(new Date(receipt.paymentDate).toLocaleString(), 180, detailsY + 36);

        if (receipt.txHash) {
          doc.text('Transaction:', 70, detailsY + 54);
          doc.fontSize(8).text(receipt.txHash, 180, detailsY + 54, { width: 340 });
        }

        doc.moveDown(8);

        // Blockchain verification
        if (receipt.txHash) {
          doc.fontSize(9).fillColor('#6B7280');
          const explorerUrl = this.getExplorerUrl(receipt.chain, receipt.txHash);
          doc.text(`Verify on blockchain: ${explorerUrl}`, { align: 'center' });
        }

        // Footer
        doc.fontSize(8).fillColor('#6B7280');
        doc.text(
          'This receipt was automatically generated by StablePay',
          50,
          doc.page.height - 70,
          { align: 'center', width: 495 }
        );
        doc.text(
          `Generated on ${new Date().toLocaleString()}`,
          50,
          doc.page.height - 55,
          { align: 'center', width: 495 }
        );

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get blockchain explorer URL for transaction
   */
  private getExplorerUrl(chain: string, txHash: string): string {
    const explorers: Record<string, string> = {
      BASE_SEPOLIA: `https://sepolia.basescan.org/tx/${txHash}`,
      BASE_MAINNET: `https://basescan.org/tx/${txHash}`,
      ETHEREUM_SEPOLIA: `https://sepolia.etherscan.io/tx/${txHash}`,
      ETHEREUM_MAINNET: `https://etherscan.io/tx/${txHash}`,
      POLYGON_MAINNET: `https://polygonscan.com/tx/${txHash}`,
      POLYGON_MUMBAI: `https://mumbai.polygonscan.com/tx/${txHash}`,
      ARBITRUM_MAINNET: `https://arbiscan.io/tx/${txHash}`,
      ARBITRUM_SEPOLIA: `https://sepolia.arbiscan.io/tx/${txHash}`,
      SOLANA_MAINNET: `https://solscan.io/tx/${txHash}`,
      SOLANA_DEVNET: `https://solscan.io/tx/${txHash}?cluster=devnet`,
    };
    return explorers[chain] || txHash;
  }
}

export const pdfService = new PdfService();
