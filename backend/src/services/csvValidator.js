// CertiFlow CSV Parsing and Validation Service

const REQUIRED_HEADERS = [
  'full_name',
  'phone',
  'email',
  'national_id',
  'dob',
  'marks_percentage',
  'grade'
];

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Splits a CSV line taking quotes into account
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Validates a candidate CSV file content atomically.
 * Returns: { isValid: boolean, totalRows: number, errors: Array<{row, field, value, reason}>, candidates: Array }
 */
function validateCandidateCsv(csvContent, options = {}) {
  const errors = [];
  const candidates = [];

  if (!csvContent || typeof csvContent !== 'string') {
    return {
      isValid: false,
      totalRows: 0,
      errors: [
        {
          row: 0,
          field: 'file',
          value: '',
          reason: 'Uploaded content is empty or not a valid text stream.'
        }
      ],
      candidates: []
    };
  }

  // 1. File Size Validation
  const maxBytes = options.maxSizeBytes || MAX_FILE_SIZE_BYTES;
  const contentBytes = Buffer.byteLength(csvContent, 'utf8');
  if (contentBytes > maxBytes) {
    return {
      isValid: false,
      totalRows: 0,
      errors: [
        {
          row: 0,
          field: 'file',
          value: `${(contentBytes / (1024 * 1024)).toFixed(2)} MB`,
          reason: `File size exceeds maximum permitted limit of ${(maxBytes / (1024 * 1024)).toFixed(0)} MB.`
        }
      ],
      candidates: []
    };
  }

  // 2. Line parsing
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      isValid: false,
      totalRows: 0,
      errors: [
        {
          row: 0,
          field: 'file',
          value: '',
          reason: 'CSV file contains no data.'
        }
      ],
      candidates: []
    };
  }

  // 3. Header row validation
  const headerLine = lines[0];
  const rawHeaders = parseCsvLine(headerLine).map((h) =>
    h.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '')
  );

  const missingHeaders = REQUIRED_HEADERS.filter((h) => !rawHeaders.includes(h));
  if (missingHeaders.length > 0) {
    return {
      isValid: false,
      totalRows: 0,
      errors: [
        {
          row: 1,
          field: 'headers',
          value: headerLine,
          reason: `Missing required column headers: [${missingHeaders.join(', ')}]. Expected: [${REQUIRED_HEADERS.join(', ')}]`
        }
      ],
      candidates: []
    };
  }

  // Map header name to column index
  const headerIndexMap = {};
  REQUIRED_HEADERS.forEach((h) => {
    headerIndexMap[h] = rawHeaders.indexOf(h);
  });

  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    return {
      isValid: false,
      totalRows: 0,
      errors: [
        {
          row: 1,
          field: 'data',
          value: '',
          reason: 'CSV file contains headers but zero candidate data rows.'
        }
      ],
      candidates: []
    };
  }

  // 4. Intra-batch duplicate tracking
  const seenPhones = new Map(); // phone -> rowNumber
  const seenEmails = new Map(); // email -> rowNumber
  const seenNationalIds = new Map(); // national_id -> rowNumber

  const now = new Date();
  const minBirthDate = new Date(now.getFullYear() - 15, now.getMonth(), now.getDate());

  // 5. Row-by-Row Validation
  dataLines.forEach((line, index) => {
    const rowNumber = index + 2; // Row 1 is header
    const cols = parseCsvLine(line);

    if (cols.length !== rawHeaders.length) {
      errors.push({
        row: rowNumber,
        field: 'row',
        value: line,
        reason: `Column count mismatch: expected ${rawHeaders.length} columns, found ${cols.length}.`
      });
      return; // Skip further cell checks for broken line
    }

    // Extract cell values
    const rawFullName = cols[headerIndexMap.full_name] || '';
    const rawPhone = cols[headerIndexMap.phone] || '';
    const rawEmail = cols[headerIndexMap.email] || '';
    const rawNationalId = cols[headerIndexMap.national_id] || '';
    const rawDob = cols[headerIndexMap.dob] || '';
    const rawMarks = cols[headerIndexMap.marks_percentage] || '';
    const rawGrade = cols[headerIndexMap.grade] || '';

    // A. full_name validation
    const fullName = rawFullName.trim();
    if (!fullName || fullName.length < 2 || fullName.length > 100) {
      errors.push({
        row: rowNumber,
        field: 'full_name',
        value: rawFullName,
        reason: 'Candidate name is required and must be between 2 and 100 characters.'
      });
    }

    // B. phone validation
    const normalizedPhone = rawPhone.replace(/[\s\-\+]/g, '').replace(/^91/, '');
    if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
      errors.push({
        row: rowNumber,
        field: 'phone',
        value: rawPhone,
        reason: 'Invalid phone format: must be a 10-digit mobile number starting with 6, 7, 8, or 9.'
      });
    } else {
      if (seenPhones.has(normalizedPhone)) {
        errors.push({
          row: rowNumber,
          field: 'phone',
          value: rawPhone,
          reason: `Duplicate phone number: already appears in row ${seenPhones.get(normalizedPhone)}.`
        });
      } else {
        seenPhones.set(normalizedPhone, rowNumber);
      }
    }

    // C. email validation
    const normalizedEmail = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      errors.push({
        row: rowNumber,
        field: 'email',
        value: rawEmail,
        reason: 'Invalid email address format.'
      });
    } else {
      if (seenEmails.has(normalizedEmail)) {
        errors.push({
          row: rowNumber,
          field: 'email',
          value: rawEmail,
          reason: `Duplicate email address: already appears in row ${seenEmails.get(normalizedEmail)}.`
        });
      } else {
        seenEmails.set(normalizedEmail, rowNumber);
      }
    }

    // D. national_id validation
    const nationalId = rawNationalId.trim();
    if (!/^[A-Za-z0-9\-]{6,20}$/.test(nationalId)) {
      errors.push({
        row: rowNumber,
        field: 'national_id',
        value: rawNationalId,
        reason: 'Invalid national ID: must be between 6 and 20 alphanumeric characters.'
      });
    } else {
      if (seenNationalIds.has(nationalId.toUpperCase())) {
        errors.push({
          row: rowNumber,
          field: 'national_id',
          value: rawNationalId,
          reason: `Duplicate national ID: already appears in row ${seenNationalIds.get(nationalId.toUpperCase())}.`
        });
      } else {
        seenNationalIds.set(nationalId.toUpperCase(), rowNumber);
      }
    }

    // E. dob validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
      errors.push({
        row: rowNumber,
        field: 'dob',
        value: rawDob,
        reason: 'Invalid date format: must be YYYY-MM-DD.'
      });
    } else {
      const parsedDate = new Date(rawDob);
      if (isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== rawDob) {
        errors.push({
          row: rowNumber,
          field: 'dob',
          value: rawDob,
          reason: 'Invalid calendar date.'
        });
      } else if (parsedDate > minBirthDate) {
        errors.push({
          row: rowNumber,
          field: 'dob',
          value: rawDob,
          reason: 'Candidate must be at least 15 years old.'
        });
      }
    }

    // F. marks_percentage validation
    const marks = parseFloat(rawMarks);
    if (isNaN(marks) || marks < 0 || marks > 100) {
      errors.push({
        row: rowNumber,
        field: 'marks_percentage',
        value: rawMarks,
        reason: 'Marks percentage must be a number between 0 and 100.'
      });
    }

    // G. grade validation
    const grade = rawGrade.trim();
    if (!grade || grade.length > 20) {
      errors.push({
        row: rowNumber,
        field: 'grade',
        value: rawGrade,
        reason: 'Grade is required (up to 20 characters).'
      });
    }

    // If no errors for this row, collect sanitized candidate record
    candidates.push({
      fullName,
      phone: normalizedPhone,
      email: normalizedEmail,
      nationalId,
      dob: rawDob,
      marksPercentage: marks,
      grade
    });
  });

  const isValid = errors.length === 0;

  return {
    isValid,
    totalRows: dataLines.length,
    validRows: isValid ? dataLines.length : 0,
    errors,
    // All-or-nothing guarantee: only return candidates if 100% valid
    candidates: isValid ? candidates : []
  };
}

module.exports = {
  REQUIRED_HEADERS,
  MAX_FILE_SIZE_BYTES,
  validateCandidateCsv
};
