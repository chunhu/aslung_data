import mysql from 'mysql2/promise';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mysqlOptions} from '../lib/mysql-options.mjs';

export async function checkCalibrationMysql({createConnection=mysql.createConnection,env=process.env}={}){
  const {connectionLimit,maxIdle,idleTimeout,queueLimit,waitForConnections,...options}=mysqlOptions('worker',env);
  let connection;
  try{
    connection=await createConnection(options);
    await connection.query({sql:'SELECT id,uid,time,ch1,ch2,ch3,ch4,ch5,ch6,ch29,ch30,ch31 FROM rawdata LIMIT 0',timeout:30000});
  }finally{if(connection)await connection.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await checkCalibrationMysql();console.log('校正 worker 的 MySQL 唯讀查詢檢查通過。');}
  catch(error){
    console.error(error?.code==='ER_CON_COUNT_ERROR'?'MySQL 連線數已滿（1040）。worker 尚未啟動。請降低網站／其他程式連線數，並請資料庫管理員檢查 Threads_connected、max_connections 與連線來源；釋放連線後重新部署。':'MySQL 唯讀檢查失敗；請檢查資料庫設定、網路與 rawdata 讀取權限。');
    process.exitCode=1;
  }
}
