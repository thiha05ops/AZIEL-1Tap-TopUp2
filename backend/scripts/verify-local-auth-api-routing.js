#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/login.js"), "utf8");
const apiFunction = source.match(/function apiUrl\(path\) \{[\s\S]*?\n\}/)?.[0];
assert(apiFunction, "login.js must define apiUrl(path).");

function resolve(location, requestPath) {
    const context = { location };
    vm.runInNewContext(`${apiFunction}; result = apiUrl(${JSON.stringify(requestPath)});`, context);
    return context.result;
}

assert.strictEqual(resolve({ protocol: "http:", hostname: "127.0.0.1", port: "5500" }, "/api/auth/google"), "http://127.0.0.1:3000/api/auth/google");
assert.strictEqual(resolve({ protocol: "http:", hostname: "localhost", port: "5500" }, "/api/login"), "http://localhost:3000/api/login");
assert.strictEqual(resolve({ protocol: "https:", hostname: "shop.aziel.com", port: "" }, "/api/auth/2fa/verify"), "/api/auth/2fa/verify");
assert(source.includes('window.location.href = apiUrl("/api/auth/google")'), "Google navigation must use apiUrl.");
assert(source.includes('fetch(apiUrl("/api/login")'), "Password login must use apiUrl.");
assert(source.includes('fetch(apiUrl("/api/auth/2fa/verify")'), "2FA verification must use apiUrl.");

console.log(JSON.stringify({ result: "PASS", localFrontendPort: 5500, localBackendPort: 3000, googleUsesLocalApiBase: true, passwordUsesLocalApiBase: true, twoFactorUsesLocalApiBase: true, productionSameOriginPreserved: true }, null, 2));
