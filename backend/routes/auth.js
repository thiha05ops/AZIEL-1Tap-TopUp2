const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const filePath = path.join(__dirname, "../data/user.json");

function getUsers() {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, "utf8");
    return data ? JSON.parse(data) : [];
}

function saveUsers(users) {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
}

router.post("/register", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Missing username or password"
        });
    }

    const users = getUsers();
    const exists = users.find((u) => u.username === username);

    if (exists) {
        return res.json({
            success: false,
            message: "Username already exists"
        });
    }

    users.push({ username, password });
    saveUsers(users);

    res.json({
        success: true,
        message: "Register success"
    });
});

router.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Missing username or password"
        });
    }

    const users = getUsers();
    const user = users.find(
        (u) => u.username === username && u.password === password
    );

    if (!user) {
        return res.json({
            success: false,
            message: "Wrong username or password"
        });
    }

    res.json({
        success: true,
        message: "Login success",
        username
    });
});

module.exports = router;