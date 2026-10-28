// Read-only host/container diagnostics. Never inspect environment variables or credentials.
import os from 'node:os';
import {readFileSync,statfsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=path=>{try{return readFileSync(path,'utf8').trim();}catch{return null;}};
const meminfo=read('/proc/meminfo');
const memoryKiB=name=>{const match=meminfo?.match(new RegExp(`^${name}:\\s+(\\d+)`,'m'));return match?Number(match[1]):null;};
const vmstat=read('/proc/vmstat');
const swapPages=name=>{const match=vmstat?.match(new RegExp(`^${name} (\\d+)`,'m'));return match?Number(match[1]):null;};
let disk=null;
try{const info=statfsSync('.');disk={totalBytes:info.blocks*info.bsize,availableBytes:info.bavail*info.bsize};}catch{}
const report={timestamp:new Date().toISOString(),platform:os.platform(),cpus:os.cpus().length,loadAverage:os.loadavg(),
  memory:{totalBytes:os.totalmem(),freeBytes:os.freemem(),availableKiB:memoryKiB('MemAvailable'),swapTotalKiB:memoryKiB('SwapTotal'),swapFreeKiB:memoryKiB('SwapFree')},
  swapPagesSinceBoot:{in:swapPages('pswpin'),out:swapPages('pswpout')},disk,
  pressure:{cpu:read('/proc/pressure/cpu'),memory:read('/proc/pressure/memory'),io:read('/proc/pressure/io')},
  cgroupV2:{cpuMax:read('/sys/fs/cgroup/cpu.max'),cpuStat:read('/sys/fs/cgroup/cpu.stat'),memoryMax:read('/sys/fs/cgroup/memory.max'),memoryCurrent:read('/sys/fs/cgroup/memory.current'),memoryEvents:read('/sys/fs/cgroup/memory.events')},
};
if(process.argv.includes('--docker')){
  const command=(args)=>execFileSync('docker',args,{encoding:'utf8',timeout:10000,maxBuffer:128*1024,stdio:['ignore','pipe','pipe']}).trim();
  try{
    const ids=command(['compose','--profile','calibration','ps','-q','app','calibration-worker']).split(/\s+/).filter(Boolean);
    if(ids.some(id=>!/^([a-f0-9]{12}|[a-f0-9]{64})$/.test(id)))throw new Error('Invalid container ID');
    report.containers=[];
    for(const id of ids){
      const format='{"name":{{json .Name}},"running":{{.State.Running}},"oomKilled":{{.State.OOMKilled}},"restartCount":{{.RestartCount}},"memoryLimitBytes":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}},"cpuShares":{{.HostConfig.CpuShares}},"pidsLimit":{{json .HostConfig.PidsLimit}}}';
      const settings=JSON.parse(command(['inspect','--format',format,id]));
      const usage=JSON.parse(command(['stats','--no-stream','--format','{{json .}}',id]));
      report.containers.push({...settings,usage:{cpu:usage.CPUPerc,memory:usage.MemUsage,memoryPercent:usage.MemPerc,pids:usage.PIDs,blockIO:usage.BlockIO}});
    }
  }catch{report.dockerError='無法讀取 Docker；請確認已安裝 Docker、具有讀取權限，並從專案目錄執行。';}
}
console.log(JSON.stringify(report,null,2));
