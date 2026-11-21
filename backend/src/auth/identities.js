// Demo Identities and Role Definitions for CertiFlow

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
    name: 'Dev Patel',
    role: ROLES.DISTRICT_OFFICER,
    districtId: 'district-north',
    districtName: 'North District'
  },
  meera: {
    id: 'usr-meera-03',
    username: 'meera',
    name: 'Meera Sen',
    role: ROLES.DISTRICT_OFFICER,
    districtId: 'district-north',
    districtName: 'North District'
  },
  kabir: {
    id: 'usr-kabir-04',
    username: 'kabir',
    name: 'Kabir Rao',
    role: ROLES.DISTRICT_OFFICER,
    districtId: 'district-south',
    districtName: 'South District'
  },
  neha: {
    id: 'usr-neha-05',
    username: 'neha',
    name: 'Neha Gupta',
    role: ROLES.QUALITY_TEAM,
    scope: 'STATE_WIDE_LARGE_BATCHES'
  },
  farah: {
    id: 'usr-farah-06',
    username: 'farah',
    name: 'Farah Khan',
    role: ROLES.STATE_OFFICE,
    scope: 'STATE_WIDE_FINAL_AUTHORITY'
  }
};

module.exports = {
  ROLES,
  DEMO_USERS
};
