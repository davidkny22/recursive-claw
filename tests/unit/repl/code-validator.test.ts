import { describe, it, expect } from 'vitest';
import { validateCode } from '../../../src/retrieval/repl/code-validator.js';

describe('validateCode', () => {
  it('accepts valid code', () => {
    expect(validateCode('const x = await peek(0, 10);').valid).toBe(true);
    expect(validateCode('const results = await grep("JWT");').valid).toBe(true);
    expect(validateCode('print("hello");').valid).toBe(true);
    expect(validateCode('store("key", "value");').valid).toBe(true);
    expect(validateCode('FINAL("the answer");').valid).toBe(true);
  });

  it('rejects prototype chain escapes', () => {
    expect(validateCode('x.__proto__.polluted = true').valid).toBe(false);
    expect(validateCode('x.constructor.constructor("return this")()').valid).toBe(false);
    expect(validateCode('x["constructor"]').valid).toBe(false);
    expect(validateCode('Object.getPrototypeOf(x)').valid).toBe(false);
    expect(validateCode('Reflect.get(x, "y")').valid).toBe(false);
  });

  it('rejects module system access', () => {
    expect(validateCode('require("fs")').valid).toBe(false);
    expect(validateCode('import("fs")').valid).toBe(false);
    expect(validateCode('import fs from "fs"').valid).toBe(false);
  });

  it('rejects process/system access', () => {
    expect(validateCode('process.env.SECRET').valid).toBe(false);
    expect(validateCode('globalThis.something').valid).toBe(false);
    expect(validateCode('Function("return this")()').valid).toBe(false);
  });

  it('rejects network access', () => {
    expect(validateCode('fetch("https://evil.com")').valid).toBe(false);
    expect(validateCode('new XMLHttpRequest()').valid).toBe(false);
    expect(validateCode('new WebSocket("ws://evil")').valid).toBe(false);
  });

  it('rejects setInterval', () => {
    expect(validateCode('setInterval(() => {}, 100)').valid).toBe(false);
  });
});
