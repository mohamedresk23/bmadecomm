import type { VerifyRequestDto } from "../contracts/verification";

export function createVerifyCustomer(ports: { activate(input: VerifyRequestDto): Promise<boolean> }) {
  return (input: VerifyRequestDto) => ports.activate(input);
}
