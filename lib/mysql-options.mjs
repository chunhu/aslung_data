export function mysqlOptions(kind='app',env=process.env){
  for(const key of ['MYSQL_HOST','MYSQL_USER','MYSQL_DATABASE'])if(!env[key])throw new Error('缺少 MySQL 設定：'+key);
  const variable=kind==='worker'?'MYSQL_WORKER_CONNECTION_LIMIT':'MYSQL_CONNECTION_LIMIT';
  const limit=env[variable]===undefined||env[variable]===''?(kind==='worker'?1:4):Number(env[variable]);
  if(!Number.isInteger(limit)||limit<1||limit>30)throw new Error(variable+' 必須是 1 至 30 的整數。');
  return {host:env.MYSQL_HOST,user:env.MYSQL_USER,password:env.MYSQL_PASSWORD,database:env.MYSQL_DATABASE,
    port:Number(env.MYSQL_PORT||3306),timezone:'+00:00',decimalNumbers:true,
    waitForConnections:true,connectionLimit:limit,maxIdle:Math.min(1,limit-1),idleTimeout:30000,queueLimit:0,
    connectTimeout:10000,enableKeepAlive:true,keepAliveInitialDelay:10000};
}

// Share a lazy pool across bundled route modules and development reloads in this process.
export function sharedMysqlPool(createPool,env=process.env,registry=globalThis){
  const key=Symbol.for('aslung.mysql.appPool');
  if(!registry[key])registry[key]=createPool(mysqlOptions('app',env));
  return registry[key];
}
