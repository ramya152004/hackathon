# CertiFlow: Candidate Batch CSV Import Specification

This document details the accepted CSV schema, column definitions, validation rules, and error handling for training centres uploading candidate batches.

---

## 1. Required Columns & Schema

The CSV file must be UTF-8 encoded and contain a single header row with the following exact column names (case-insensitive, snake_case or trim-normalized):

| Column Header | Data Type | Required | Description & Constraints | Example |
| :--- | :--- | :---: | :--- | :--- |
| `full_name` | String | **Yes** | Candidate's legal full name. Length: 2 to 100 characters. Letters, spaces, dots, and hyphens only. | `Rahul S. Verma` |
| `phone` | String | **Yes** | 10-digit Indian mobile number starting with 6, 7, 8, or 9 (optional `+91` prefix accepted and normalized). Must be unique within the batch. | `9876543210` |
| `email` | String | **Yes** | Valid RFC-compliant email address. Must be unique within the batch. | `rahul.verma@example.com` |
| `national_id` | String | **Yes** | Government-issued identification (Aadhaar / Voter ID / Mission ID). 6 to 20 alphanumeric characters. Must be unique within the batch. | `AADHAAR-8812-4411` |
| `dob` | Date (`YYYY-MM-DD`) | **Yes** | Date of birth. Must be a valid historical date. Candidate must be at least 15 years old. | `2004-05-14` |
| `marks_percentage`| Numeric | **Yes** | Final evaluation percentage score. Numeric value between `0.0` and `100.0`. | `87.5` |
| `grade` | String | **Yes** | Assigned grade or performance tier (e.g., `A+`, `A`, `B`, `C`, `PASS`, `DISTINCTION`). | `A` |

---

## 2. Validation Rules & Constraints

### 2.1 File-Level Validations
1. **File Type**: Must be a `.csv` file (`text/csv` or `application/vnd.ms-excel`).
2. **File Size Limit**: Maximum file size is **5 MB** (approximately 50,000 rows).
3. **Empty File Check**: Files containing zero bytes or containing only headers with zero data rows are rejected.
4. **Header Validation**: All 7 required columns must be present in the header row. Extra unexpected columns are flagged or stripped.
5. **Column Alignment**: Every row must have the exact number of columns matching the header row.

### 2.2 Row-Level & Field Validations
- **`full_name`**: Cannot be blank or empty whitespace.
- **`phone`**: Validated against `/^(\+91[\-\s]?)?[6-9]\d{9}$/`. Normalized to standard 10 digits (`9XXXXXXXXX`).
- **`email`**: Validated against standard email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Normalized to lowercase.
- **`national_id`**: Alphanumeric string between 6 and 20 characters. Trimmed.
- **`dob`**: Validated date format `YYYY-MM-DD`. Validates calendar validity (e.g. rejects `2024-02-30`).
- **`marks_percentage`**: Parsed as float; must satisfy `0 <= marks <= 100`.
- **`grade`**: Non-empty string.

### 2.3 Intra-Batch Duplicate Detection
Within the same uploaded CSV, the following fields must be strictly unique:
- No two candidates may have the same `phone` number.
- No two candidates may have the same `email` address.
- No two candidates may have the same `national_id`.

If duplicate rows are detected, the validator reports the duplicate row and references the original row where it first appeared.

---

## 3. All-or-Nothing Import Guarantee

- If **even one single error** is detected in any row of the uploaded CSV:
  - **Zero candidate records** are saved to the database.
  - The batch state is placed in `NEEDS_CORRECTION` (or remains `DRAFT`).
  - The API responds with HTTP status `422 Unprocessable Entity` containing an exhaustive, row-by-row error report.
- Only when **all rows** satisfy all validation rules:
  - The candidates are committed atomically.
  - The batch status is updated to `DRAFT` with `candidateCount` set to the number of rows.
  - The batch becomes eligible for submission to District review.

---

## 4. Sample CSV Template

```csv
full_name,phone,email,national_id,dob,marks_percentage,grade
Rahul S. Verma,9876543210,rahul.verma@example.com,AADHAAR-8812-4411,2004-05-14,87.5,A
Sunita P. Sharma,9812345678,sunita.sharma@example.com,AADHAAR-9923-5522,2003-11-20,92.0,A+
Amit Kumar,9765432109,amit.kumar@example.com,AADHAAR-7711-3344,2002-08-09,74.5,B
```
