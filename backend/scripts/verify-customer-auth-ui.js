#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const loginHtml = read("frontend/login.html");
const registerHtml = read("frontend/register.html");
const otpHtml = read("frontend/verify-email.html");
const authCss = read("frontend/css/auth/auth.css");
const loginJs = read("frontend/js/login.js");
const registerJs = read("frontend/js/register.js");
const otpJs = read("frontend/js/verify-email.js");

assert.match(registerJs, /const username = document\.getElementById\("username"\)\.value\.trim\(\);/);
assert.doesNotMatch(registerJs, /username[^;\n]*toLowerCase\(/);
assert.match(registerJs, /if \(registrationPending\) return;/);
assert.match(otpJs, /if \(verificationPending\) return;/);
assert.match(otpJs, /credentials: "include"/);
assert.match(otpJs, /persistCustomer\(data\.user\)/);
assert.match(otpJs, /resolvePostLoginRedirect\(\)/);

for (const [name, html] of [["login", loginHtml], ["register", registerHtml], ["OTP", otpHtml]]) {
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/, `${name} needs a live status region`);
    assert.match(html, /auth\.css\?v=20261025-auth-ui-1/, `${name} needs the current auth stylesheet`);
    assert.match(html, /id="azHeaderMount" data-nav="home"/, `${name} needs the shared header mount`);
    assert.match(html, /aziel-header\.css/, `${name} needs the shared header stylesheet`);
    assert.strictEqual((html.match(/header-loader\.js/g) || []).length, 1, `${name} must initialize the header once`);
    assert.strictEqual((html.match(/header\.js/g) || []).length, 1, `${name} must hydrate the header once`);
    assert.match(html, /href="\/policies\/terms"/);
    assert.match(html, /href="\/policies\/privacy"/);
    assert.strictEqual((html.match(/home-footer-accordion\.js/g) || []).length, 1, `${name} must initialize the canonical footer once`);
    assert.match(html, /class="site-footer"/);
    assert.match(html, /href="\/policies\/payment"/);
    assert.match(html, /href="\/policies\/refund"/);
    assert.match(html, /href="\/policies\/support"/);
    assert.doesNotMatch(html, /class="auth-mobile-logo/, `${name} must not duplicate the shared header logo`);
}

assert.doesNotMatch(loginHtml, /class="auth-acceptance"/);
assert.match(registerHtml, /class="auth-acceptance"/);
assert.doesNotMatch(otpHtml, /class="auth-acceptance"/);
assert.match(registerHtml, /class="auth-acceptance"[\s\S]*?href="\/policies\/terms"[\s\S]*?href="\/policies\/privacy"/);

assert.match(loginHtml, /aria-label="Show password"[^>]*data-i18n-aria-label="auth\.password\.show"/);
assert.match(registerHtml, /aria-label="Show passwords"[^>]*data-i18n-aria-label="auth\.password\.showBoth"/);
assert.match(loginJs, /setAttribute\("aria-pressed"/);
assert.match(registerJs, /setAttribute\("aria-pressed"/);

assert.match(otpHtml, /class="auth-page auth-otp-page"/);
assert.doesNotMatch(otpHtml, /auth-brand-panel/);
assert.match(otpHtml, /autocomplete="one-time-code"/);
assert.match(otpHtml, /pattern="\[0-9\]\{6\}"/);
assert.match(otpHtml, /autofocus/);
assert.match(otpHtml, /data-i18n="auth\.otp\.securityReminder"/);
assert.match(otpHtml, /data-i18n="auth\.otp\.recovery"/);
assert.doesNotMatch(otpHtml, /resend/i, "OTP page must not imply unsupported resend behavior");

assert.match(authCss, /@media \(max-width: 900px\)/);
assert.match(authCss, /\.auth-brand-panel\s*\{\s*display:\s*none;/s);
assert.match(authCss, /grid-template-columns:\s*minmax\(0, 45fr\) minmax\(0, 55fr\)/);
assert.match(authCss, /\.auth-card > \*/);
assert.match(authCss, /\.auth-input input:focus,[\s\S]*?box-shadow:\s*none;/);
assert.match(authCss, /\.auth-input:focus-within\s*\{[\s\S]*?0 0 0 3px/);
assert.doesNotMatch(authCss, /\.auth-input:focus-within,\s*\.auth-main-btn:focus-visible/);
assert.match(authCss, /\.auth-otp-page \.auth-card/);
assert.match(authCss, /\.auth-acceptance/);
assert.match(authCss, /html\[lang="my"\]/);
assert.match(authCss, /Noto Sans Myanmar/);
assert.match(authCss, /@media \(prefers-reduced-motion: reduce\)/);

const requiredKeys = [
    "auth.login.title",
    "auth.register.title",
    "auth.password.show",
    "auth.password.showBoth",
    "auth.otp.title",
    "auth.otp.explanation",
    "auth.otp.delivery",
    "auth.otp.codeLabel",
    "auth.otp.securityReminder",
    "auth.otp.recovery",
    "auth.otp.registerAgain",
    "auth.brand.headline",
    "auth.brand.description",
    "auth.brand.cta",
    "auth.acceptance.prefix",
    "auth.acceptance.terms",
    "auth.acceptance.joiner",
    "auth.acceptance.privacy",
    "auth.acceptance.suffix",
    "auth.login.failed",
    "auth.register.failed",
    "errors.REGISTRATION_SESSION_FAILED"
];

for (const locale of ["en", "my", "th"]) {
    const sandbox = { window: { AZIEL_LANG: {} } };
    vm.runInNewContext(read(`frontend/lang/runtime/${locale}.js`), sandbox, {
        filename: `frontend/lang/runtime/${locale}.js`
    });
    const dictionary = sandbox.window.AZIEL_LANG[locale];
    for (const key of requiredKeys) {
        assert.strictEqual(typeof dictionary[key], "string", `${locale} is missing ${key}`);
        assert.ok(dictionary[key].trim(), `${locale} has an empty ${key}`);
    }
}

{
    const sandbox = { window: { AZIEL_LANG: {} } };
    vm.runInNewContext(read("frontend/lang/runtime/my.js"), sandbox);
    const my = sandbox.window.AZIEL_LANG.my;
    assert.strictEqual(my["auth.login.description"], "သင့် AZIEL အကောင့်ထဲ ဝင်ရောက်နိုင်ပါတယ်။");
    assert.strictEqual(my["auth.login.noAccount"], "အကောင့်မရှိသေးတာလားခင်ဗျာ?");
    assert.strictEqual(my["auth.register.existingAccount"], "အကောင့်ရှိပြီးသားလားခင်ဗျာ?");
    assert.strictEqual(my["auth.otp.success"], "အီးမေးလ် အတည်ပြုပြီးပါပြီ!");
    assert.strictEqual(
        [my["auth.acceptance.prefix"], my["auth.acceptance.terms"], my["auth.acceptance.joiner"], my["auth.acceptance.privacy"]].join(" ") + my["auth.acceptance.suffix"],
        "အကောင့်ဖွင့်ခြင်းဖြင့် AZIEL ၏ ဝန်ဆောင်မှု စည်းမျဉ်းများ နှင့် ကိုယ်ရေးအချက်အလက် မူဝါဒ ကို သိရှိပြီး သဘောတူသည်ဟု ယူဆပါသည်။"
    );
}

console.log("Customer authentication UI verification passed.");
