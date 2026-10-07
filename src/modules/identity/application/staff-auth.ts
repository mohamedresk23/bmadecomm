import type { StaffAuthInput, StaffAuthMeta, StaffAuthResult } from '../contracts/staff-auth';
type Command = (input: StaffAuthInput, meta: StaffAuthMeta) => Promise<StaffAuthResult>;
/** Atomic identity port. The application owns the public command surface; persistence/crypto/transport stay outside it. */
export interface StaffAuthenticationPort {
  provisionOwner(email: string, name: string, meta: StaffAuthMeta): Promise<StaffAuthResult>;
  login: Command; mfa: Command; enroll: Command; confirmEnrollment: Command;
  recover: Command; resetRequest: Command; resetConfirm: Command;
  own(operation: 'reauth' | 'password' | 'factor' | 'codes' | 'logout', token: string, input: StaffAuthInput, meta: StaffAuthMeta): Promise<StaffAuthResult>;
}
export function createStaffAuthenticationService(port: StaffAuthenticationPort): StaffAuthenticationPort {
  return {
    provisionOwner: (email, name, meta) => port.provisionOwner(email, name, meta),
    login: (input, meta) => port.login(input, meta), mfa: (input, meta) => port.mfa(input, meta),
    enroll: (input, meta) => port.enroll(input, meta), confirmEnrollment: (input, meta) => port.confirmEnrollment(input, meta),
    recover: (input, meta) => port.recover(input, meta), resetRequest: (input, meta) => port.resetRequest(input, meta),
    resetConfirm: (input, meta) => port.resetConfirm(input, meta), own: (operation, token, input, meta) => port.own(operation, token, input, meta),
  };
}
