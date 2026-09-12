"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDataDir = getDataDir;
exports.encryptString = encryptString;
exports.decryptString = decryptString;
exports.isEncryptionAvailable = isEncryptionAvailable;
exports.clearMasterKey = clearMasterKey;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
let masterKey = null;
function getDataDirInternal() {
    const appData = process.env.APP_DATA || process.env.FLO_DATA_DIR;
    if (appData)
        return appData;
    return path.join(os.homedir(), '.flo-desktop');
}
function getDataDir() {
    return getDataDirInternal();
}
function getMasterKeyPath() {
    return path.join(getDataDir(), 'master-key.enc');
}
function getMasterKey() {
    if (masterKey)
        return masterKey;
    const keyPath = getMasterKeyPath();
    try {
        const encrypted = fs.readFileSync(keyPath, 'utf8');
        masterKey = Buffer.from(encrypted, 'utf8');
    }
    catch {
        masterKey = crypto.randomBytes(KEY_LENGTH);
        try {
            const dir = path.dirname(keyPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(keyPath, masterKey.toString('utf8'), { mode: 0o600 });
        }
        catch {
            // If we can't persist the key, we'll use an in-memory key.
            // Encryption will still work but won't survive restarts.
        }
    }
    return masterKey;
}
function encryptString(plaintext) {
    const key = getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}:${encrypted.toString('base64')}`;
}
function decryptString(ciphertext) {
    const key = getMasterKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 2)
        throw new Error('Invalid ciphertext format');
    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = Buffer.from(parts[1], 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}
function isEncryptionAvailable() {
    try {
        const test = encryptString('test');
        decryptString(test);
        return true;
    }
    catch {
        return false;
    }
}
function clearMasterKey() {
    masterKey = null;
}
//# sourceMappingURL=encryption.js.map