"use strict";
/**
 * Fixed FloCafe role definitions and authorization groups.
 *
 * Backend route gates import ROLE_ACCESS from this module. The renderer uses
 * PERMISSION_CAPABILITIES to render the read-only matrix, so the matrix stays
 * aligned with the same role groups that protect the runtime surfaces.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_CAPABILITIES = exports.ROLE_ACCESS = exports.OPERATIONAL_ROLES = exports.ROLE_LABEL_KEYS = exports.ROLE_KEYS = exports.ROLE_DEFINITIONS = void 0;
exports.isRole = isRole;
exports.hasRole = hasRole;
exports.capabilityAllows = capabilityAllows;
exports.ROLE_DEFINITIONS = [
    { id: 'owner', labelKey: 'roleOwner', descriptionKey: 'ownerDescription' },
    { id: 'manager', labelKey: 'roleManager', descriptionKey: 'managerDescription' },
    { id: 'cashier', labelKey: 'roleCashier', descriptionKey: 'cashierDescription' },
    { id: 'server', labelKey: 'roleServer', descriptionKey: 'serverDescription' },
    { id: 'chef', labelKey: 'roleChef', descriptionKey: 'chefDescription' },
];
exports.ROLE_KEYS = exports.ROLE_DEFINITIONS.map(({ id }) => id);
exports.ROLE_LABEL_KEYS = Object.fromEntries(exports.ROLE_DEFINITIONS.map(({ id, labelKey }) => [id, labelKey]));
const OWNER = ['owner'];
const OWNER_MANAGER = ['owner', 'manager'];
const OWNER_MANAGER_CASHIER = ['owner', 'manager', 'cashier'];
const SALES = ['owner', 'manager', 'cashier', 'server'];
const CASHIER_SERVER = ['cashier', 'server'];
const KITCHEN = ['owner', 'manager', 'chef'];
const ORDER_STATUS = ['owner', 'manager', 'cashier', 'server', 'chef'];
const ALL_STAFF = ['owner', 'manager', 'cashier', 'server', 'chef'];
const SERVER_APP = ['server', 'manager', 'owner'];
exports.OPERATIONAL_ROLES = ['cashier', 'server', 'chef'];
/** Named role groups used by backend middleware and frontend surface gates. */
exports.ROLE_ACCESS = {
    owner: OWNER,
    ownerManager: OWNER_MANAGER,
    ownerManagerCashier: OWNER_MANAGER_CASHIER,
    sales: SALES,
    cashierServer: CASHIER_SERVER,
    kitchen: KITCHEN,
    orderStatus: ORDER_STATUS,
    allStaff: ALL_STAFF,
    serverApp: SERVER_APP,
    operational: exports.OPERATIONAL_ROLES,
};
/**
 * Capability rows are intentionally action-oriented. Each allowedRoles value
 * is one of ROLE_ACCESS, which is also used by the matching route middleware.
 */
exports.PERMISSION_CAPABILITIES = [
    { id: 'pos', area: 'orders', labelKey: 'pos', allowedRoles: exports.ROLE_ACCESS.ownerManagerCashier },
    { id: 'dashboard', area: 'reports', labelKey: 'dashboard', allowedRoles: exports.ROLE_ACCESS.owner },
    { id: 'ordersReadCreate', area: 'orders', labelKey: 'ordersReadCreate', allowedRoles: exports.ROLE_ACCESS.sales },
    { id: 'ordersStatus', area: 'orders', labelKey: 'ordersStatus', allowedRoles: exports.ROLE_ACCESS.orderStatus },
    { id: 'ordersCustomerDiscounts', area: 'orders', labelKey: 'ordersCustomerDiscounts', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'orderItemCancel', area: 'orders', labelKey: 'orderItemCancel', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'orderItemVoid', area: 'orders', labelKey: 'orderItemVoid', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'orderItemRestore', area: 'orders', labelKey: 'orderItemRestore', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'heldOrders', area: 'orders', labelKey: 'heldOrders', allowedRoles: exports.ROLE_ACCESS.sales },
    { id: 'billsPayments', area: 'payments', labelKey: 'billsPayments', allowedRoles: exports.ROLE_ACCESS.ownerManagerCashier },
    { id: 'billDiscounts', area: 'payments', labelKey: 'billDiscounts', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'paymentMethodsView', area: 'payments', labelKey: 'paymentMethodsView', allowedRoles: exports.ROLE_ACCESS.allStaff },
    { id: 'paymentMethodsManage', area: 'payments', labelKey: 'paymentMethodsManage', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'printing', area: 'payments', labelKey: 'printing', allowedRoles: exports.ROLE_ACCESS.ownerManagerCashier },
    { id: 'customersViewCreate', area: 'customers', labelKey: 'customersViewCreate', allowedRoles: exports.ROLE_ACCESS.sales },
    { id: 'customersEdit', area: 'customers', labelKey: 'customersEdit', allowedRoles: exports.ROLE_ACCESS.ownerManagerCashier },
    { id: 'customerMaintenance', area: 'customers', labelKey: 'customerMaintenance', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'customerCleanup', area: 'customers', labelKey: 'customerCleanup', allowedRoles: exports.ROLE_ACCESS.owner },
    { id: 'catalogManagement', area: 'menu', labelKey: 'catalogManagement', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'menuImportExport', area: 'menu', labelKey: 'menuImportExport', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'tablesManage', area: 'orders', labelKey: 'tablesManage', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'tablesMoveOrders', area: 'orders', labelKey: 'tablesMoveOrders', allowedRoles: exports.ROLE_ACCESS.sales },
    { id: 'kds', area: 'kitchen', labelKey: 'kds', allowedRoles: exports.ROLE_ACCESS.kitchen },
    { id: 'kdsPairing', area: 'kitchen', labelKey: 'kdsPairing', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'kitchenStations', area: 'kitchen', labelKey: 'kitchenStations', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'reports', area: 'reports', labelKey: 'reports', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'staffViewManage', area: 'staff', labelKey: 'staffViewManage', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'staffOwnerManager', area: 'staff', labelKey: 'staffOwnerManager', allowedRoles: exports.ROLE_ACCESS.owner },
    { id: 'operationalStaff', area: 'staff', labelKey: 'operationalStaff', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'settingsView', area: 'settings', labelKey: 'settingsView', allowedRoles: exports.ROLE_ACCESS.allStaff },
    { id: 'settingsManage', area: 'settings', labelKey: 'settingsManage', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'taxPacksViewTest', area: 'settings', labelKey: 'taxPacksViewTest', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'taxPacksManage', area: 'settings', labelKey: 'taxPacksManage', allowedRoles: exports.ROLE_ACCESS.owner },
    { id: 'taxConfiguration', area: 'settings', labelKey: 'taxConfiguration', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'printTemplatesView', area: 'settings', labelKey: 'printTemplatesView', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'printTemplatesManage', area: 'settings', labelKey: 'printTemplatesManage', allowedRoles: exports.ROLE_ACCESS.owner },
    { id: 'printersManage', area: 'settings', labelKey: 'printersManage', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'whatsappUse', area: 'integrations', labelKey: 'whatsappUse', allowedRoles: exports.ROLE_ACCESS.ownerManagerCashier },
    { id: 'whatsappManage', area: 'integrations', labelKey: 'whatsappManage', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'cloudDrive', area: 'integrations', labelKey: 'cloudDrive', allowedRoles: exports.ROLE_ACCESS.ownerManager },
    { id: 'cloudAccountData', area: 'integrations', labelKey: 'cloudAccountData', allowedRoles: exports.ROLE_ACCESS.owner },
    { id: 'databaseTools', area: 'system', labelKey: 'databaseTools', allowedRoles: exports.ROLE_ACCESS.owner },
    { id: 'serverApp', area: 'orders', labelKey: 'serverApp', allowedRoles: exports.ROLE_ACCESS.serverApp },
    { id: 'support', area: 'support', labelKey: 'support', allowedRoles: exports.ROLE_ACCESS.allStaff },
];
function isRole(value) {
    return exports.ROLE_KEYS.includes(value);
}
function hasRole(value, allowedRoles) {
    return isRole(value) && allowedRoles.includes(value);
}
function capabilityAllows(capability, role) {
    return hasRole(role, capability.allowedRoles);
}
//# sourceMappingURL=role-permissions.js.map