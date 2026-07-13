const multer = require("multer");

const {
    imageUploadFileFilter,
    uploadFileSizeLimit
} = require("../config/security");

module.exports = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: uploadFileSizeLimit,
        files: 1
    },
    fileFilter: imageUploadFileFilter
});
