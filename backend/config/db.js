const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
        });
        console.log("MongoDB Connected");
        return mongoose.connection;
    } catch (error) {
        const code = error?.code || error?.name || "MONGO_CONNECTION_FAILED";
        console.error("DB connection failed:", code);
        throw error;
    }
};

module.exports = connectDB;
