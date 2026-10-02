import PDFDocument from 'pdfkit';

/** PDF projections are generated from authorized records, never treated as GST originals. */
export function recordPdf(title: string, reference: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: title, Author: 'LigiMed' },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.font('Helvetica-Bold').fontSize(12).fillColor('#174b43').text('LigiMed / Pharmacy records');
    pdf.moveDown().fontSize(22).text(title);
    pdf.font('Helvetica').fontSize(10).fillColor('#555555').text(reference);
    pdf.moveDown().text('Internal record — not a statutory tax invoice.');
    pdf.moveDown().fillColor('#222222').fontSize(11);
    for (const line of lines) pdf.text(line, { paragraphGap: 8 });
    pdf
      .moveDown()
      .fontSize(9)
      .fillColor('#666666')
      .text(
        'Amounts and payment entries reflect recorded data. A payment entry does not verify bank settlement.',
      );
    pdf.end();
  });
}
