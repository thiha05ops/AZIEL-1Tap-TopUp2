const adminUsersRoutes =
    require("./routes/adminUsers");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const adminAuthRoutes =
    require("./routes/adminAuth");
const supportRoutes =
    require("./routes/support");

dotenv.config({
    path: path.join(__dirname, "../.env")
});

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const passport = require("./config/passport");

// ROUTES

const notificationRoutes = require("./routes/notification");
const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/order");
const paymentRoutes = require("./routes/payment");
const profileRoutes = require("./routes/profile");
const socialAuthRoutes = require("./routes/socialAuth");
const passwordRoutes = require("./routes/password");
const supplierRoutes = require("./routes/supplier");
const walletRoutes = require("./routes/wallet");
const adminStatsRoutes = require("./routes/adminStats");

// EXPRESS APP
const app = express();

// SOCKET SERVER
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


app.set("io", io);

io.on("connection", socket => {
    console.log("⚡ Socket connected:", socket.id);

    socket.on("joinAdmin", () => {
        socket.join("admins");
        console.log("✅ Admin joined admins room");
    });

    socket.on("joinAdminRoom", () => {
        socket.join("admins");
        console.log("✅ Admin joined admins room");
    });

    socket.on("joinUser", username => {
        if (!username) return;
        socket.join(String(username));
        console.log("✅ User joined:", username);
    });

    socket.on("joinUserRoom", username => {
        if (!username) return;
        socket.join(String(username));
        console.log("✅ User room joined:", username);
    });

    socket.on("liveChatMessage", data => {
        socket.to("admins").emit("liveChatMessage", data);
    });

    socket.on("adminLiveReply", data => {
        if (!data.username) return;
        io.to(String(data.username)).emit("adminLiveReply", data);
    });

    socket.on("disconnect", () => {
        console.log("❌ Socket disconnected:", socket.id);
    });
});
// CONNECT DB
connectDB();

// MIDDLEWARE
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET || "aziel_secret",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());

app.use(passport.session());

// STATIC FILES
app.use(
    express.static(
        path.join(__dirname, "../frontend")
    ));

app.use(
    "/uploads",
    express.static(
        path.join(__dirname, "uploads")
    )
);

// ROUTES
app.use("/api", authRoutes);

app.use("/api", orderRoutes);

app.use("/api", paymentRoutes);

app.use("/api", notificationRoutes);

app.use("/api", profileRoutes);

app.use("/api", socialAuthRoutes);

app.use("/api", passwordRoutes);

app.use("/api", supplierRoutes);

app.use("/api", walletRoutes);

app.use("/api", adminStatsRoutes);

app.use("/api", adminAuthRoutes);
app.use("/api", supportRoutes);
app.use("/api", adminUsersRoutes);

// HOME
app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "../frontend/home.html"
        )
    );

});
// ===============================
// LIVE CHAT DIRECT API
// ===============================

const mongoose = require("mongoose");

const liveChatSchema = new mongoose.Schema(
    {
        chatId: String,
        username: String,
        status: {
            type: String,
            default: "active"
        },
        messages: [
            {
                sender: String,
                text: String,
                createdAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ],
        lastMessageAt: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

const DirectLiveChat =
    mongoose.models.DirectLiveChat ||
    mongoose.model("DirectLiveChat", liveChatSchema);

app.post("/api/live-chat/send", async (req, res) => {
    try {
        const { username, message } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Message required"
            });
        }

        let chat = await DirectLiveChat.findOne({
            username: username || "Guest",
            status: "active"
        });

        if (!chat) {
            chat = await DirectLiveChat.create({
                chatId: "CHAT-" + Date.now(),
                username: username || "Guest",
                messages: []
            });
        }

        chat.messages.push({
            sender: "user",
            text: message
        });

        chat.lastMessageAt = new Date();
        await chat.save();

        res.json({
            success: true,
            chat
        });
    } catch (error) {
        console.error("Live chat send error:", error);
        res.status(500).json({
            success: false,
            message: "Live chat server error"
        });
    }
});

app.get("/api/live-chat/admin", async (req, res) => {
    try {
        const chats = await DirectLiveChat.find({
            status: "active"
        }).sort({ lastMessageAt: -1 });

        res.json({
            success: true,
            chats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Admin chat fetch error"
        });
    }
});
// USER GET OWN LIVE CHAT HISTORY
app.get("/api/live-chat/user/:username", async (req, res) => {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        let chat = await DirectLiveChat.findOne({
            username: req.params.username,
            status: "active"
        }).sort({ lastMessageAt: -1 });

        if (chat && chat.lastMessageAt < oneHourAgo) {
            chat.status = "deleted";
            await chat.save();
            chat = null;
        }

        res.json({
            success: true,
            chat
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Load chat history error"
        });
    }
});

// ADMIN REPLY
app.post("/api/live-chat/admin/reply/:chatId", async (req, res) => {
    try {

        const { message } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Reply required"
            });
        }

        const chat = await DirectLiveChat.findOne({
            chatId: req.params.chatId
        });

        if (!chat) {
            return res.status(404).json({
                success: false,
                message: "Chat not found"
            });
        }

        chat.messages.push({
            sender: "admin",
            text: message
        });

        chat.lastMessageAt = new Date();

        await chat.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log("Admin reply error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });

    }
});

// PORT
const PORT = process.env.PORT || 3000;

// START SERVER
server.listen(PORT, () => {

    console.log(
        `🔥 Server running on port ${PORT}`
    );

});

