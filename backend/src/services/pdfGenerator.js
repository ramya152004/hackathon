const fs = require('node:fs');
const path = require('node:path');

const STORAGE_DIR = path.resolve(__dirname, '../../storage/certificates');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * Generates a standard PDF-1.4 binary certificate document
 */
function buildPdfBuffer({
  certNumber,
  candidateName,
  courseName,
  centreName,
  districtName,
  grade,
  issueDate,
  verificationCode,
  verificationUrl
}) {
  const sanitize = (str) => String(str || '').replace(/[\(\)\\\r\n]/g, ' ');

  const content = [
    'BT',
    '/F2 22 Tf',
    '70 720 Td',
    '(PRAGATI SKILLS MISSION) Tj',
    '/F1 13 Tf',
    '0 -28 Td',
    '(GOVERNMENT OF SKILLS DEVELOPMENT - CERTIFICATE OF MERIT) Tj',
    '/F1 11 Tf',
    '0 -36 Td',
    '(This is to certify that) Tj',
    '/F2 18 Tf',
    '0 -26 Td',
    '(' + sanitize(candidateName) + ') Tj',
    '/F1 11 Tf',
    '0 -28 Td',
    '(has successfully completed the government-recognized skilling programme:) Tj',
    '/F2 15 Tf',
    '0 -24 Td',
    '(' + sanitize(courseName) + ') Tj',
    '/F1 10 Tf',
    '0 -28 Td',
    '(Training Centre: ' + sanitize(centreName) + ' | ' + sanitize(districtName) + ') Tj',
    '0 -18 Td',
    '(Performance Grade: ' + sanitize(grade) + ') Tj',
    '0 -18 Td',
    '(Certificate Serial Number: ' + sanitize(certNumber) + ') Tj',
    '0 -18 Td',
    '(Date of Issue: ' + sanitize(issueDate) + ') Tj',
    '0 -36 Td',
    '/F2 10 Tf',
    '(OFFICIAL DIGITAL VERIFICATION & TAMPER-CHECK) Tj',
    '/F1 9 Tf',
    '0 -16 Td',
    '(Verification Code: ' + sanitize(verificationCode) + ') Tj',
    '0 -14 Td',
    '(Verify online at: ' + sanitize(verificationUrl) + ') Tj',
    'ET'
  ].join('\n');

  const stream = Buffer.from(content, 'utf8');

  let body = '';
  const offsets = [];

  function addObj(str) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += str + '\n';
  }

  body += '%PDF-1.4\n';
  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  addObj(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj'
  );
  addObj('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  addObj('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');
  addObj('6 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n' + content + '\nendstream\nendobj');

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 0; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = 'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';
  return Buffer.from(body + xref + trailer, 'utf8');
}

/**
 * Generates and stores PDF certificate on disk
 */
function generateAndStoreCertificatePdf(certData) {
  const pdfBuffer = buildPdfBuffer(certData);
  const filename = `${certData.certNumber}.pdf`;
  const storagePath = path.join(STORAGE_DIR, filename);

  fs.writeFileSync(storagePath, pdfBuffer);

  return {
    filename,
    storagePath,
    sizeBytes: pdfBuffer.length
  };
}

module.exports = {
  STORAGE_DIR,
  buildPdfBuffer,
  generateAndStoreCertificatePdf
};
