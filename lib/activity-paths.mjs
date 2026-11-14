export const VISIT_PATHS=['/','/about','/articles','/login','/register','/forgot-password','/reset-password','/verify-email',...['news','articles','realtime','data','devices','maintenance','calibration','personal','hobo','members','permissions','locations','labs','maintainers','alerts','files','connection','activity','homepage'].map(id=>'/#'+id)];

export const isVisitPath=path=>typeof path==='string'&&(VISIT_PATHS.includes(path)||/^\/articles\/[a-f0-9-]{36}$/.test(path));
