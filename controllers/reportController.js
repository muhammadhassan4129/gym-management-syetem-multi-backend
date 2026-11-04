import PDFDocument from 'pdfkit';

import { buildFinancialReport } from '../services/reportService.js';

import { localDate } from '../utils/helpers.js';

export async function getFinancialSummary(req, res) {
   res.json(await buildFinancialReport(req.gym, req.query));
}

export async function downloadFinancialPdf(req, res) {
  const report = await buildFinancialReport(req.gym, req.query);

  const filename =
    `gym-report-${report.period.startDate}` +
    `-to-${report.period.endDate}.pdf`;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 45,
    bufferPages: true,
    info: {
      Title: `${report.gymName} Financial Report`,
      Author: report.gymName,
    },
  });

  doc.on('error', (error) => {
    console.error('PDF generation error:', error);
    res.destroy(error);
  });

  res.setHeader('Content-Type', 'application/pdf');

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );

  doc.pipe(res);

  const amount = (value) =>
    `${report.currency} ${Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  function section(title) {
    if (doc.y > doc.page.height - 130) {
      doc.addPage();
    }

    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#155e75');
    doc.text(title);
    doc.moveDown(0.35);
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
  }

  function line(text) {
    doc.text(text, {
      width: doc.page.width - 90,
      lineGap: 3,
    });
  }

  doc.font('Helvetica-Bold')
    .fontSize(22)
    .fillColor('#0f172a')
    .text(report.gymName);

  doc.fontSize(15).text('Financial Report');

  doc.moveDown(0.4);

  doc.font('Helvetica')
    .fontSize(10)
    .fillColor('#475569');

  line(
    `Period: ${report.period.startDate} to ${report.period.endDate}`
  );

  line(`Generated: ${localDate(report.generatedAt)} (Asia/Karachi)`);

  section('Cash Summary');

  line(`Income received: ${amount(report.totalIncome)}`);
  line(`Expenses recorded: ${amount(report.totalExpenses)}`);
  line(`Net cash surplus / deficit: ${amount(report.netProfit)}`);
  line(`Receipts: ${report.paymentsCount}`);
  line(`Expense entries: ${report.expensesCount}`);

  section('Invoices Issued for Selected Period');

  line(`Total billed: ${amount(report.totalBilled)}`);
  line(`Invoice count: ${report.invoicesCount}`);

  line(
    `Current status: Paid ${report.invoiceStatusCounts.paid} | ` +
      `Partial ${report.invoiceStatusCounts.partial} | ` +
      `Unpaid ${report.invoiceStatusCounts.unpaid}`
  );

  section('Current Outstanding Snapshot');

  line(`Total members: ${report.current.totalMembers}`);
  line(`Active subscriptions: ${report.current.activeSubscriptions}`);

  line(
    `Total outstanding: ${amount(report.current.outstandingBalance)}`
  );

  line(
    `Previous months due: ${amount(report.current.previousMonthsDue)}`
  );

  line(
    `Legacy balance without verified month: ` +
      amount(report.current.legacyUnallocatedDue)
  );

  section('Monthly Cash Totals');

  if (!report.monthly.length) {
    line('No cash activity in the selected period.');
  }

  for (const row of report.monthly) {
    line(
      `${row.month} | Income: ${amount(row.income)} | ` +
        `Expenses: ${amount(row.expenses)} | ` +
        `Net: ${amount(row.netProfit)}`
    );
  }

  section('Income by Payment Method');

  if (!report.incomeByMethod.length) line('No receipts.');

  for (const row of report.incomeByMethod) {
    line(`${row.method}: ${amount(row.amount)}`);
  }

  section('Expenses by Category');

  if (!report.expensesByCategory.length) line('No expenses.');

  for (const row of report.expensesByCategory) {
    line(`${row.category}: ${amount(row.amount)}`);
  }

  section('Receipt Details');

  if (!report.receipts.length) line('No receipts in this period.');

  for (const receipt of report.receipts) {
    line(
      `${localDate(receipt.receivedAt)} | ` +
        `${receipt.member?.fullName || 'Unknown member'} | ` +
        `${amount(receipt.amount)} | ${receipt.method}\n` +
        `Invoice: ${receipt.invoiceNumber}\n` +
        `Receipt: ${receipt.receiptNumber}` +
        (receipt.reference ? `\nReference: ${receipt.reference}` : '')
    );

    doc.moveDown(0.5);
  }

  section('Expense Details');

  if (!report.expenses.length) line('No expenses in this period.');

  for (const expense of report.expenses) {
    line(
      `${localDate(expense.date)} | ${expense.category} | ` +
        `${amount(expense.amount)}` +
        (expense.description ? `\n${expense.description}` : '')
    );

    doc.moveDown(0.4);
  }

  section('Current Pending Invoice Details');

  if (!report.outstandingInvoices.length) {
    line('No outstanding invoices.');
  }

  for (const invoice of report.outstandingInvoices) {
    line(
      `${invoice.memberId?.fullName || 'Unknown member'} | ` +
        `${invoice.billingMonth || 'Legacy / unallocated'} | ` +
        `Due: ${amount(invoice.remainingBalance)}\n` +
        `Invoice: ${invoice.invoiceNumber} | Status: ${invoice.status}`
    );

    doc.moveDown(0.4);
  }

  section('Reporting Notes');

  for (const note of report.notes) {
    line(`- ${note}`);
  }

  if (report.historicalReceivedWithoutDates > 0) {
    line(
      'Historical received amount without installment dates: ' +
        amount(report.historicalReceivedWithoutDates)
    );
  }

  const pages = doc.bufferedPageRange();

  for (
    let index = pages.start;
    index < pages.start + pages.count;
    index += 1
  ) {
    doc.switchToPage(index);

    doc.font('Helvetica')
      .fontSize(8)
      .fillColor('#64748b')
      .text(
        `Page ${index + 1} of ${pages.count}`,
        45,
        doc.page.height - 30,
        {
          lineBreak: false,
        }
      );
  }

  doc.end();
}