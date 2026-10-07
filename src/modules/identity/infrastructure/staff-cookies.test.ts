import { describe, expect, it } from "vitest";
import { STAFF_COOKIE_NAME, readStaffCookie, staffSessionCookie, clearStaffSessionCookie } from "./staff-cookies";

describe("staff cookies", () => {
  const token = "a".repeat(43);
  const request = (cookie?: string) => new Request("https://example.test", { headers: cookie ? { cookie } : {} });
  it("reads only the unique named opaque cookie", () => {
    expect(readStaffCookie(request(`${STAFF_COOKIE_NAME}=${token}; customer=other`))).toBe(token);
    for (const cookie of [undefined, `customer=${token}`, `${STAFF_COOKIE_NAME}=bad`, `${STAFF_COOKIE_NAME}=${token}; ${STAFF_COOKIE_NAME}=${token}`, `${STAFF_COOKIE_NAME}=%61${token}`]) expect(readStaffCookie(request(cookie))).toBeNull();
    expect(readStaffCookie(new Request("https://example.test", { headers: { authorization: `Bearer ${token}`, "x-staff-user": "owner" } }))).toBeNull();
  });
  it("sets and clears host-only protected cookies without accepting injection", () => {
    const value = staffSessionCookie(token, new Date(1000));
    for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict", "Expires="]) expect(value).toContain(attribute);
    expect(value).not.toContain("Domain=");
    expect(clearStaffSessionCookie()).toContain("Max-Age=0");
    expect(() => staffSessionCookie(`${token}; injected=yes`, new Date())).toThrow();
  });
});
