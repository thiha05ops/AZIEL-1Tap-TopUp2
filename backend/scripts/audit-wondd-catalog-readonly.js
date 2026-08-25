#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const ENDPOINT = "https://www.wondd.com/member/bot-game-packlist.php";
const OUTPUT_JSON = path.resolve(__dirname, "../../docs/wondd-catalog-audit.json");
const OUTPUT_MARKDOWN = path.resolve(__dirname, "../../docs/wondd-catalog-audit.md");
const ALLOWED_FIELDS = new Set([
    "serviceid",
    "servicecode",
    "packcode",
    "name",
    "point",
    "amount",
    "discount",
    "netpricedealer"
]);

function requiredCredential(name) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`Missing required configuration: ${name}`);
    return value;
}

function familyName(serviceId, rows) {
    const known = {
        "9601": "RoV",
        "9602": "Free Fire",
        "9603": "Undawn",
        "9604": "Black Clover M",
        "9605": "Call of Duty Mobile",
        "9606": "Delta Force",
        "9607": "Haikyu Fly High",
        "9621": "PUBG Mobile",
        "9622": "Mobile Legends",
        "9623": "Valorant",
        "9624": "Heartopia"
    };
    return known[String(serviceId)] || `Unknown service ${serviceId}`;
}

function escapeCell(value) {
    return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function validate(rows) {
    if (!Array.isArray(rows)) throw new Error("WonDD response was not an array");
    rows.forEach((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
            throw new Error(`Invalid package at response index ${index}`);
        }
        for (const key of Object.keys(row)) {
            if (!ALLOWED_FIELDS.has(key)) {
                throw new Error(`Unexpected response field at index ${index}: ${key}`);
            }
        }
        for (const key of ["serviceid", "packcode", "name", "amount", "discount", "netpricedealer"]) {
            if (row[key] === undefined || row[key] === null || row[key] === "") {
                throw new Error(`Missing ${key} at response index ${index}`);
            }
        }
    });
}

function buildAudit(rows, httpStatus, contentType) {
    const grouped = new Map();
    rows.forEach(row => {
        const serviceId = String(row.serviceid);
        if (!grouped.has(serviceId)) grouped.set(serviceId, []);
        grouped.get(serviceId).push(row);
    });

    const games = [...grouped.entries()].map(([serviceid, packages]) => ({
        game: familyName(serviceid, packages),
        serviceid,
        servicecode: packages.find(item => item.servicecode)?.servicecode || null,
        packageCount: packages.length,
        packages
    }));

    return {
        auditType: "READ_ONLY_WONDD_CATALOG",
        endpoint: ENDPOINT,
        capturedAt: new Date().toISOString(),
        request: {
            method: "POST",
            authentication: "application/x-www-form-urlencoded credentials (values omitted)",
            topupMethodCalled: false
        },
        response: {
            httpStatus,
            contentType,
            packageCount: rows.length,
            gameCount: games.length,
            fields: [...new Set(rows.flatMap(row => Object.keys(row)))].sort(),
            exposesServicecode: rows.some(row => Object.hasOwn(row, "servicecode"))
        },
        games
    };
}

function renderMarkdown(audit) {
    const lines = [
        "# WonDD read-only catalog audit",
        "",
        `Captured: ${audit.capturedAt}`,
        "",
        `Endpoint: \`${audit.endpoint}\``,
        "",
        `Result: HTTP ${audit.response.httpStatus}; ${audit.response.gameCount} games; ${audit.response.packageCount} packages.`,
        "",
        `Servicecode limitation: ${audit.response.exposesServicecode ? "servicecode was exposed." : "the response does not expose a servicecode field."}`,
        "",
        "| Game | serviceid | servicecode | Packages |",
        "|---|---:|---|---:|",
        ...audit.games.map(game => `| ${escapeCell(game.game)} | ${escapeCell(game.serviceid)} | ${escapeCell(game.servicecode || "missing")} | ${game.packageCount} |`),
        ""
    ];

    audit.games.forEach(game => {
        lines.push(`## ${game.game} (serviceid ${game.serviceid})`, "");
        lines.push("| servicecode | packcode | Package name | Amount | Discount | Net dealer price |", "|---|---|---|---:|---:|---:|");
        game.packages.forEach(item => {
            lines.push(`| ${escapeCell(item.servicecode || "missing")} | ${escapeCell(item.packcode)} | ${escapeCell(item.name)} | ${escapeCell(item.amount)} | ${escapeCell(item.discount)} | ${escapeCell(item.netpricedealer)} |`);
        });
        lines.push("");
    });
    return `${lines.join("\n")}\n`;
}

async function main() {
    const username = requiredCredential("WONDD_USERNAME");
    const password = requiredCredential("WONDD_PASSWORD");
    const body = new URLSearchParams({ username, password });
    const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`WonDD catalog request failed with HTTP ${response.status}`);

    let rows;
    try {
        rows = JSON.parse(text);
    } catch {
        throw new Error("WonDD catalog response was not valid JSON");
    }
    validate(rows);

    const audit = buildAudit(rows, response.status, response.headers.get("content-type") || "");
    fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(OUTPUT_MARKDOWN, renderMarkdown(audit), { mode: 0o600 });
    console.log(JSON.stringify({
        result: "PASS",
        auditType: audit.auditType,
        httpStatus: audit.response.httpStatus,
        gameCount: audit.response.gameCount,
        packageCount: audit.response.packageCount,
        serviceIds: audit.games.map(game => game.serviceid),
        servicecodes: audit.games.map(game => game.servicecode).filter(Boolean),
        missingServicecodes: audit.games.filter(game => !game.servicecode).map(game => game.game),
        outputJson: path.relative(process.cwd(), OUTPUT_JSON),
        outputMarkdown: path.relative(process.cwd(), OUTPUT_MARKDOWN)
    }, null, 2));
}

main().catch(error => {
    console.error(`WonDD read-only catalog audit failed: ${error.message}`);
    process.exitCode = 1;
});
