// frontend/js/asset.js

(function () {

    const ROOT = "assets";

    const ASSET = {

        root(path) {
            return `${ROOT}/${path}`;
        },

        logo(file) {
            return `${ROOT}/logo/${file}`;
        },

        payment(file) {
            return `${ROOT}/payment/${file}`;
        },

        game(file) {
            return `${ROOT}/games/${file}`;
        },

        mlbb(file) {
            return `${ROOT}/mlbb/${file}`;
        },

        pubg(file) {
            return `${ROOT}/pubg/${file}`;
        },

        freefire(file) {
            return `${ROOT}/freefire/${file}`;
        },

        hok(file) {
            return `${ROOT}/hok/${file}`;
        },

        roblox(file) {
            return `${ROOT}/roblox/${file}`;
        },

        valorant(file) {
            return `${ROOT}/valorant/${file}`;
        }

    };

    window.ASSET = ASSET;

})();
