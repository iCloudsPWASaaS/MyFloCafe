/**
 * Fixed FloCafe role definitions and authorization groups.
 *
 * Backend route gates import ROLE_ACCESS from this module. The renderer uses
 * PERMISSION_CAPABILITIES to render the read-only matrix, so the matrix stays
 * aligned with the same role groups that protect the runtime surfaces.
 */
export declare const ROLE_DEFINITIONS: readonly [{
    readonly id: "owner";
    readonly labelKey: "roleOwner";
    readonly descriptionKey: "ownerDescription";
}, {
    readonly id: "manager";
    readonly labelKey: "roleManager";
    readonly descriptionKey: "managerDescription";
}, {
    readonly id: "cashier";
    readonly labelKey: "roleCashier";
    readonly descriptionKey: "cashierDescription";
}, {
    readonly id: "server";
    readonly labelKey: "roleServer";
    readonly descriptionKey: "serverDescription";
}, {
    readonly id: "chef";
    readonly labelKey: "roleChef";
    readonly descriptionKey: "chefDescription";
}];
export type Role = typeof ROLE_DEFINITIONS[number]['id'];
export type RoleLabelKey = typeof ROLE_DEFINITIONS[number]['labelKey'];
export declare const ROLE_KEYS: [Role, ...Role[]];
export declare const ROLE_LABEL_KEYS: Record<Role, RoleLabelKey>;
export declare const OPERATIONAL_ROLES: readonly ["cashier", "server", "chef"];
/** Named role groups used by backend middleware and frontend surface gates. */
export declare const ROLE_ACCESS: {
    readonly owner: readonly ["owner"];
    readonly ownerManager: readonly ["owner", "manager"];
    readonly ownerManagerCashier: readonly ["owner", "manager", "cashier"];
    readonly sales: readonly ["owner", "manager", "cashier", "server"];
    readonly cashierServer: readonly ["cashier", "server"];
    readonly kitchen: readonly ["owner", "manager", "chef"];
    readonly orderStatus: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly allStaff: readonly ["owner", "manager", "cashier", "server", "chef"];
    readonly serverApp: readonly ["server", "manager", "owner"];
    readonly operational: readonly ["cashier", "server", "chef"];
};
export type RoleAccessKey = keyof typeof ROLE_ACCESS;
export type PermissionArea = 'orders' | 'payments' | 'customers' | 'menu' | 'kitchen' | 'reports' | 'staff' | 'settings' | 'integrations' | 'system' | 'support';
export type PermissionCapability = {
    id: string;
    area: PermissionArea;
    labelKey: string;
    allowedRoles: readonly Role[];
};
/**
 * Capability rows are intentionally action-oriented. Each allowedRoles value
 * is one of ROLE_ACCESS, which is also used by the matching route middleware.
 */
export declare const PERMISSION_CAPABILITIES: readonly [{
    readonly id: "pos";
    readonly area: "orders";
    readonly labelKey: "pos";
    readonly allowedRoles: readonly ["owner", "manager", "cashier"];
}, {
    readonly id: "dashboard";
    readonly area: "reports";
    readonly labelKey: "dashboard";
    readonly allowedRoles: readonly ["owner"];
}, {
    readonly id: "ordersReadCreate";
    readonly area: "orders";
    readonly labelKey: "ordersReadCreate";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server"];
}, {
    readonly id: "ordersStatus";
    readonly area: "orders";
    readonly labelKey: "ordersStatus";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
}, {
    readonly id: "ordersCustomerDiscounts";
    readonly area: "orders";
    readonly labelKey: "ordersCustomerDiscounts";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "orderItemCancel";
    readonly area: "orders";
    readonly labelKey: "orderItemCancel";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "orderItemVoid";
    readonly area: "orders";
    readonly labelKey: "orderItemVoid";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "orderItemRestore";
    readonly area: "orders";
    readonly labelKey: "orderItemRestore";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "heldOrders";
    readonly area: "orders";
    readonly labelKey: "heldOrders";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server"];
}, {
    readonly id: "billsPayments";
    readonly area: "payments";
    readonly labelKey: "billsPayments";
    readonly allowedRoles: readonly ["owner", "manager", "cashier"];
}, {
    readonly id: "billDiscounts";
    readonly area: "payments";
    readonly labelKey: "billDiscounts";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "paymentMethodsView";
    readonly area: "payments";
    readonly labelKey: "paymentMethodsView";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
}, {
    readonly id: "paymentMethodsManage";
    readonly area: "payments";
    readonly labelKey: "paymentMethodsManage";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "printing";
    readonly area: "payments";
    readonly labelKey: "printing";
    readonly allowedRoles: readonly ["owner", "manager", "cashier"];
}, {
    readonly id: "customersViewCreate";
    readonly area: "customers";
    readonly labelKey: "customersViewCreate";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server"];
}, {
    readonly id: "customersEdit";
    readonly area: "customers";
    readonly labelKey: "customersEdit";
    readonly allowedRoles: readonly ["owner", "manager", "cashier"];
}, {
    readonly id: "customerMaintenance";
    readonly area: "customers";
    readonly labelKey: "customerMaintenance";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "customerCleanup";
    readonly area: "customers";
    readonly labelKey: "customerCleanup";
    readonly allowedRoles: readonly ["owner"];
}, {
    readonly id: "catalogManagement";
    readonly area: "menu";
    readonly labelKey: "catalogManagement";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "menuImportExport";
    readonly area: "menu";
    readonly labelKey: "menuImportExport";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "tablesManage";
    readonly area: "orders";
    readonly labelKey: "tablesManage";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "tablesMoveOrders";
    readonly area: "orders";
    readonly labelKey: "tablesMoveOrders";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server"];
}, {
    readonly id: "kds";
    readonly area: "kitchen";
    readonly labelKey: "kds";
    readonly allowedRoles: readonly ["owner", "manager", "chef"];
}, {
    readonly id: "kdsPairing";
    readonly area: "kitchen";
    readonly labelKey: "kdsPairing";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "kitchenStations";
    readonly area: "kitchen";
    readonly labelKey: "kitchenStations";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "reports";
    readonly area: "reports";
    readonly labelKey: "reports";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "staffViewManage";
    readonly area: "staff";
    readonly labelKey: "staffViewManage";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "staffOwnerManager";
    readonly area: "staff";
    readonly labelKey: "staffOwnerManager";
    readonly allowedRoles: readonly ["owner"];
}, {
    readonly id: "operationalStaff";
    readonly area: "staff";
    readonly labelKey: "operationalStaff";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "settingsView";
    readonly area: "settings";
    readonly labelKey: "settingsView";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
}, {
    readonly id: "settingsManage";
    readonly area: "settings";
    readonly labelKey: "settingsManage";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "taxPacksViewTest";
    readonly area: "settings";
    readonly labelKey: "taxPacksViewTest";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "taxPacksManage";
    readonly area: "settings";
    readonly labelKey: "taxPacksManage";
    readonly allowedRoles: readonly ["owner"];
}, {
    readonly id: "taxConfiguration";
    readonly area: "settings";
    readonly labelKey: "taxConfiguration";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "printTemplatesView";
    readonly area: "settings";
    readonly labelKey: "printTemplatesView";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "printTemplatesManage";
    readonly area: "settings";
    readonly labelKey: "printTemplatesManage";
    readonly allowedRoles: readonly ["owner"];
}, {
    readonly id: "printersManage";
    readonly area: "settings";
    readonly labelKey: "printersManage";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "whatsappUse";
    readonly area: "integrations";
    readonly labelKey: "whatsappUse";
    readonly allowedRoles: readonly ["owner", "manager", "cashier"];
}, {
    readonly id: "whatsappManage";
    readonly area: "integrations";
    readonly labelKey: "whatsappManage";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "cloudDrive";
    readonly area: "integrations";
    readonly labelKey: "cloudDrive";
    readonly allowedRoles: readonly ["owner", "manager"];
}, {
    readonly id: "cloudAccountData";
    readonly area: "integrations";
    readonly labelKey: "cloudAccountData";
    readonly allowedRoles: readonly ["owner"];
}, {
    readonly id: "databaseTools";
    readonly area: "system";
    readonly labelKey: "databaseTools";
    readonly allowedRoles: readonly ["owner"];
}, {
    readonly id: "serverApp";
    readonly area: "orders";
    readonly labelKey: "serverApp";
    readonly allowedRoles: readonly ["server", "manager", "owner"];
}, {
    readonly id: "support";
    readonly area: "support";
    readonly labelKey: "support";
    readonly allowedRoles: readonly ["owner", "manager", "cashier", "server", "chef"];
}];
export type PermissionCapabilityId = typeof PERMISSION_CAPABILITIES[number]['id'];
export declare function isRole(value: string | null | undefined): value is Role;
export declare function hasRole(value: string | null | undefined, allowedRoles: readonly Role[]): boolean;
export declare function capabilityAllows(capability: PermissionCapability, role: string | null | undefined): boolean;
//# sourceMappingURL=role-permissions.d.ts.map