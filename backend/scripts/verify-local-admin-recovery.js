const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(source, fragment, message) {
    assert.ok(source.includes(fragment), message);
}

function main() {
    const script = read("backend/scripts/local-admin-recovery.js");
    const packageJson = JSON.parse(read("package.json"));
    const gitignore = read(".gitignore");

    assert.strictEqual(
        packageJson.scripts["admin:recover-local"],
        "node backend/scripts/local-admin-recovery.js",
        "package.json must expose only the local CLI recovery script"
    );

    assertIncludes(script, "process.env.NODE_ENV", "recovery must inspect NODE_ENV");
    assertIncludes(script, "Local admin recovery is disabled in production.", "recovery must explicitly block production");
    assertIncludes(script, "process.env.RENDER", "recovery must refuse hosted Render-like environments");
    assertIncludes(script, "AZIEL_LOCAL_ADMIN_RECOVERY", "recovery must require explicit local acknowledgement");
    assertIncludes(script, "Refusing non-local Mongo host", "recovery must refuse non-local Mongo hosts");
    assertIncludes(script, "AdminAccount.countDocuments", "recovery must inspect local admin account count before bootstrap");
    assertIncludes(script, "Refusing to create a new owner because local admin accounts already exist", "recovery must not bootstrap an owner into a non-empty admin database");
    assertIncludes(script, "Refusing to promote a non-owner admin account during local recovery", "recovery must not promote unrelated admin accounts");
    assertIncludes(script, "AdminSession.updateMany", "recovery must revoke existing admin sessions");
    assertIncludes(script, "AdminLoginChallenge.deleteMany", "recovery must clear old admin login challenges");
    assertIncludes(script, "twoFactor = {", "recovery must rotate 2FA state");
    assertIncludes(script, "enabled: true", "recovery must keep 2FA enabled");
    assertIncludes(script, "encryptSecret(secret)", "recovery must encrypt the regenerated TOTP secret");
    assertIncludes(script, "mode: 0o600", "TOTP setup artifact must be written with owner-only permissions");
    assertIncludes(script, "ADMIN_2FA_RESET", "recovery must write an admin audit event");
    assertIncludes(script, "localRecovery: true", "recovery audit metadata must identify local recovery");
    assertIncludes(gitignore, ".local-admin-recovery/", "local recovery artifacts must be gitignored");

    const forbidden = [
        "router.",
        "app.get(",
        "app.post(",
        "res.json",
        "res.send"
    ];
    forbidden.forEach(fragment => {
        assert.ok(!script.includes(fragment), `recovery must not expose HTTP behavior: ${fragment}`);
    });

    console.log("verify-local-admin-recovery: ok");
}

try {
    main();
} catch (error) {
    console.error("verify-local-admin-recovery: failed");
    console.error(error);
    process.exit(1);
}
