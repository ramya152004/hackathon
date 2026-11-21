-- CertiFlow PostgreSQL Relational DDL & Hard Uniqueness Constraints

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Districts
CREATE TABLE IF NOT EXISTS districts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Training Centres
CREATE TABLE IF NOT EXISTS training_centres (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    district_id UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Batches
CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_number VARCHAR(64) NOT NULL UNIQUE,
    course_name VARCHAR(255) NOT NULL,
    centre_id UUID NOT NULL REFERENCES training_centres(id) ON DELETE RESTRICT,
    district_id UUID NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    cycle_count INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    rejection_reason TEXT,
    return_reason TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Candidates
CREATE TABLE IF NOT EXISTS candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    full_name VARCHAR(128) NOT NULL,
    phone VARCHAR(15) NOT NULL,
    email VARCHAR(128) NOT NULL,
    national_id VARCHAR(64) NOT NULL,
    dob DATE NOT NULL,
    marks_percentage NUMERIC(5, 2) NOT NULL,
    grade VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Enforce uniqueness per batch:
    CONSTRAINT uq_candidates_batch_phone UNIQUE (batch_id, phone),
    CONSTRAINT uq_candidates_batch_email UNIQUE (batch_id, email),
    CONSTRAINT uq_candidates_batch_national_id UNIQUE (batch_id, national_id)
);

-- 5. Certificates (HARD DATABASE-LEVEL UNIQUENESS CONSTRAINTS)
CREATE TABLE IF NOT EXISTS certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    certificate_number VARCHAR(64) NOT NULL,
    candidate_id UUID NOT NULL,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    verification_code VARCHAR(128) NOT NULL,
    verification_url TEXT NOT NULL,
    pdf_filename VARCHAR(255) NOT NULL,
    pdf_storage_path TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    revocation_reason TEXT,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by_id VARCHAR(64),
    issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 1 candidate can have at most ONE certificate per batch/award
    CONSTRAINT uq_certificates_candidate_id UNIQUE (candidate_id),
    
    -- Certificate serial numbers must be globally unique
    CONSTRAINT uq_certificates_number UNIQUE (certificate_number),
    
    -- Unguessable verification tokens must be globally unique
    CONSTRAINT uq_certificates_verification_code UNIQUE (verification_code),

    -- Status can only be ACTIVE or REVOKED
    CONSTRAINT chk_certificate_status CHECK (status IN ('ACTIVE', 'REVOKED'))
);

-- Indices for sub-millisecond public lookups
CREATE INDEX IF NOT EXISTS idx_certificates_number ON certificates(certificate_number);
CREATE INDEX IF NOT EXISTS idx_certificates_verification_code ON certificates(verification_code);
CREATE INDEX IF NOT EXISTS idx_certificates_batch_id ON certificates(batch_id);
