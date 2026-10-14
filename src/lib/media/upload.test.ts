import {beforeEach,describe,it,expect,vi} from "vitest";
import sharp from "sharp";
const mocks=vi.hoisted(()=>({savePrivate:vi.fn(),removePrivate:vi.fn(),recordOrphan:vi.fn(),insert:vi.fn(),values:vi.fn()}));
vi.mock("../../db",()=>({db:{insert:mocks.insert}}));
vi.mock("./storage",()=>({storage:mocks}));
import {processAndSaveMedia} from "./upload";
beforeEach(()=>{vi.clearAllMocks();mocks.insert.mockReturnValue({values:mocks.values});mocks.savePrivate.mockResolvedValue(undefined);mocks.removePrivate.mockResolvedValue(undefined);mocks.values.mockResolvedValue(undefined);});
const image=async()=>new File([new Uint8Array(await sharp({create:{width:1,height:1,channels:3,background:"red"}}).png().toBuffer())],"a.png",{type:"image/png"});
describe("private media persistence compensation",()=>{
  it("aborted processing leaves no storage or row",async()=>{
    const controller=new AbortController(); controller.abort();
    await expect(processAndSaveMedia(await image(),controller.signal)).rejects.toMatchObject({statusCode:400});
    expect(mocks.savePrivate).not.toHaveBeenCalled();expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("cleans only newly staged key on DB failure",async()=>{
    mocks.values.mockRejectedValue(new Error("database password secret"));
    await expect(processAndSaveMedia(await image())).rejects.toMatchObject({statusCode:503,message:"Media storage unavailable"});
    expect(mocks.removePrivate).toHaveBeenCalledWith(mocks.savePrivate.mock.calls[0][0]);
  });
  it("records opaque recovery key when scoped removal fails",async()=>{
    mocks.values.mockRejectedValue(new Error("db"));mocks.removePrivate.mockRejectedValue(new Error("disk"));
    await expect(processAndSaveMedia(await image())).rejects.toMatchObject({statusCode:503});
    expect(mocks.recordOrphan).toHaveBeenCalledWith(mocks.savePrivate.mock.calls[0][0]);
  });
  it("preserves preexisting storage on exclusive creation failure",async()=>{
    mocks.savePrivate.mockRejectedValue(Object.assign(new Error("exists"),{code:"EEXIST"}));
    await expect(processAndSaveMedia(await image())).rejects.toMatchObject({statusCode:503});
    expect(mocks.removePrivate).not.toHaveBeenCalled();expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects MIME and extension spoofing before storage",async()=>{
    const valid=await image();
    for(const file of [new File([await valid.arrayBuffer()],"a.jpg",{type:"image/png"}),new File([await valid.arrayBuffer()],"a.png",{type:"image/jpeg"})]) await expect(processAndSaveMedia(file)).rejects.toMatchObject({statusCode:415});
    expect(mocks.savePrivate).not.toHaveBeenCalled();
  });
});
