import { StaffAccessForm } from '../staff-access-form';
export default function StaffRecover() { return <main><h1>Recover your authenticator</h1><p>You need your password and an unused offline recovery code. Recovery does not grant administrative access.</p><StaffAccessForm initialMode="recover" /></main>; }
