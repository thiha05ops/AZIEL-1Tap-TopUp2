const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    findCustomerForLogin,
    verifyRegistrationAndIssueSession
} = require("../services/customerAuthService");
const { projectUser } = require("../services/authSessionService");
const { getDisplayUsername } = require("../services/userIdentityService");

function fakeUsers(records) {
    const queries = [];
    return {
        queries,
        async findOne(query) {
            queries.push(query);
            return records.find(record => Object.entries(query).every(([key, value]) => record[key] === value)) || null;
        }
    };
}

async function verifyLoginLookup() {
    const exactLegacy = { id: "legacy", username: "naing lwin" };
    const canonical = { id: "canonical", username: "nainglwin" };
    const exactModel = fakeUsers([exactLegacy, canonical]);
    const exactResult = await findCustomerForLogin("  Naing Lwin  ", { UserModel: exactModel });

    assert.strictEqual(exactResult.user, exactLegacy);
    assert.strictEqual(exactResult.matchType, "exact");
    assert.deepStrictEqual(exactModel.queries, [{ username: "naing lwin" }]);

    const fallbackModel = fakeUsers([canonical]);
    const fallbackResult = await findCustomerForLogin("Naing Lwin", { UserModel: fallbackModel });
    assert.strictEqual(fallbackResult.user, canonical);
    assert.strictEqual(fallbackResult.matchType, "canonical_username");
    assert.deepStrictEqual(fallbackModel.queries, [
        { username: "naing lwin" },
        { username: "nainglwin" }
    ]);

    const emailModel = fakeUsers([{ id: "email", email: "naing lwin@example.com" }]);
    const emailResult = await findCustomerForLogin("naing lwin@example.com", { UserModel: emailModel });
    assert.strictEqual(emailResult.user.id, "email");
    assert.deepStrictEqual(emailModel.queries, [{ email: "naing lwin@example.com" }]);

    const missingEmailModel = fakeUsers([{ username: "nainglwin@example.com" }]);
    const missingEmail = await findCustomerForLogin("naing lwin@example.com", { UserModel: missingEmailModel });
    assert.strictEqual(missingEmail.user, null);
    assert.strictEqual(missingEmailModel.queries.length, 1);

    const caseAndSpaceModel = fakeUsers([{ username: "nainglwin", displayUsername: "Naing Lwin" }]);
    const caseAndSpaceResult = await findCustomerForLogin("NAING LWIN", { UserModel: caseAndSpaceModel });
    assert.strictEqual(caseAndSpaceResult.user.displayUsername, "Naing Lwin");

    const projected = projectUser({
        _id: "customer-1",
        username: "nainglwin",
        displayUsername: "Naing Lwin",
        email: "nainglwin@gmail.com"
    });
    assert.strictEqual(projected.username, "nainglwin");
    assert.strictEqual(projected.displayUsername, "Naing Lwin");
    assert.strictEqual(getDisplayUsername({ username: "legacyuser" }), "legacyuser");
}

async function verifyRegistrationLogin() {
    const user = {
        username: "newcustomer",
        email: "newcustomer@gmail.com",
        authProvider: "local"
    };
    let issueCount = 0;
    const result = await verifyRegistrationAndIssueSession(
        { email: user.email, otp: "123456" },
        { headers: {} },
        {
            verifyRegistrationOtp: async () => ({ message: "created", user }),
            recordSecurityEvent: async () => {},
            issueUserSession: async receivedUser => {
                issueCount += 1;
                assert.strictEqual(receivedUser, user);
                return { session: { sessionId: "opaque-session-id" }, user: { username: user.username } };
            }
        }
    );
    assert.strictEqual(issueCount, 1);
    assert.strictEqual(result.session.sessionId, "opaque-session-id");
    assert.deepStrictEqual(result.user, { username: user.username });

    let invalidIssueCount = 0;
    await assert.rejects(() => verifyRegistrationAndIssueSession({}, {}, {
        verifyRegistrationOtp: async () => { throw new Error("Invalid OTP"); },
        recordSecurityEvent: async () => {},
        issueUserSession: async () => { invalidIssueCount += 1; }
    }), /Invalid OTP/);
    assert.strictEqual(invalidIssueCount, 0);

    await assert.rejects(
        () => verifyRegistrationAndIssueSession({}, {}, {
            verifyRegistrationOtp: async () => ({ message: "created", user }),
            recordSecurityEvent: async () => {},
            issueUserSession: async () => { throw new Error("session store unavailable"); }
        }),
        error => error.message === "session store unavailable" && error.registrationCompleted === true
    );
}

function verifyUsernamePresentationWiring() {
    const repoRoot = path.resolve(__dirname, "../..");
    const accountSource = fs.readFileSync(path.join(repoRoot, "frontend/js/account.js"), "utf8");
    const crmSource = fs.readFileSync(path.join(repoRoot, "frontend/js/admin-users.js"), "utf8");
    const crmRouteSource = fs.readFileSync(path.join(repoRoot, "backend/routes/adminUsers.js"), "utf8");

    assert(accountSource.includes('user.displayUsername || user.username || ""'));
    assert(crmSource.includes('user.displayUsername || user.username || "Unknown"'));
    assert(crmRouteSource.includes("displayUsername: getDisplayUsername(user)"));
}

async function main() {
    await verifyLoginLookup();
    await verifyRegistrationLogin();
    verifyUsernamePresentationWiring();
    console.log("Customer authentication flow checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
