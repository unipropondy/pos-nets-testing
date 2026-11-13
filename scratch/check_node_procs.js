const { execSync } = require('child_process');
const out = execSync('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /value').toString();
console.log(out);

