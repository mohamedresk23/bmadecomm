/** @vitest-environment jsdom */
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {Upload} from "./Upload";
const fetchMock=vi.fn();
beforeEach(()=>{vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();URL.createObjectURL=vi.fn(()=>"blob:private-preview");URL.revokeObjectURL=vi.fn();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("Upload",()=>{
  it("resets input so selecting the same file twice uploads twice",async()=>{
    fetchMock.mockResolvedValue({ok:true,json:async()=>({id:"abc",status:"pending"})});
    render(<Upload csrfToken="csrf"/>);
    const input=screen.getByTestId("upload-input") as HTMLInputElement;
    const file=new File(["x"],"a.png",{type:"image/png"});
    for(let attempt=0;attempt<2;attempt++){
      Object.defineProperty(input,"value",{configurable:true,writable:true,value:"C:\\fakepath\\a.png"});
      fireEvent.change(input,{target:{files:[file]}});
      expect(input.value).toBe("");
      await waitFor(()=>expect(screen.getByTestId("success-state")).toBeTruthy());
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });
  it("uses session CSRF and local preview without publishing and releases URL",async()=>{
    fetchMock.mockResolvedValue({ok:true,json:async()=>({id:"abc",status:"pending"})});
    const view=render(<Upload csrfToken="session-csrf"/>);
    fireEvent.change(screen.getByTestId("upload-input"),{target:{files:[new File(["x"],"a.png",{type:"image/png"})]}});
    expect(screen.getByRole("status").textContent).toBe("Uploading...");
    await waitFor(()=>expect(screen.getByTestId("success-state")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/media/upload",expect.objectContaining({credentials:"same-origin",headers:{"X-CSRF-Token":"session-csrf"}}));
    expect(screen.getByTestId("preview-image").getAttribute("src")).toBe("blob:private-preview");
    view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-preview");
  });
  it("retains selection for accessible retry after denial",async()=>{
    fetchMock.mockResolvedValueOnce({ok:false,status:403,json:async()=>({error:{message:"Forbidden"}})}).mockResolvedValueOnce({ok:true,json:async()=>({id:"abc"})});
    render(<Upload csrfToken="csrf"/>);
    fireEvent.change(screen.getByTestId("upload-input"),{target:{files:[new File(["x"],"a.png")]}});
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe("Forbidden"));
    fireEvent.click(screen.getByRole("button",{name:"Retry upload"}));
    await waitFor(()=>expect(screen.getByTestId("success-state")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
