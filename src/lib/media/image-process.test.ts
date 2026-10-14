import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage } from "./image-process";

describe("isolated image processor", () => {
  it.each(["jpeg", "png", "webp"] as const)("re-encodes static %s without metadata", async format => {
    const bytes = await sharp({create:{width:2,height:2,channels:3,background:"red"}}).withMetadata().toFormat(format).toBuffer();
    const output = await processImage(bytes, `image/${format}`);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe(format);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });
  it("rejects invalid data", async () => { await expect(processImage(Buffer.from("broken"), "image/png")).rejects.toMatchObject({statusCode:415}); });
  it("rejects excessive geometry before decode", async () => {
    const bytes = await sharp({create:{width:4097,height:1,channels:3,background:"red"}}).png().toBuffer();
    await expect(processImage(bytes,"image/png")).rejects.toMatchObject({statusCode:422});
  });
  it.each([{width:4096,height:1,valid:true},{width:4000,height:2000,valid:true},{width:4000,height:2001,valid:false}])("enforces actual metadata and decode boundaries %j", async ({width,height,valid}) => {
    const bytes=await sharp({create:{width,height,channels:3,background:"red"}}).png().toBuffer();
    if(valid) expect((await processImage(bytes,"image/png",undefined,{onMetrics:metrics=>console.info("IMAGE_RESOURCE_OBSERVATION",{width,height,...metrics})})).length).toBeGreaterThan(0);
    else await expect(processImage(bytes,"image/png")).rejects.toMatchObject({statusCode:422});
  });
  it.each(["jpeg","png","webp"] as const)("rejects truncated %s content",async format=>{
    const bytes=await sharp({create:{width:32,height:32,channels:3,background:"red"}}).toFormat(format).toBuffer();
    await expect(processImage(bytes.subarray(0,Math.floor(bytes.length/2)),`image/${format}`)).rejects.toMatchObject({statusCode:415});
  });
  it("awaits actual child termination on deadline and yields no late result", async () => {
    let exited = false;
    let pid: number | undefined;
    await expect(processImage(Buffer.alloc(0), "image/png", undefined, {deadlineMs:1,onExit: value => {exited=true;pid=value;}})).rejects.toMatchObject({statusCode:408});
    expect(exited).toBe(true);
    expect(() => process.kill(pid!,0)).toThrow();
  });
  it("terminates and awaits child on abort", async () => {
    const controller = new AbortController();
    let exited=false;
    const operation=processImage(Buffer.alloc(0),"image/png",controller.signal,{onExit:()=>{exited=true;}});
    controller.abort();
    await expect(operation).rejects.toMatchObject({statusCode:400});
    expect(exited).toBe(true);
  });
});
