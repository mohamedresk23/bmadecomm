import { describe,it,expect } from "vitest";
import { hasAnimation,validateImageMetadata } from "./image-policy";
describe("image policy",()=>{
  it("applies cumulative exact geometry limits",()=>{
    expect(()=>validateImageMetadata({width:4000,height:2000})).not.toThrow();
    expect(()=>validateImageMetadata({width:4096,height:1})).not.toThrow();
    for(const metadata of [{width:4097,height:1},{width:4000,height:2001},{width:4096,height:4096},{width:1,height:1,pages:2}]) expect(()=>validateImageMetadata(metadata)).toThrow();
  });
  it("detects APNG and animated WebP containers",()=>{
    const png=Buffer.alloc(20); png.write("acTL",12); expect(hasAnimation(png,"image/png")).toBe(true);
    const webp=Buffer.alloc(20); webp.write("ANIM",12); expect(hasAnimation(webp,"image/webp")).toBe(true);
  });
});
