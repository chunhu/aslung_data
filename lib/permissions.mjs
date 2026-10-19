export const MEMBER_ROLES={admin:{zh:'系統管理員',en:'System administrator'},device_manager:{zh:'設備管理員',en:'Device manager'},calibration_manager:{zh:'校正管理員',en:'Calibration manager'},member:{zh:'研究會員',en:'Research member'},viewer:{zh:'檢視會員',en:'Viewer'}};
export const validMemberRole=role=>Object.hasOwn(MEMBER_ROLES,role);
export const roleLabel=(role,en=false)=>MEMBER_ROLES[role]?.[en?'en':'zh']||(en?'Unknown role':'未知角色');
export const canManageCalibration=me=>['admin','calibration_manager'].includes(me?.role);
export const canExportData=me=>validMemberRole(me?.role)&&me.role!=='viewer';
export const canManageDevices=me=>['admin','device_manager'].includes(me?.role);
export const canWriteMaintenance=me=>validMemberRole(me?.role)&&me.role!=='viewer';
