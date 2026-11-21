// Demo Identities and Role Definitions for CertiFlow
const { hashPassword } = require('./password');

// All demo users share one password, set by env. Only its salted hash is kept in memory.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Certiflow@2026';
if (process.env.NODE_ENV === 'production' && !process.env.DEMO_PASSWORD) {
  console.warn('[auth] DEMO_PASSWORD not set; using the default demo password.');
}

const ROLES = {
  TRAINING_CENTRE: 'TRAINING_CENTRE',
  DISTRICT_OFFICER: 'DISTRICT_OFFICER',
  QUALITY_TEAM: 'QUALITY_TEAM',
  STATE_OFFICE: 'STATE_OFFICE',
  PUBLIC: 'PUBLIC'
};

const DEMO_USERS = {
  anika: {
    id: 'usr-anika-01',
    username: 'anika',
    passwordHash: hashPassword(DEMO_PASSWORD),
    name: 'Anika Sharma',
    role: ROLES.TRAINING_CENTRE,
    centreId: 'centre-apex-01',
    centreName: 'Apex Skills Academy',
    districtId: 'district-north',
    districtName: 'North District'
  },
  dev: {
    id: 'usr-dev-02',
    username: 'dev',
    passwordHash: hashPassword(DEMO_PASSWORD),
    name: 'Dev Patel',
    role: ROLES.DISTRICT_OFFICER,
    districtId: 'district-north',
    districtName: 'North District'
  },
  meera: {
    id: 'usr-meera-03',
    username: 'meera',
    passwordHash: hashPassword(DEMO_PASSWORD),
    name: 'Meera Sen',
    role: ROLES.DISTRICT_OFFICER,
    districtId: 'district-north',
    districtName: 'North District'
  },
  kabir: {
    id: 'usr-kabir-04',
    username: 'kabir',
    passwordHash: hashPassword(DEMO_PASSWORD),
    name: 'Kabir Rao',
    role: ROLES.DISTRICT_OFFICER,
    districtId: 'district-south',
    districtName: 'South District'
  },
  neha: {
    id: 'usr-neha-05',
    username: 'neha',
    passwordHash: hashPassword(DEMO_PASSWORD),
    name: 'Neha Gupta',
    role: ROLES.QUALITY_TEAM,
    scope: 'STATE_WIDE_LARGE_BATCHES'
  },
  farah: {
    id: 'usr-farah-06',
    username: 'farah',
    passwordHash: hashPassword(DEMO_PASSWORD),
    name: 'Farah Khan',
    role: ROLES.STATE_OFFICE,
    scope: 'STATE_WIDE_FINAL_AUTHORITY'
  }
};

module.exports = {
  ROLES,
  DEMO_USERS,
  DEMO_PASSWORD
};
