import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({children:[] as Array<{emit:(name:string,...args:unknown[])=>boolean}>}));
vi.mock("node:child_process",()=>({spawn:vi.fn(()=>{
  const child=new EventEmitter(); Object.assign(child,{pid:123,send:vi.fn(),kill:vi.fn()}); state.children.push(child); return child;
})}));
import { processImage } from "./image-process";
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
const finish=(index:number)=>{state.children[index].emit("message",{bytes:Buffer.from("processed").toString("base64")});state.children[index].emit("close",0);};
afterEach(()=>{vi.useRealTimers();state.children.length=0;});
it("limits actual children to four, removes aborted FIFO waiters, and starts next only on close",async()=>{
  const active=Array.from({length:4},()=>processImage(Buffer.from("x"),"image/png")); await flush(); expect(state.children).toHaveLength(4);
  const controller=new AbortController();const cancelled=processImage(Buffer.from("x"),"image/png",controller.signal);const rejected=expect(cancelled).rejects.toMatchObject({code:"REQUEST_ABORTED"});
  const next=processImage(Buffer.from("first-waiter"),"image/png");
  const last=processImage(Buffer.from("second-waiter"),"image/png"); await flush();expect(state.children).toHaveLength(4);
  controller.abort();await rejected; finish(0);await flush();expect(state.children).toHaveLength(5);
  expect(vi.mocked(spawn).mock.results.at(-1)?.value.send).toHaveBeenCalledWith({bytes:Buffer.from("first-waiter").toString("base64"),mime:"image/png"},expect.any(Function));
  finish(1);await flush();expect(state.children).toHaveLength(6);
  expect(vi.mocked(spawn).mock.results.at(-1)?.value.send).toHaveBeenCalledWith({bytes:Buffer.from("second-waiter").toString("base64"),mime:"image/png"},expect.any(Function));
  [2,3,4,5].forEach(finish);await Promise.all([...active,next,last]);
});
it("expires FIFO waits after fifteen seconds while retaining slots until child close",async()=>{
  vi.useFakeTimers();const active=Array.from({length:4},()=>processImage(Buffer.from("x"),"image/png",undefined,{deadlineMs:30000}));await flush();
  const queued=processImage(Buffer.from("x"),"image/png");const rejected=expect(queued).rejects.toMatchObject({statusCode:503,code:"SERVER_BUSY"});
  await vi.advanceTimersByTimeAsync(15000);await rejected;expect(state.children).toHaveLength(4);
  [0,1,2,3].forEach(finish);await Promise.all(active);
});

it("maps synchronous spawn failure and releases its slot",async()=>{
  vi.mocked(spawn).mockImplementationOnce(()=>{throw new Error("spawn unavailable");});
  await expect(processImage(Buffer.from("x"),"image/png")).rejects.toMatchObject({statusCode:503,code:"IMAGE_UNAVAILABLE"});
  const operations=Array.from({length:4},()=>processImage(Buffer.from("x"),"image/png"));await flush();expect(state.children).toHaveLength(4);[0,1,2,3].forEach(finish);await Promise.all(operations);
});
