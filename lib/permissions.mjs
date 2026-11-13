export const MEMBER_ROLES={admin:{zh:'系統管理員',en:'System administrator'},device_manager:{zh:'設備管理員',en:'Device manager'},calibration_manager:{zh:'校正管理員',en:'Calibration manager'},basic:{zh:'一般會員',en:'General member'},member:{zh:'研究會員',en:'Research member'},viewer:{zh:'資料檢視會員',en:'Data viewer'}};
export const validMemberRole=role=>Object.hasOwn(MEMBER_ROLES,role);
export const roleLabel=(role,en=false)=>MEMBER_ROLES[role]?.[en?'en':'zh']||(en?'Unknown role':'未知角色');
export const canManageCalibration=me=>['admin','calibration_manager'].includes(me?.role);
export const canExportData=me=>['admin','device_manager','calibration_manager','member'].includes(me?.role);
export const canManageDevices=me=>['admin','device_manager'].includes(me?.role);
export const canWriteMaintenance=me=>['admin','device_manager','calibration_manager','member'].includes(me?.role);

export const RESOURCE_SECTIONS=['news','articles','files'];
export const resourceOnly=me=>me?.role==='basic';
