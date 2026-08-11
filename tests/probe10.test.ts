import assert from "node:assert";
import { getProgram } from "./helpers/program.ts";

describe("program-factory", () => {
  it("нормализованный IDL даёт валидный BorshCoder для ВСЕХ аккаунтов", () => {
    const { coder, idl } = getProgram();
    const accounts = (idl as any).accounts as Array<{ name: string }>;
    assert.ok(accounts.length > 0, "accounts пустой");
    for (const acc of accounts) {
      const size = coder.accounts.size(acc.name);
      console.log(acc.name.padEnd(26), "size =>", size);
      assert.ok(typeof size === "number" && size > 0, `${acc.name}: size=${size}`);
    }
  });

  it("полный Program либо построен, либо сработал raw fallback", () => {
    const handle = getProgram();
    console.log("full Program:", handle.full, "| rawFallback:", handle.rawFallback);
    assert.ok(handle.full || handle.rawFallback, "ни Program, ни fallback не доступны");
    if (handle.full && handle.program) {
      assert.ok(handle.program, "program пуст");
    }
  });
});
