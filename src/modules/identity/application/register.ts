import type { RegisterRequestDto } from "../contracts/registration";

export interface RegistrationPorts {
  hashPassword(password: string): Promise<string>;
  createCustomer(dto: RegisterRequestDto, passwordHash: string): Promise<void>;
}

export function createRegisterCustomer(ports: RegistrationPorts) {
  return async (dto: RegisterRequestDto) => {
    // Hash before taking database locks, including the duplicate path.
    const passwordHash = await ports.hashPassword(dto.password);
    await ports.createCustomer(dto, passwordHash);
    return { success: true };
  };
}
