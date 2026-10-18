import {describe,it,expect,vi} from "vitest";
import {readMediaFile,readPublishId,MAX_MEDIA_REQUEST_BYTES} from "./request";
const request=(file:File)=>{const body=new FormData();body.append("file",file);return new Request("http://local.test",{method:"POST",body});};
describe("bounded media request",()=>{
  it.each(["deadline","abort"])("cancels and releases a stalled stream on %s",async scenario=>{
    vi.useFakeTimers();
    const cancel=vi.fn();const controller=new AbortController();
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1]));},cancel});
    const req=new Request("http://local.test",{method:"POST",headers:{"content-type":"multipart/form-data; boundary=x"},body:stream,signal:controller.signal,duplex:"half"} as RequestInit);
    try {
      const operation=readMediaFile(req);
      const rejected=expect(operation).rejects.toMatchObject({statusCode:scenario==="deadline"?408:400});
      await Promise.resolve();await Promise.resolve();
      if(scenario==="deadline") await vi.advanceTimersByTimeAsync(10000); else controller.abort();
      await rejected;
      expect(cancel).toHaveBeenCalledTimes(1);expect(req.body!.locked).toBe(false);
      const reader=req.body!.getReader();reader.releaseLock();
    }finally{vi.useRealTimers();}
  });
  it("accepts exact file boundary and rejects one byte over independently",async()=>{
    expect((await readMediaFile(request(new File([new Uint8Array(5242880)],"a.png")))).size).toBe(5242880);
    await expect(readMediaFile(request(new File([new Uint8Array(5242881)],"a.png")))).rejects.toMatchObject({statusCode:413});
  });
  it("counts actual bytes despite a false content length",async()=>{
    const req=new Request("http://local.test",{method:"POST",headers:{"content-type":"multipart/form-data; boundary=x","content-length":"1"},body:new Uint8Array(MAX_MEDIA_REQUEST_BYTES+1)});
    await expect(readMediaFile(req)).rejects.toMatchObject({statusCode:413});
  });
  it("accepts the exact total request boundary independently",async()=>{
    const suffix=Buffer.from("\r\n--x--\r\n");
    const prefixStart='--x\r\nContent-Disposition: form-data; name="file"; filename="';
    const prefixEnd='.png"\r\nContent-Type: image/png\r\n\r\n';
    const filenameLength=MAX_MEDIA_REQUEST_BYTES-5242880-suffix.length-Buffer.byteLength(prefixStart+prefixEnd);
    const prefix=Buffer.from(prefixStart+"a".repeat(filenameLength)+prefixEnd);
    const body=Buffer.concat([prefix,Buffer.alloc(5242880),suffix]);
    expect(body.length).toBe(MAX_MEDIA_REQUEST_BYTES);
    expect((await readMediaFile(new Request("http://local.test",{method:"POST",headers:{"content-type":"multipart/form-data; boundary=x"},body}))).size).toBe(5242880);
  });
  it("rejects extra parts and malformed multipart",async()=>{
    const body=new FormData();body.append("file",new File(["x"],"x.png"));body.append("file",new File(["y"],"y.png"));
    await expect(readMediaFile(new Request("http://local.test",{method:"POST",body}))).rejects.toMatchObject({statusCode:400});
    await expect(readMediaFile(new Request("http://local.test",{method:"POST",body:"broken",headers:{"content-type":"multipart/form-data; boundary=x"}}))).rejects.toMatchObject({statusCode:400});
  });
  it("strictly validates publish JSON",async()=>{
    const req=(body:unknown)=>new Request("http://local.test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    expect(await readPublishId(req({id:"abc123"}))).toBe("abc123");
    await expect(readPublishId(req({id:"abc",unexpected:true}))).rejects.toMatchObject({statusCode:400});
  });
});


it("supports catalog deadline and independent configured body bound", async () => {
  vi.useFakeTimers();
  const req=new Request("http://local.test",{method:"POST",headers:{"content-type":"multipart/form-data; boundary=x"},body:new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}}),duplex:"half"} as RequestInit);
  try { const result=readMediaFile(req,{deadlineMs:15000,maxBytes:12}); const rejected=expect(result).rejects.toMatchObject({statusCode:408}); await vi.advanceTimersByTimeAsync(14999); expect(req.body!.locked).toBe(true); await vi.advanceTimersByTimeAsync(1); await rejected; }
  finally {vi.useRealTimers();}
  await expect(readMediaFile(new Request("http://local.test",{method:"POST",headers:{"content-type":"multipart/form-data; boundary=x"},body:new Uint8Array(13)}),{maxBytes:12})).rejects.toMatchObject({statusCode:413});
});
