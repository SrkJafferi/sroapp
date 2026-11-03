// Isolated loopback-only production benchmark. Does not edit environment files.
import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['../../node_modules/next/dist/bin/next','start','--port','3101','--hostname','127.0.0.1'],{cwd:'apps/web',env:{...process.env,SRO_APP_URL:'http://localhost:3101'},stdio:'inherit',windowsHide:true});
process.on('SIGINT',()=>child.kill());
child.on('exit',code=>{process.exitCode=code??0;});
