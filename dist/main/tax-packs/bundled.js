"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUNDLED_COUNTRY_PACKS = void 0;
exports.bundledPackVersionId = bundledPackVersionId;
exports.getBundledCountryPack = getBundledCountryPack;
const generic_json_1 = __importDefault(require("./generic.json"));
exports.BUNDLED_COUNTRY_PACKS = [
    generic_json_1.default,
];
function bundledPackVersionId(pack) {
    return `${pack.id}@${pack.version}`;
}
function getBundledCountryPack(country) {
    return exports.BUNDLED_COUNTRY_PACKS.find((pack) => pack.country === country)
        || generic_json_1.default;
}
//# sourceMappingURL=bundled.js.map