const fs = require('fs');

// 1. Update UniProPOS.cs
const uniproPath = 'installer-build/UniProPOS.cs';
let unipro = fs.readFileSync(uniproPath, 'utf8');

const target1 = 'backendPsi.UseShellExecute = false;';
const replace1 = `backendPsi.UseShellExecute = false;
                string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                string persistentLogDir = Path.Combine(programData, "SmartPOS", "logs");
                backendPsi.EnvironmentVariables["LOGS_DIR"] = persistentLogDir;`;

if (!unipro.includes('persistentLogDir') && unipro.includes(target1)) {
  unipro = unipro.replace(target1, replace1);
  fs.writeFileSync(uniproPath, unipro, 'utf8');
  console.log('Successfully updated UniProPOS.cs with LOGS_DIR');
} else {
  console.log('UniProPOS.cs already updated or target not found');
}

// 2. Update Setup.cs
const setupPath = 'installer-build/Setup.cs';
let setup = fs.readFileSync(setupPath, 'utf8');

const target2 = `// Ensure logs directory exists
                        string logsDir = Path.Combine(defaultInstallDir, "logs");
                        if (!Directory.Exists(logsDir)) Directory.CreateDirectory(logsDir);

                        // Ensure backend.log and frontend.log exist
                        string backendLogFile = Path.Combine(logsDir, "backend.log");
                        if (!File.Exists(backendLogFile)) File.WriteAllText(backendLogFile, "[SETUP] Smart POS Backend Logging Initialized\\r\\n");

                        string frontendLogFile = Path.Combine(logsDir, "frontend.log");
                        if (!File.Exists(frontendLogFile)) File.WriteAllText(frontendLogFile, "[SETUP] Smart POS Frontend Logging Initialized\\r\\n");

                        // Create View-Logs.bat helper
                        string viewLogsBat = Path.Combine(defaultInstallDir, "View-Logs.bat");
                        File.WriteAllText(viewLogsBat, "@echo off\\r\\nstart \\"\\" explorer.exe \\"%~dp0logs\\"\\r\\n");`;

const replace2 = `// Standardized persistent log directory across all users: %ProgramData%\\SmartPOS\\logs
                        string commonAppData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                        string persistentLogDir = Path.Combine(commonAppData, "SmartPOS", "logs");
                        string backendLogSubDir = Path.Combine(persistentLogDir, "backend");
                        string frontendLogSubDir = Path.Combine(persistentLogDir, "frontend");

                        if (!Directory.Exists(persistentLogDir)) Directory.CreateDirectory(persistentLogDir);
                        if (!Directory.Exists(backendLogSubDir)) Directory.CreateDirectory(backendLogSubDir);
                        if (!Directory.Exists(frontendLogSubDir)) Directory.CreateDirectory(frontendLogSubDir);

                        // Create View-Logs.bat helper pointing to %ProgramData%\\SmartPOS\\logs
                        string viewLogsBat = Path.Combine(defaultInstallDir, "View-Logs.bat");
                        File.WriteAllText(viewLogsBat, "@echo off\\r\\nstart \\"\\" explorer.exe \\"" + persistentLogDir + "\\"\\r\\n");`;

if (setup.includes(target2)) {
  setup = setup.replace(target2, replace2);
  fs.writeFileSync(setupPath, setup, 'utf8');
  console.log('Successfully updated Setup.cs with persistentLogDir');
} else {
  console.log('Setup.cs target not found or already updated');
}

