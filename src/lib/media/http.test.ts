import {describe,it,expect,vi} from "vitest";
import {NextResponse} from "next/server";
import {mediaHandler} from "./http";
import {ApiError} from "../../shared/api/errors";
describe("media error privacy",()=>{
  it("logs handled infrastructure errors with only safe code and correlation",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      const response=await mediaHandler(async()=>{throw new ApiError(503,"MEDIA_UNAVAILABLE","Media unavailable");})(new Request("http://local.test",{headers:{"x-correlation-id":"safe-id"}}));
      expect(response.status).toBe(503);
      expect(log).toHaveBeenCalledExactlyOnceWith("Media operation failed",{correlation:"safe-id",code:"MEDIA_UNAVAILABLE"});
      expect((await response.json()).error.request_id).toBe("safe-id");
    }finally{log.mockRestore();}
  });
  it("generates correlation and hides internal error secrets",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      const response=await mediaHandler(async()=>{throw new Error("database password secret");})(new Request("http://local.test"));
      const body=await response.json();
      expect(response.status).toBe(500);expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(body.error.request_id).toBe(response.headers.get("x-correlation-id"));
      expect(JSON.stringify(body)).not.toContain("secret");expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    } finally {log.mockRestore();}
  });
  it("keeps success private and echoes valid correlation",async()=>{
    const response=await mediaHandler(async()=>NextResponse.json({id:"a"}))(new Request("http://local.test",{headers:{"x-correlation-id":"safe-id"}}));
    expect(response.headers.get("x-correlation-id")).toBe("safe-id");expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
