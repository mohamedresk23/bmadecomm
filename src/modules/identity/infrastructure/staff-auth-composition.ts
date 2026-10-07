import type { DbContext } from '../../../db/tx';
import type { StaffConfig } from './staff-config';
import { createStaffAuthentication } from './staff-auth';
import { createStaffAuthenticationService } from '../application/staff-auth';
export function composeStaffAuthentication(db: DbContext, config: StaffConfig) {
  return createStaffAuthenticationService(createStaffAuthentication(db, config));
}
