const session = require("express-session");
const connectMongo = require("connect-mongo");

const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;

const SESSION_MAX_AGE_MS = Number(process.env.EXPRESS_SESSION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);

function createSessionMiddleware(options = {}) {
    const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
    const mongoClient = options.mongoClient;

    if (!mongoClient) {
        throw new Error("PROD_SESSION_STORE_UNAVAILABLE");
    }

    return session({
        secret: process.env.SESSION_SECRET || "aziel_secret",
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            client: mongoClient,
            collectionName: "expressSessions",
            stringify: false
        }),
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: isProduction,
            maxAge: SESSION_MAX_AGE_MS
        }
    });
}

module.exports = {
    SESSION_MAX_AGE_MS,
    createSessionMiddleware
};
