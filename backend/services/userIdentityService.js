function getDisplayUsername(user = {}) {
    return String(user.displayUsername || user.username || "");
}

module.exports = {
    getDisplayUsername
};
