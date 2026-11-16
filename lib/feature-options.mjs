export const FEATURES=[
 ['news','最新消息'],['articles','文章專區'],['files','檔案專區'],['realtime','線上即時狀況'],['data','資料查詢'],['hobo','LI-COR / HOBO'],
 ['personal','我的設備與校正'],['devices','ASLUNG ID 管理'],['maintenance','維修保養'],['locations','設備追蹤'],['labs','地點管理'],['maintainers','維護人員'],
 ['calibration','校正管理'],['alerts','設備斷線通知'],['connection','資料串接'],['members','會員管理'],['permissions','資料授權'],['activity','操作紀錄'],['homepage','首頁設定'],['feature-access','功能存取設定']
].map(([id,label])=>({id,label}));
export function roleFeatureAllowed(role,id){
 if(role==='admin')return FEATURES.some(f=>f.id===id);
 if(['news','articles','files'].includes(id))return ['basic','member','viewer','device_manager','calibration_manager'].includes(role);
 if(role==='basic')return false;
 if(!['member','viewer','device_manager','calibration_manager'].includes(role))return false;
 if(['realtime','data','alerts','connection'].includes(id))return true;
 if(id==='maintenance')return role!=='viewer';
 if(id==='personal')return role==='member';
 if(id==='devices')return role==='device_manager';
 if(id==='calibration')return role==='calibration_manager';
 return false;
}
