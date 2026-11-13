// Safe pure-JS shim for react-native-thermal-printer
// Prevents native crashes on Android / Web / Windows while allowing graceful PDF fallback

const defaultConfig = {
  macAddress: '',
  ip: '192.168.192.168',
  port: 9100,
  payload: '',
  autoCut: true,
  openCashbox: false,
  mmFeedPaper: 20,
  printerDpi: 203,
  printerWidthMM: 80,
  printerNbrCharactersPerLine: 42,
  timeout: 30000,
};

const printTcp = async (_args) => {
  throw new Error("Direct TCP thermal printer native module is not enabled on this mobile client. Please use Network/PDF printing.");
};

const printBluetooth = async (_args) => {
  throw new Error("Direct Bluetooth thermal printer native module is not enabled on this mobile client. Please use Network/PDF printing.");
};

const getBluetoothDeviceList = async () => {
  return [];
};

const printer = {
  printTcp,
  printBluetooth,
  getBluetoothDeviceList,
  defaultConfig,
};

module.exports = printer;
module.exports.default = printer;
module.exports.printTcp = printTcp;
module.exports.printBluetooth = printBluetooth;
module.exports.getBluetoothDeviceList = getBluetoothDeviceList;
module.exports.defaultConfig = defaultConfig;
